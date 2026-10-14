// src/lib/wa-backend.js
//
// WhatsApp sandbox — CLIENT side of the local Phase-1b backend (the api/
// functions served by scripts/wa-backend-dev.mjs on :3999). DEV-only, like
// every simulator surface: backendEnabled() is hard-false in a production
// build, so all of this is dead-code-eliminated there.
//
// Backend mode is a per-device localStorage flag, toggled in the Sim panel.
// When ON:
//   · the Sim panel / __waSim scenarios stop writing Firebase client-side and
//     instead POST a Meta-shaped webhook payload to /api/wa-inbound — the REAL
//     pipeline runs (HMAC-exempt locally, LLM parse, keyed RTDB writes) and the
//     app sees the result through its normal onValue listeners;
//   · the composer's handleSendReply POSTs /api/wa-send with the staff's
//     Firebase ID token instead of mocking the send client-side.
//
// NB in backend mode a scenario's pre-baked `parse` and `acceptedBookingId`
// are intentionally IGNORED — the server runs its own (mock or live Gemini)
// parse, like production will. Linked cancel/modify scenarios therefore only
// link when the conversation already carries acceptedBookingId from a prior
// accept. That asymmetry is the point: backend mode tests the real pipeline.
//
// v18.0.0 phase 5b: the five functions that call an `/api/wa-sim-*` endpoint
// moved to `wa-backend-sim.js`. See that file's header — they shipped in the
// production entry chunk because THIS module has two audiences and one of them
// (useWhatsApp) is eager. Keep it that way: nothing here may import the sim half.

import { auth } from "../firebase";
import { WA_SANDBOX } from "./waSandbox";

// Where the real pipeline lives:
//   · DEV (dev server)     → the local harness on :3999
//   · deployed sandbox     → same-origin ("") so /api/* hits the Vercel functions
export const WA_BACKEND_URL = import.meta.env.DEV ? "http://localhost:3999" : "";
const FLAG_KEY = "mgt-wa-backend";

// Backend mode is available wherever the sandbox surfaces are (dev server OR a
// deployed sandbox build) — online it routes through the staff-auth sim endpoint
// (see backendInbound), so no public-webhook exposure.
// ── Does a send go through the SERVER? (v18.0.0 phase 5 review) ─────────────
// `backendEnabled()` below answers a different question from the one the send
// path needs, and conflating them meant production could not send at all.
//
// It is a SANDBOX developer toggle: "has someone flipped backend mode on in the
// Sim panel", and it is hard-false outside the sandbox. `handleSendReply` used
// it to choose between the server and a CLIENT-SIDE MOCK that appends the
// message locally and flips it to "delivered" after 800ms — so in production,
// where the flag can never be true, every staff reply was mocked and reported
// as delivered to a guest who received nothing.
//
// The two questions, kept apart:
//   · backendEnabled()    — sandbox only: am I testing against the real pipeline?
//   · sendsViaServer()    — is there a real provider at the other end at all?
//
// Production is ALWAYS the second. What it actually sends is then the SERVER's
// decision: `WA_SEND_MODE` defaults to "mock" in `api/_lib/env.js`, so a
// deployment that has not been configured still sends nothing — but it says so,
// through `/api/wa-send`'s response, instead of the client inventing a delivery
// receipt. An honest failure beats a false success, and this is the path that
// reaches a real customer.
export function sendsViaServer() {
  return !WA_SANDBOX || backendEnabled();
}

export function backendEnabled() {
  if (!WA_SANDBOX) return false;
  try { return localStorage.getItem(FLAG_KEY) === "1"; } catch { return false; }
}
export function setBackendEnabled(on) {
  try { on ? localStorage.setItem(FLAG_KEY, "1") : localStorage.removeItem(FLAG_KEY); } catch { /* ignore */ }
}

// Liveness + mode report from the harness (null when it isn't running).
// Hard no-op off the dev server: the harness only exists at :3999 on the local
// machine, so in a deployed sandbox this would just throw ERR_CONNECTION_REFUSED
// into the console on every panel open. Online the simulator runs client-side.
export async function backendHealth() {
  if (!import.meta.env.DEV) return null;
  try {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 1500);
    const res = await fetch(WA_BACKEND_URL + "/health", { signal: ac.signal });
    clearTimeout(t);
    return res.ok ? await res.json() : null;
  } catch { return null; }
}

// Staff reply through the real endpoint. Throws with a readable message on
// any failure (caller surfaces it via setWriteWarning).
export async function sendViaBackend(phoneKey, text) {
  const user = auth.currentUser;
  if (!user) throw new Error("not signed in");
  const idToken = await user.getIdToken();
  const res = await fetch(WA_BACKEND_URL + "/api/wa-send", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + idToken },
    body: JSON.stringify({ phoneKey, text }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || ("HTTP " + res.status));
  return data;
}


