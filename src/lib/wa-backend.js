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

import { auth } from "../firebase";

export const WA_BACKEND_URL = "http://localhost:3999";
const FLAG_KEY = "mgt-wa-backend";

export function backendEnabled() {
  if (!import.meta.env.DEV) return false;
  try { return localStorage.getItem(FLAG_KEY) === "1"; } catch (e) { return false; }
}
export function setBackendEnabled(on) {
  try { on ? localStorage.setItem(FLAG_KEY, "1") : localStorage.removeItem(FLAG_KEY); } catch (e) {}
}

// Liveness + mode report from the harness (null when it isn't running).
export async function backendHealth() {
  try {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 1500);
    const res = await fetch(WA_BACKEND_URL + "/health", { signal: ac.signal });
    clearTimeout(t);
    return res.ok ? await res.json() : null;
  } catch (e) { return null; }
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

// Wrap one inbound message in the Meta Cloud API webhook shape and POST it to
// the local /api/wa-inbound — the client-side mirror of
// scripts/wa-webhook-samples.mjs::textMessagePayload. `agoMs` back-dates the
// message (unix-seconds timestamp), e.g. to simulate an expired 24h window.
export async function postFakeWebhook({ phone, text, name, agoMs = 0 }) {
  const waId = String(phone).replace(/^\+/, "");
  const payload = {
    object: "whatsapp_business_account",
    entry: [{
      id: "WABA_ID_LOCAL_SIM",
      changes: [{
        field: "messages",
        value: {
          messaging_product: "whatsapp",
          metadata: { display_phone_number: "34600000000", phone_number_id: "PHONE_NUMBER_ID_LOCAL_SIM" },
          contacts: [{ wa_id: waId, profile: { name: name || "Sim Customer" } }],
          messages: [{
            from: waId,
            id: "wamid.LOCALSIM." + Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
            timestamp: String(Math.floor((Date.now() - agoMs) / 1000)),
            type: "text",
            text: { body: text },
          }],
        },
      }],
    }],
  };
  const res = await fetch(WA_BACKEND_URL + "/api/wa-inbound", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || ("HTTP " + res.status));
  return data;
}
