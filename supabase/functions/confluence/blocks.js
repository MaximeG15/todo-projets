// Blocs « To do projets » dans une page Confluence (format de stockage XHTML).
// Chaque journée est encadrée par deux ancres invisibles : tdp-<déplacement>-<jour> et tdp-<déplacement>-<jour>-fin.
// Seul le contenu entre ces ancres est remplacé ; le reste de la page n'est jamais modifié.
// La journée la plus récente est placée en haut des blocs du déplacement.

export const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]))
  // caractères interdits en XML
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
const lines = (s) => esc(String(s ?? "").trim()).replace(/\r?\n/g, "<br />");
const anchor = (name) => `<ac:structured-macro ac:name="anchor" ac:schema-version="1"><ac:parameter ac:name="">${name}</ac:parameter></ac:structured-macro>`;
export const anchorName = (vid, day) => `tdp-${vid}-${day}`;

// étiquette native de Confluence (macro « statut »)
const STATUS_COLOURS = { Grey: 1, Red: 1, Yellow: 1, Green: 1, Blue: 1, Purple: 1 };
const status = (title, colour) => `<ac:structured-macro ac:name="status" ac:schema-version="1"><ac:parameter ac:name="colour">${STATUS_COLOURS[colour] ? colour : "Grey"}</ac:parameter><ac:parameter ac:name="title">${esc(title)}</ac:parameter></ac:structured-macro>`;
export const photoName = (id) => `tdp-${id}.jpg`;
const PHOTO_ID = /^[A-Za-z0-9_-]{1,64}$/;
// identifiants des photos citées dans les journées
export function photoIds(days) {
  const out = [];
  for (const d of days || []) for (const p of d.parts || []) for (const n of p.notes || []) for (const ph of n.photos || []) if (PHOTO_ID.test(String(ph.id)) && !out.includes(ph.id)) out.push(ph.id);
  return out;
}
// rendu générique (visite d'analyse fonctionnelle) : titres, tableaux, notes avec étiquettes et photos, listes
function partsXhtml(parts, hasPhoto) {
  const cellHtml = (c) => (c && typeof c === "object" && c.status) ? status(c.status, c.colour) : lines(c);
  const table = (head, rows) => `<table><tbody>${head && head.length ? `<tr>${head.map((h) => `<th><p>${esc(h)}</p></th>`).join("")}</tr>` : ""}${(rows || []).map((r) => `<tr>${r.map((c) => `<td><p>${cellHtml(c)}</p></td>`).join("")}</tr>`).join("")}</tbody></table>`;
  return (parts || []).map((p) => {
    if (p.h) return `<h3>${esc(p.h)}</h3>`;
    if (p.flux) return `<h3>${esc(p.flux)}</h3>` + (p.sub ? `<p><em>${esc(p.sub)}</em></p>` : "");
    if (p.kv) return `<table><tbody>${p.kv.map(([k, v]) => `<tr><th><p>${esc(k)}</p></th><td><p>${lines(v)}</p></td></tr>`).join("")}</tbody></table>`;
    if (p.table) return table(p.table.head, p.table.rows);
    if (p.ul) return p.ul.length ? `<ul>${p.ul.map((x) => `<li>${lines(x)}</li>`).join("")}</ul>` : "";
    if (p.notes) return p.notes.length ? `<ul>${p.notes.map((n) => {
      const phs = (n.photos || []).filter((ph) => PHOTO_ID.test(String(ph.id)) && hasPhoto(ph.id));
      return `<li>${n.tag ? status(n.tag, n.colour) + " " : ""}${n.time ? `<em>${esc(n.time)}</em> ` : ""}${lines(n.text)}${n.after ? ` <em>(${esc(n.after)})</em>` : ""}` +
        phs.map((ph) => `<p><ac:image ac:width="320"><ri:attachment ri:filename="${photoName(ph.id)}" /></ac:image></p>${ph.caption ? `<p><em>${esc(ph.caption)}</em></p>` : ""}`).join("") + `</li>`;
    }).join("")}</ul>` : "";
    if (p.p) return `<p>${lines(p.p)}</p>`;
    return "";
  }).join("");
}

