// api/wa-media.js
//
// WhatsApp backend — a conversation's photos, voice notes and documents
// (v18.8.0). ONE function for both directions, to keep the function count low:
//
//   GET  ?phoneKey&msgId   the file of a stored message, streamed back
//   POST                   send a photo or a PDF (phase 5)
//
// Authorization: Bearer <Firebase ID token>, as every staff endpoint.
//
// ── GET: viewing ─────────────────────────────────────────────────────────────
// Meta keeps the file and this app keeps its id (`media.mediaId` on the
// message, written by api/wa-inbound.js). Guards, in order:
//   405 — any other method
//   401 / 403 / 503 — the staff gate (`staffAuthError`, shared with wa-send)
//   400 — no usable phoneKey or msgId
//   404 — no such message, or a message with no media
//   410 — the file is gone: Meta answers 4xx (it keeps a received file 7 days,
//         a sent one 30), or a simulator id on a deployment no longer in mock
//   413 — larger than MEDIA_VIEW_MAX (the browser holds the whole file)
//   502 — Meta failed otherwise
//
// **The media id is read from the database, never from the request.** The
// browser names a MESSAGE; the id goes into a Graph path with the
// restaurant's token on it, so one taken from a query string would let any
// signed-in account fetch any media the token can reach.
//
// **Streamed, not buffered.** Vercel caps a function's request and response
// body at 4.5 MB; its guide on the limit says a streamed response does not have
// it. A photo is under 5 MB, a voice note usually far under, a document up to
// 100 MB, so the bytes are piped through as they arrive and the cap here is
// the browser's, not Vercel's. The real 4.5 MB measurement is a sandbox step
// after merge (the plan's A5-6).
//
// **What may be opened inline.** A customer chooses what they send. The file is
// handed to the page as a blob URL on THIS origin, and opened in a new tab for a
// document, so an HTML or SVG file opened there would run as the app. Only the
// types in INLINE_TYPES keep their type; everything else is served as
// `application/octet-stream` with `attachment`, which the client saves instead
// of opening (MessageBubble asks `opensInline` too).
//
// ── Mock media ───────────────────────────────────────────────────────────────
// The simulator's ids are `MOCK.<kind>.<id>`. While WA_SEND_MODE is mock, a
// MOCK id is answered with a bundled sample (`_lib/mock-media/`: a photo, an
// Ogg/Opus voice note, a one-page PDF), so the whole path can be run on DEV
// without a Meta token. On a live deployment a MOCK id is 410: there is no file.

import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { readFile } from "node:fs/promises";
import { sendMode } from "./_lib/env.js";
import { verifyStaffToken, staffAuthError, getMessage } from "./_lib/rtdb.js";
import { mediaInfo, downloadMedia } from "./_lib/meta.js";
import { isPhoneKey, sanitizeMedia } from "../src/lib/whatsapp.js";

export const config = { api: { bodyParser: false } };

// The most a browser is handed in one blob: Meta's own cap on a voice note or a
// video, above every photo (5 MB). A larger document is "open WhatsApp on the
// phone", which is where a 40 MB PDF is better read anyway.
export const MEDIA_VIEW_MAX = 16 * 1024 * 1024;

// Types a browser may render from a blob URL on this origin without running
// anything: pictures (no SVG), audio, PDF, plain text.
export const INLINE_TYPES = [
  "image/jpeg", "image/png", "image/webp", "image/gif",
  "audio/ogg", "audio/mpeg", "audio/mp4", "audio/aac", "audio/amr", "audio/opus",
  "application/pdf", "text/plain",
];
export function servedType(mime) {
  const base = String(mime || "").split(";")[0].trim().toLowerCase();
  return INLINE_TYPES.includes(base) ? String(mime).trim() : "application/octet-stream";
}

// Static URLs, one per kind, so the deployment's file tracing sees each file.
const SAMPLES = {
  image: { url: new URL("./_lib/mock-media/photo.jpg", import.meta.url), type: "image/jpeg" },
  audio: { url: new URL("./_lib/mock-media/voice.ogg", import.meta.url), type: "audio/ogg; codecs=opus" },
  document: { url: new URL("./_lib/mock-media/menu.pdf", import.meta.url), type: "application/pdf" },
};

