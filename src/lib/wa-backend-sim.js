// src/lib/wa-backend-sim.js
//
// v18.0.0 phase 5b — the SIMULATOR half of the WhatsApp backend client, split
// out of `wa-backend.js`.
//
// **The split is a measurement, not tidiness.** `wa-backend.js` is imported by
// `useWhatsApp.js` — a production hook, always in the entry chunk — AND by the
// simulator, which is lazy. Under Rolldown a module with both audiences lands in
// the ENTRY and keeps the exports the lazy chunks need, so `fetch("/api/wa-sim-
// inbound")`, `/api/wa-sim-suggest` and `/api/wa-sim-generate` all shipped in the
// production bundle. Tree-shaking was never going to remove them: the file
// genuinely had two audiences, and one of them is loaded eagerly.
//
// So the rule this file encodes: **a module the simulator imports must not also
// be imported by production code.** `wa-backend.js` keeps the two seams a real
// restaurant uses (`sendViaBackend`, `recheckViaBackend` — the latter's own
// comment already said it "is NOT a simulator affordance") plus the shared
// flag/URL helpers; everything that talks to an `/api/wa-sim-*` endpoint is here,
// reachable only from `WaSimulator.jsx` and `lib/wa-sim.js`, both of which a
// production build loads through a dead dynamic import.

import { auth } from "../firebase";
// Only the URL. `backendEnabled()` is the CALLER's gate — `wa-sim.js` asks it
// before routing an inbound through here — so importing it would be a second
// place the same question is asked, and lint caught it as dead on arrival.
import { WA_BACKEND_URL } from "./wa-backend";

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

// Online sim inbound: POST one simulated message to the STAFF-AUTH endpoint
// /api/wa-sim-inbound (same-origin on Vercel). Unlike postFakeWebhook this needs
// no HMAC/WA_ALLOW_UNSIGNED — the staff Firebase ID token is the gate. The
// server runs the real pipeline incl. live Gemini parsing.
export async function postSimInbound({ phone, text, name, agoMs = 0 }) {
  const user = auth.currentUser;
  if (!user) throw new Error("not signed in");
  const idToken = await user.getIdToken();
  const res = await fetch(WA_BACKEND_URL + "/api/wa-sim-inbound", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + idToken },
    body: JSON.stringify({ phone, text, name, agoMs }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || ("HTTP " + res.status));
  return data;
}

// Route a simulated inbound through the real pipeline when backend mode is ON:
//   · DEV    → the local harness's unsigned /api/wa-inbound (Meta-shaped payload)
//   · online → the staff-auth /api/wa-sim-inbound (no public-webhook exposure)
// Either way the server parses with Gemini and the draft lands via onValue.
export function backendInbound({ phone, text, name, windowAgeMs = 0 }) {
  return import.meta.env.DEV
    ? postFakeWebhook({ phone, text, name, agoMs: windowAgeMs })
    : postSimInbound({ phone, text, name, agoMs: windowAgeMs });
}

// ✨ Suggest reply (Gemini plays the customer). Same Gemini-stays-server-side
// shape as the pipeline: DEV → the harness's open /dev/customer-reply; online →
// the staff-auth /api/wa-sim-suggest. Returns { text }.
export async function suggestCustomerReply({ language, history }) {
  if (import.meta.env.DEV) {
    const res = await fetch(WA_BACKEND_URL + "/dev/customer-reply", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ language, history }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || ("HTTP " + res.status));
    return data;
  }
  const user = auth.currentUser;
  if (!user) throw new Error("not signed in");
  const idToken = await user.getIdToken();
  const res = await fetch(WA_BACKEND_URL + "/api/wa-sim-suggest", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + idToken },
    body: JSON.stringify({ language, history }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || ("HTTP " + res.status));
  return data;
}
// 🎲 Generate scenario — Gemini invents `count` varied inbound messages and the
// server injects each as a fresh conversation (live parse). Staff-auth, same
// endpoint DEV (via harness) and online. Returns { generated, samples }.
export async function generateScenario({ hint, count } = {}) {
  const user = auth.currentUser;
  if (!user) throw new Error("not signed in");
  const idToken = await user.getIdToken();
  const res = await fetch(WA_BACKEND_URL + "/api/wa-sim-generate", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + idToken },
    body: JSON.stringify({ hint: hint || "", count: count || 1 }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || ("HTTP " + res.status));
  return data;
}
