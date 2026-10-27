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

// day : { key:"2026-10-27", title, stamp, rows:[{title, kind:"list", items:[{t,d,who,st}]} | {title, kind:"text", text}] }
export function dayXhtml(vid, day) {
  const name = anchorName(vid, day.key);
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
export function mergeDays(body, vid, days) {
  body = String(body || "");
  for (const day of [...days].sort((a, b) => a.key.localeCompare(b.key))) {
    const html = dayXhtml(vid, day);
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