const MSG_ID_RE = /^[A-Za-z0-9_-][A-Za-z0-9._-]{0,255}$/;

async function staffFrom(req, res) {
  const authHeader = req.headers["authorization"] || "";
  const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!idToken) { res.status(401).json({ error: "missing token" }); return null; }
  try {
    return await verifyStaffToken(idToken);
  } catch (e) {
    const f = staffAuthError(e);
    res.status(f.status).json({ error: f.error });
    return null;
  }
}

// RFC 6266 / 5987: a name that is safe in a header whatever the customer typed
// (control characters are already gone, sanitizeMedia).
function disposition(kind, filename) {
  if (!filename) return kind;
  return kind + "; filename*=UTF-8''" + encodeURIComponent(filename);
}

function head(res, type, extra) {
  res.statusCode = 200;
  res.setHeader("Content-Type", type);
  res.setHeader("Cache-Control", "private, max-age=86400");
  res.setHeader("X-Content-Type-Options", "nosniff");
  Object.keys(extra || {}).forEach((k) => res.setHeader(k, extra[k]));
}

async function view(req, res) {
  if (!(await staffFrom(req, res))) return;
  const q = req.query || {};
  const phoneKey = typeof q.phoneKey === "string" ? q.phoneKey : "";
  const msgId = typeof q.msgId === "string" ? q.msgId : "";
  if (!isPhoneKey(phoneKey) || !MSG_ID_RE.test(msgId)) {
    res.status(400).json({ error: "phoneKey and msgId are required" });
    return;
  }
  const msg = await getMessage(phoneKey, msgId);
  const media = msg ? sanitizeMedia(msg.media) : null;
  if (!media) { res.status(404).json({ error: msg ? "this message has no media" : "message not found" }); return; }
  const filename = media.filename || "";

  if (media.mediaId.startsWith("MOCK.")) {
    if (sendMode() !== "mock") { res.status(410).json({ error: "a simulator file — not available on this deployment" }); return; }
    const sample = SAMPLES[media.kind];
    const bytes = await readFile(sample.url);
    head(res, sample.type, { "Content-Disposition": disposition("inline", filename) });
    res.end(bytes);
    return;
  }

  let info;
  try {
    info = await mediaInfo(media.mediaId);
  } catch (e) {
    if (e.config) { res.status(503).json({ error: e.message }); return; }
    if (e.status >= 400 && e.status < 500) { res.status(410).json({ error: "no longer on WhatsApp's servers" }); return; }
    console.error("[wa-media] media lookup failed:", e.message);
    res.status(502).json({ error: "could not reach WhatsApp" });
    return;
  }
  if (info.size && info.size > MEDIA_VIEW_MAX) { res.status(413).json({ error: "too large to open here" }); return; }

  let up;
  try {
    up = await downloadMedia(info.url);
  } catch (e) {
    if (e.status >= 400 && e.status < 500) { res.status(410).json({ error: "no longer on WhatsApp's servers" }); return; }
    console.error("[wa-media] media download failed:", e.message);
    res.status(502).json({ error: "could not reach WhatsApp" });
    return;
  }
  const len = Number(up.headers.get("content-length"));
  if (Number.isFinite(len) && len > MEDIA_VIEW_MAX) { res.status(413).json({ error: "too large to open here" }); return; }

  const type = servedType(info.mime || media.mime || up.headers.get("content-type"));
  const inline = type !== "application/octet-stream";
  head(res, type, { "Content-Disposition": disposition(inline ? "inline" : "attachment", filename) });
  if (!up.body) { res.end(); return; }
  try {
    await pipeline(Readable.fromWeb(up.body), res);
  } catch (e) {
    // The status line has gone out; all that is left is to stop.
    console.error("[wa-media] stream broke:", e && e.message);
    res.destroy(e);
  }
}

export default async function handler(req, res) {
  if (req.method === "GET") { await view(req, res); return; }
  res.status(405).json({ error: "method not allowed" });
}