// Manual re-check — ask the server to re-read the conversation's recent thread
// and re-run the LLM classification (api/wa-recheck). Unlike every other seam
// here this is NOT a simulator affordance: it is a real staff feature, so it
// always targets the server rather than gating on backendEnabled() — in
// production the backend is simply always there. Locally that means the :3999
// harness has to be running, hence the explicit hint on a connection failure
// (the bare "Failed to fetch" reads as a bug rather than a missing process).
// Returns { intent, updated } — the server has already applied the parse.
export async function recheckViaBackend(phoneKey) {
  const user = auth.currentUser;
  if (!user) throw new Error("not signed in");
  const idToken = await user.getIdToken();
  let res;
  try {
    res = await fetch(WA_BACKEND_URL + "/api/wa-recheck", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + idToken },
      body: JSON.stringify({ phoneKey }),
    });
  } catch {
    throw new Error(import.meta.env.DEV ? "backend not running (npm run wa:backend)" : "could not reach the server");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || ("HTTP " + res.status));
  return data;
}

// ── A message's photo, voice note or document (v18.8.0) ─────────────────────
// `GET /api/wa-media` streams the file Meta holds; it needs the staff token, so
// an <img src> cannot ask for it. `fetchMedia` fetches it once, turns it into a
// blob URL and keeps it per message, so the bubble's thumbnail and the photo
// viewer share one download. Every `fetchMedia` takes a reference and every
// `releaseMedia` gives one back; the URL is revoked a while after the last one
// is given back (`MEDIA_KEEP_MS`), which keeps it across a thread reopened a
// moment later and across StrictMode's mount, unmount, mount in DEV.
//
// A failure rejects with `.kind`: "expired" (410: Meta no longer has it),
// "toolarge" (413) or "error" (anything else, retryable). A failed entry is
// dropped at once, so the next fetch is a real retry.
export const MEDIA_KEEP_MS = 60 * 1000;
const mediaCache = new Map();

function mediaError(kind, message) {
  const e = new Error(message);
  e.kind = kind;
  return e;
}

async function loadMedia(phoneKey, msgId) {
  const user = auth.currentUser;
  if (!user) throw mediaError("error", "not signed in");
  const idToken = await user.getIdToken();
  let res;
  try {
    res = await fetch(WA_BACKEND_URL + "/api/wa-media?phoneKey=" + encodeURIComponent(phoneKey) + "&msgId=" + encodeURIComponent(msgId), {
      headers: { Authorization: "Bearer " + idToken },
    });
  } catch {
    throw mediaError("error", import.meta.env.DEV ? "backend not running (npm run wa:backend)" : "could not reach the server");
  }
  if (res.status === 410) throw mediaError("expired", "no longer on WhatsApp's servers");
  if (res.status === 413) throw mediaError("toolarge", "too large to open here");
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw mediaError("error", data.error || ("HTTP " + res.status));
  }
  const blob = await res.blob();
  return { url: URL.createObjectURL(blob), type: blob.type || res.headers.get("content-type") || "" };
}

export function fetchMedia(phoneKey, msgId) {
  const key = phoneKey + "/" + msgId;
  let e = mediaCache.get(key);
  if (!e) {
    e = { refs: 0, timer: null, value: null };
    e.promise = loadMedia(phoneKey, msgId).then(
      // Released and dropped while still loading: nobody holds it, so revoke now.
      function (v) { e.value = v; if (mediaCache.get(key) !== e) URL.revokeObjectURL(v.url); return v; },
      function (err) { if (mediaCache.get(key) === e) mediaCache.delete(key); throw err; },
    );
    mediaCache.set(key, e);
  }
  if (e.timer) { clearTimeout(e.timer); e.timer = null; }
  e.refs++;
  return e.promise;
}

export function releaseMedia(phoneKey, msgId) {
  const key = phoneKey + "/" + msgId;
  const e = mediaCache.get(key);
  if (!e || e.refs <= 0) return;
  e.refs--;
  if (e.refs > 0 || e.timer) return;
  e.timer = setTimeout(function () {
    if (mediaCache.get(key) !== e || e.refs > 0) return;
    mediaCache.delete(key);
    if (e.value) URL.revokeObjectURL(e.value.url);
  }, MEDIA_KEEP_MS);
}

// What a browser may open from a blob URL on this origin — the server's list
// (api/wa-media.js INLINE_TYPES) less audio, which plays in the bubble. Anything
// else is saved, never opened: an HTML or SVG file opened here runs as the app.
const OPENS_INLINE = ["application/pdf", "image/jpeg", "image/png", "image/webp", "image/gif", "text/plain"];
export function opensInline(type) {
  return OPENS_INLINE.includes(String(type || "").split(";")[0].trim().toLowerCase());
}