// day : { key:"2026-10-27", title, stamp, rows:[{title, kind:"list", items:[{t,d,who,st}]} | {title, kind:"text", text}] }
//       ou { key, title, stamp, parts:[…] } (visite d'analyse fonctionnelle)
export function dayXhtml(vid, day, hasPhoto = () => false) {
  const name = anchorName(vid, day.key);
  if (Array.isArray(day.parts)) {
    return `<p>${anchor(name)}</p><h2>${esc(day.title)}</h2>` + (day.stamp ? `<p><em>${esc(day.stamp)}</em></p>` : "") +
      partsXhtml(day.parts, hasPhoto) + `<p>${anchor(name + "-fin")}</p>`;
  }
  const li = (i) => `<li><strong>${esc(i.t)}</strong>${i.d ? " : " + lines(i.d) : ""}${i.who || i.st ? ` (${esc([i.who, i.st].filter(Boolean).join(" - "))})` : ""}</li>`;
  const cell = (r) => r.kind === "list" ? ((r.items || []).length ? `<ul>${r.items.map(li).join("")}</ul>` : "") : (String(r.text || "").trim() ? `<p>${lines(r.text)}</p>` : "");
  const rows = (day.rows || []).map((r) => `<tr><th><p>${esc(r.title)}</p></th><td>${cell(r)}</td></tr>`).join("");
  return `<p>${anchor(name)}</p><h2>${esc(day.title)}</h2>` +
    (day.stamp ? `<p><em>${esc(day.stamp)}</em></p>` : "") +
    `<table><tbody><tr><th><p>Sujet</p></th><th><p>Description</p></th></tr>${rows}</tbody></table>` +
    `<p>${anchor(name + "-fin")}</p>`;
}

// position [début, fin[ d'un bloc existant (ancre de début, éventuellement dans son paragraphe, jusqu'à l'ancre de fin)
export function findBlock(body, name) {
  const s = body.indexOf(`>${name}</ac:parameter>`);
  if (s < 0) return null;
  let start = body.lastIndexOf("<ac:structured-macro", s);
  if (start < 0) return null;
  const before = body.slice(Math.max(0, start - 80), start).match(/<p(\s[^>]*)?>$/);
  if (before) start -= before[0].length;
  const e = body.indexOf(`>${name}-fin</ac:parameter>`, s);
  let end;
  if (e < 0) { // ancre de fin supprimée à la main : on ne retire que l'ancre de début
    end = body.indexOf("</ac:structured-macro>", s) + "</ac:structured-macro>".length;
  } else {
    end = body.indexOf("</ac:structured-macro>", e) + "</ac:structured-macro>".length;
  }
  if (body.startsWith("</p>", end) && (e >= 0 || before)) end += 4;
  return [start, end];
}

// jours déjà présents pour ce déplacement, dans l'ordre de la page
export function listDays(body, vid) {
  const re = new RegExp(`>tdp-${vid.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-(\\d{4}-\\d{2}-\\d{2})</ac:parameter>`, "g");
  const out = [];
  let m;
  while ((m = re.exec(body))) out.push(m[1]);
  return out;
}

// remplace ou insère chaque journée ; renvoie le nouveau corps de page
export function mergeDays(body, vid, days, hasPhoto = () => false) {
  body = String(body || "");
  for (const day of [...days].sort((a, b) => a.key.localeCompare(b.key))) {
    const html = dayXhtml(vid, day, hasPhoto);
    const pos = findBlock(body, anchorName(vid, day.key));
    if (pos) { body = body.slice(0, pos[0]) + html + body.slice(pos[1]); continue; }
    const present = listDays(body, vid);
    const older = present.find((d) => d < day.key); // le plus récent en haut : avant le premier bloc plus ancien
    if (older) { const p = findBlock(body, anchorName(vid, older)); body = body.slice(0, p[0]) + html + body.slice(p[0]); continue; }
    if (present.length) { const p = findBlock(body, anchorName(vid, present[present.length - 1])); body = body.slice(0, p[1]) + html + body.slice(p[1]); continue; }
    body = body + html;
  }
  return body;
}
