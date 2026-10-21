// To do projets : transcription locale des enregistrements de visite (Whisper, via transformers.js).
// Ce module tourne à part (Web Worker) pour ne pas figer l'appli. Le son reçu ne quitte jamais l'ordinateur :
// seul le modèle est téléchargé (une fois, depuis huggingface.co) puis gardé dans le cache du navigateur.
import { pipeline, env } from "../vendor/transformers/transformers.min.js";

env.allowLocalModels = false;
env.useBrowserCache = true;
env.backends.onnx.wasm.wasmPaths = new URL("../vendor/transformers/", import.meta.url).href;
env.backends.onnx.wasm.proxy = false;

let asr = null, cur = "";
const files = {};
let lastPct = -1;

function report(p) {
  if (!p || !p.file) return;
  if (p.status === "progress" || p.status === "done") {
    const f = files[p.file] || (files[p.file] = { l: 0, t: 0 });
    if (p.total) f.t = p.total;
    f.l = p.status === "done" ? (f.t || f.l) : (p.loaded || 0);
    let l = 0, t = 0;
    for (const k in files) { l += files[k].l; t += files[k].t; }
    const pct = t ? Math.min(100, (100 * l) / t) : 0;
    if (Math.round(pct) !== lastPct) { lastPct = Math.round(pct); postMessage({ t: "dl", pct, mb: Math.round(t / 1048576) }); }
  }
}

async function gpuInfo() {
  try {
    if (!self.navigator || !navigator.gpu) return null;
    const a = await navigator.gpu.requestAdapter();
    return a ? { f16: a.features && a.features.has("shader-f16") } : null;
  } catch (e) { return null; }
}

async function load(model) {
  if (asr && cur === model) return asr;
  asr = null;
  const gpu = await gpuInfo();
  const tries = [];
  if (gpu) tries.push({ device: "webgpu", dtype: { encoder_model: gpu.f16 ? "fp16" : "fp32", decoder_model_merged: "q4" } });
  tries.push({ device: "wasm", dtype: "q8" });
  let err = null;
  for (const o of tries) {
    try { asr = await pipeline("automatic-speech-recognition", model, { ...o, progress_callback: report }); cur = model; return asr; }
    catch (e) { err = e; }
  }
  throw err;
}

// Découpe en morceaux de 20 à 29 s, coupés dans un silence (Whisper traite 30 s au plus à la fois)
function chunks(a) {
  const sr = 16000, max = 29 * sr, min = 20 * sr, fr = 800, out = [];
  let s = 0;
  while (s < a.length) {
    if (a.length - s <= max) { out.push(a.subarray(s)); break; }
    let best = s + max, bestE = Infinity;
    for (let i = s + min; i + fr < s + max; i += fr) {
      let e = 0; for (let j = i; j < i + fr; j++) e += a[j] * a[j];
      if (e < bestE) { bestE = e; best = i + fr / 2; }
    }
    out.push(a.subarray(s, best)); s = best;
  }
  return out;
}
const rms = c => { let e = 0; for (let i = 0; i < c.length; i += 4) e += c[i] * c[i]; return Math.sqrt(e / Math.max(1, c.length / 4)); };
// phrases que Whisper « invente » parfois sur un passage sans parole
const NOISE = /amara\.org|sous-titr|merci d'avoir regard|abonnez-vous/i;

onmessage = async ({ data: m }) => {
  if (!m || m.t !== "run") return;
  const job = m.job;
  try {
    const p = await load(m.model);
    postMessage({ t: "loaded", job });
    const cs = chunks(m.audio);
    const parts = [];
    for (let i = 0; i < cs.length; i++) {
      postMessage({ t: "prog", job, pct: (100 * i) / cs.length });
      if (cs[i].length < 8000 || rms(cs[i]) < 0.003) continue; // silence
      const r = await p(cs[i], { language: "french", task: "transcribe" });
      const txt = String((r && r.text) || "").trim();
      if (txt && !NOISE.test(txt)) parts.push(txt);
    }
    postMessage({ t: "prog", job, pct: 100 });
    postMessage({ t: "done", job, text: parts.join(" ") });
  } catch (e) {
    postMessage({ t: "err", job, msg: String((e && e.message) || e) });
  }
};
