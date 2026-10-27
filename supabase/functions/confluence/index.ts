// Relais Confluence de l'application To do projets (comptes rendus de mise en service en direct).
// - L'utilisateur doit être connecté : son jeton de session est vérifié auprès de Supabase Auth,
//   et toutes les lectures en base se font avec ses propres droits (RLS).
// - Le jeton API Atlassian est chiffré ici (AES-GCM, clé CONF_KEY connue du seul relais) avant d'être enregistré.
// - Le lien d'une page à un déplacement est signé (HMAC) : personne ne peut écrire avec le jeton d'un autre
//   sur une page que cette personne n'a pas liée elle-même.
// - Seuls les sites *.atlassian.net sont acceptés. Seuls les blocs « To do projets » de la page sont modifiés.
import { mergeDays, photoIds, photoName } from "./blocks.js";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" } });
const fail = (status: number, code: string, message: string) => json(status, { code, message });
class Fail extends Error {
  status: number; code: string;
  constructor(status: number, code: string, message: string) { super(message); this.status = status; this.code = code; }
}

const enc = new TextEncoder();
const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const b64url = (u: Uint8Array) => b64(u).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
async function keyMaterial() {
  const k = Deno.env.get("CONF_KEY") || "";
  if (k.length < 16) throw new Fail(500, "no_key", "Relais Confluence non configuré (clé CONF_KEY absente).");
  return new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode("tdp-confluence:" + k)));
}
async function aesKey() { return crypto.subtle.importKey("raw", await keyMaterial(), "AES-GCM", false, ["encrypt", "decrypt"]); }
async function seal(text: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await aesKey(), enc.encode(text)));
  return "v1." + b64(iv) + "." + b64(ct);
}
async function open(sealed: string) {
  const [v, iv, ct] = String(sealed).split(".");
  if (v !== "v1") throw new Fail(500, "bad_secret", "Connexion Confluence illisible : reconnectez Confluence.");
  try {
    return new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(iv) }, await aesKey(), unb64(ct)));
  } catch { throw new Fail(401, "bad_secret", "Connexion Confluence illisible : reconnectez Confluence."); }
}
async function sign(text: string) {
  const k = await crypto.subtle.importKey("raw", await keyMaterial(), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(new Uint8Array(await crypto.subtle.sign("HMAC", k, enc.encode("link:" + text))));
}

type Init = { method?: string; body?: string; headers?: Record<string, string> };
type Cred = { site: string; email: string; token: string; mode: string; cloud_id: string | null };
const SITE_RE = /^[a-z0-9][a-z0-9-]{0,62}\.atlassian\.net$/;
const cleanSite = (s: string) => String(s || "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
const apiBase = (c: Cred) => c.mode === "gateway" ? `https://api.atlassian.com/ex/confluence/${c.cloud_id}/wiki` : `https://${c.site}/wiki`;
async function atl(c: Cred, path: string, init: Init = {}) {
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 20000);
  try {
    return await fetch(apiBase(c) + path, { ...init, signal: ctrl.signal, headers: { Authorization: "Basic " + btoa(`${c.email}:${c.token}`), Accept: "application/json", "Content-Type": "application/json", ...(init.headers || {}) } });
  } catch { throw new Fail(504, "timeout", "Confluence ne répond pas pour le moment."); } finally { clearTimeout(t); }
}
async function atlErr(r: Response, what: string): Promise<never> {
  if (r.status === 401) throw new Fail(401, "auth", "Jeton refusé ou expiré : renouvelez-le dans « Connecter Confluence ».");
  if (r.status === 403) throw new Fail(403, "forbidden", `Accès refusé par Confluence (${what}) : vérifiez les droits sur la page et les portées du jeton.`);
  if (r.status === 404) throw new Fail(404, "not_found", "Page introuvable : elle a peut-être été supprimée ou déplacée.");
  if (r.status === 429) throw new Fail(429, "rate", "Confluence limite les envois : nouvel essai dans un instant.");
  throw new Fail(502, "upstream", `Confluence a répondu ${r.status} (${what}).`);
}
// essai sur le site (jeton classique), puis par la passerelle Atlassian (jeton avec portées)
async function probe(site: string, email: string, token: string): Promise<Cred> {
  const c: Cred = { site, email, token, mode: "site", cloud_id: null };
  let r = await atl(c, "/api/v2/pages?limit=1");
  if (r.ok) return c;
  if (r.status !== 401 && r.status !== 403) await atlErr(r, "test");
  const ti = await fetch(`https://${site}/_edge/tenant_info`).catch(() => null);
  const cloud = ti && ti.ok ? (await ti.json().catch(() => ({}))).cloudId : null;
  if (!cloud) await atlErr(r, "test");
  const g: Cred = { site, email, token, mode: "gateway", cloud_id: cloud };
  r = await atl(g, "/api/v2/pages?limit=1");
  if (r.ok) return g;
  return await atlErr(r, "test");
}
// pièces jointes déjà présentes sur la page (noms de fichiers)
async function attachmentNames(c: Cred, pid: string) {
  const names = new Set<string>();
  let path: string | null = `/api/v2/pages/${pid}/attachments?limit=250`;
  for (let i = 0; path && i < 20; i++) {
    const r = await atl(c, path);
    if (!r.ok) return { ok: false, status: r.status, names };
    const j = await r.json();
    for (const a of j.results || []) names.add(String(a.title || ""));
    const next = j._links && j._links.next ? String(j._links.next) : "";
    path = next ? next.replace(/^\/wiki/, "") : null;
  }
  return { ok: true, status: 200, names };
}
async function uploadPhoto(c: Cred, pid: string, name: string, bytes: Uint8Array) {
  const form = new FormData();
  form.append("file", new Blob([bytes], { type: "image/jpeg" }), name);
  form.append("minorEdit", "true");
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 30000);
  try {
    return await fetch(apiBase(c) + `/rest/api/content/${pid}/child/attachment`, { method: "PUT", body: form, signal: ctrl.signal, headers: { Authorization: "Basic " + btoa(`${c.email}:${c.token}`), "X-Atlassian-Token": "no-check", Accept: "application/json" } });
  } catch { return null; } finally { clearTimeout(t); }
}
const MAX_PHOTOS = 6; // photos envoyées par appel (le reste au suivant)
function pageIdFrom(url: string, site: string) {
  let u: URL;
  try { u = new URL(String(url).trim()); } catch { throw new Fail(400, "bad_url", "Collez le lien complet de la page (https://…)."); }
  if (u.hostname.toLowerCase() !== site) throw new Fail(400, "bad_site", `La page doit être sur ${site}, le site de votre connexion.`);
  const m = u.pathname.match(/\/pages\/(?:edit-v2\/|edit\/)?(\d+)/) || (u.searchParams.get("pageId") || "").match(/^(\d+)$/);
  if (!m) throw new Fail(400, "bad_url", "Lien non reconnu : ouvrez la page dans Confluence et copiez l'adresse complète (elle contient /pages/ suivi d'un numéro).");
  return m[1];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return fail(405, "method", "Méthode non autorisée.");
  try {
    const auth = req.headers.get("Authorization") || "";
    if (!auth.startsWith("Bearer ")) throw new Fail(401, "not_authenticated", "Connexion requise.");
    const base = Deno.env.get("SUPABASE_URL")!;
    const key = req.headers.get("apikey") || Deno.env.get("SUPABASE_ANON_KEY") || "";
    const h = { Authorization: auth, apikey: key, "Content-Type": "application/json" };
    const who = await fetch(`${base}/auth/v1/user`, { headers: h });
    const user = who.ok ? await who.json() : null;
    if (!user || !user.id) throw new Fail(401, "not_authenticated", "Session expirée : reconnectez-vous.");
    const body = await req.json().catch(() => ({}));
    const rest = (path: string, init: Init = {}) => fetch(`${base}/rest/v1/${path}`, { ...init, headers: { ...h, ...(init.headers || {}) } });
    const myCred = async (): Promise<Cred> => {
      const r = await rest(`user_confluence?select=site,email,token_enc,mode,cloud_id&user_id=eq.${user.id}`);
      const rows = r.ok ? await r.json() : [];
      if (!rows.length) throw new Fail(404, "no_cred", "Confluence n'est pas connecté sur votre compte.");
      return { ...rows[0], token: await open(rows[0].token_enc) };
    };
    const visit = async (vid: string) => {
      const r = await rest(`visits?select=id,project_id&id=eq.${encodeURIComponent(vid)}&deleted_at=is.null`);
      const rows = r.ok ? await r.json() : [];
      if (!rows.length) throw new Fail(404, "no_visit", "Déplacement introuvable ou non partagé avec vous.");
      return rows[0];
    };

    if (body.action === "save") {
      const site = cleanSite(body.site), email = String(body.email || "").trim(), token = String(body.token || "").trim();
      if (!SITE_RE.test(site)) throw new Fail(400, "bad_site", "Adresse du site attendue sous la forme votre-site.atlassian.net.");
      if (!/^[^@\s]+@[^@\s]+$/.test(email)) throw new Fail(400, "bad_email", "E-mail du compte Atlassian invalide.");
      if (token.length < 20 || token.length > 2000) throw new Fail(400, "bad_token", "Jeton API invalide : copiez-le en entier depuis Atlassian.");
      const exp = /^\d{4}-\d{2}-\d{2}$/.test(String(body.expiresOn || "")) ? body.expiresOn : null;
      const c = await probe(site, email, token);
      const row = { user_id: user.id, site, email, token_enc: await seal(token), mode: c.mode, cloud_id: c.cloud_id, expires_on: exp, updated_at: Date.now() };
      const r = await rest("user_confluence?on_conflict=user_id", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(row) });
      if (!r.ok) throw new Fail(500, "db_error", "Enregistrement de la connexion impossible.");
      return json(200, { ok: true, site, mode: c.mode, expiresOn: exp });
    }
    if (body.action === "test") {
      const c = await myCred();
      const r = await atl(c, "/api/v2/pages?limit=1");
      if (!r.ok) await atlErr(r, "test");
      return json(200, { ok: true });
    }
    if (body.action === "link") {
      const c = await myCred();
      const v = await visit(String(body.visitId || ""));
      const pid = pageIdFrom(body.url, c.site);
      const r = await atl(c, `/api/v2/pages/${pid}?body-format=storage`);
      if (!r.ok) await atlErr(r, "lecture de la page");
      const pg = await r.json();
      const web = pg._links && pg._links.webui ? `https://${c.site}/wiki${pg._links.webui}` : String(body.url);
      return json(200, { ok: true, pageId: pid, title: pg.title || "", url: web, site: c.site, by: user.id, sig: await sign(`${v.id}|${pid}|${user.id}`) });
    }
    if (body.action === "push") {
      const vid = String(body.visitId || ""), pid = String(body.pageId || ""), by = String(body.by || "");
      if (!/^\d+$/.test(pid) || !/^[0-9a-f-]{36}$/.test(by)) throw new Fail(400, "bad_link", "Lien de page invalide : liez la page à nouveau.");
      const v = await visit(vid);
      if (String(body.sig || "") !== await sign(`${v.id}|${pid}|${by}`)) throw new Fail(403, "bad_sig", "Lien de page non reconnu : liez la page à nouveau.");
      const days = Array.isArray(body.days) ? body.days.slice(0, 60) : [];
      for (const d of days) if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(String(d.key))) throw new Fail(400, "bad_day", "Journée invalide.");
      if (!days.length) return json(200, { ok: true, pushed: [] });
      if (JSON.stringify(days).length > 900000) throw new Fail(413, "too_big", "Compte rendu trop volumineux.");
      const cr = await rest("rpc/confluence_cred", { method: "POST", body: JSON.stringify({ vid: v.id, uid: by }) });
      const rows = cr.ok ? await cr.json() : [];
      if (!rows.length) throw new Fail(404, "no_cred", "La personne qui a lié la page n'a plus de connexion Confluence (ou n'a plus accès au projet).");
      const c: Cred = { ...rows[0], token: await open(rows[0].token_enc) };
      // photos : pièces jointes de la page (téléchargées du stockage de l'appli avec les droits de l'appelant)
      const ids = photoIds(days), have = new Set<string>();
      let morePhotos = 0, missing = 0, warn = "";
      if (ids.length) {
        const att = await attachmentNames(c, pid);
        if (!att.ok) warn = att.status === 401 || att.status === 403 ? "photos_scope" : "photos";
        else {
          att.names.forEach((n) => have.add(n));
          const todo = ids.filter((id) => !have.has(photoName(id)));
          for (const id of todo.slice(0, MAX_PHOTOS)) {
            const d = await fetch(`${base}/storage/v1/object/authenticated/visit-photos/${encodeURIComponent(v.project_id)}/${encodeURIComponent(v.id)}/${encodeURIComponent(id)}.jpg`, { headers: { Authorization: auth, apikey: key } });
            if (!d.ok) { missing++; continue; }
            const bytes = new Uint8Array(await d.arrayBuffer());
            if (bytes.byteLength > 15 * 1024 * 1024) { missing++; continue; }
            const u = await uploadPhoto(c, pid, photoName(id), bytes);
            if (u && u.ok) have.add(photoName(id));
            else if (u && (u.status === 401 || u.status === 403)) { warn = "photos_scope"; break; }
            else missing++;
          }
          morePhotos = Math.max(0, todo.length - MAX_PHOTOS);
        }
      }
      const hasPhoto = (id: string) => have.has(photoName(id));
      const extra = { morePhotos, missingPhotos: missing, warn };
      for (let attempt = 0; attempt < 3; attempt++) {
        const g = await atl(c, `/api/v2/pages/${pid}?body-format=storage`);
        if (!g.ok) await atlErr(g, "lecture de la page");
        const pg = await g.json();
        const cur = pg.body && pg.body.storage ? pg.body.storage.value || "" : "";
        const next = mergeDays(cur, v.id, days, hasPhoto);
        if (next === cur) return json(200, { ok: true, pushed: days.map((d: { key: string }) => d.key), unchanged: true, ...extra });
        const p = await atl(c, `/api/v2/pages/${pid}`, { method: "PUT", body: JSON.stringify({ id: pid, status: "current", title: pg.title, body: { representation: "storage", value: next }, version: { number: pg.version.number + 1, message: "To do projets – compte rendu de déplacement" } }) });
        if (p.ok) return json(200, { ok: true, pushed: days.map((d: { key: string }) => d.key), version: pg.version.number + 1, ...extra });
        if (p.status === 409) continue; // page enregistrée entre-temps : on relit et on réessaie
        await atlErr(p, "écriture de la page");
      }
      throw new Fail(409, "conflict", "La page est modifiée en ce moment : nouvel essai dans un instant.");
    }
    throw new Fail(400, "bad_action", "Action inconnue.");
  } catch (e) {
    if (e instanceof Fail) return fail(e.status, e.code, e.message);
    return fail(500, "error", "Erreur du relais Confluence.");
  }
});
