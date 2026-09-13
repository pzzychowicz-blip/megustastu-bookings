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
