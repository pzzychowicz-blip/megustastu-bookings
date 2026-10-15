// src/lib/wa-connect.js — the /wa-connect page's decisions (v18.9.0).
//
// The page (src/wa-connect/ConnectPage.jsx) runs Meta's Embedded Signup for a
// number that stays on the WhatsApp Business app ("coexistence"), then hands
// the result to api/wa-onboard.js. What it calls FB.login with, which window
// message is Embedded Signup's and what that message says, and the words for
// each server step are decided here, pure, so a test can ask them: the page
// cannot be exercised for real anywhere but an https deployment that Meta's
// app lists as an allowed domain.

// Meta's JS SDK. The page loads it on demand, and only this page's CSP
// (vercel.json) lets it run; the app's own CSP does not.
export const FB_SDK_URL = "https://connect.facebook.net/en_US/sdk.js";

// The ids Meta hands back, as the server checks them (api/wa-onboard.js).
const META_ID_RE = /^[0-9]{5,25}$/;

// FB.login's options for a Business app (coexistence) signup, per Meta's
// "Onboard WhatsApp Business app users" page (read 2026-10-15). The `extras`
// shape is to be confirmed in the rehearsal with the App Dashboard's Embedded
// Signup Builder ("Check a launch config"): Meta's Versions page calls v4's
// extras "purposely empty", and the coexistence page shows `featureType`.
export function loginOptions(configId) {
  return {
    config_id: configId,
    response_type: "code",
    override_default_response_type: true,
    extras: { setup: {}, featureType: "whatsapp_business_app_onboarding", sessionInfoVersion: "3" },
  };
}

// What one window `message` event says, or null when it is not Embedded
// Signup's. Any page can post a message to this one, so only an https
// facebook.com origin is read, and its ids are checked as the server checks
// them.
//   { kind: "finish", wabaId, phoneNumberId }   the number is connected
//   { kind: "cancel", step }                     closed part-way
//   { kind: "error", message }                   Meta's error, or a signup
//                                                this page does not complete
export function signupMessage(origin, data) {
  let host = "";
  try {
    const u = new URL(origin);
    if (u.protocol !== "https:") return null;
    host = u.hostname;
  } catch { return null; }
  if (host !== "facebook.com" && !host.endsWith(".facebook.com")) return null;
  let d = data;
  if (typeof d === "string") { try { d = JSON.parse(d); } catch { return null; } }
  if (!d || typeof d !== "object" || d.type !== "WA_EMBEDDED_SIGNUP") return null;
  const info = d.data && typeof d.data === "object" ? d.data : {};
  const event = typeof d.event === "string" ? d.event : "";
  if (event === "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING") {
    const wabaId = String(info.waba_id == null ? "" : info.waba_id);
    const phoneNumberId = String(info.phone_number_id == null ? "" : info.phone_number_id);
    if (!META_ID_RE.test(wabaId) || !META_ID_RE.test(phoneNumberId)) {
      return { kind: "error", message: "Meta finished, but did not say which account and number were connected." };
    }
    return { kind: "finish", wabaId, phoneNumberId };
  }
  if (event === "CANCEL") {
    if (info.error_message) return { kind: "error", message: String(info.error_message) };
    return { kind: "cancel", step: typeof info.current_step === "string" ? info.current_step : "" };
  }
  if (event === "ERROR") return { kind: "error", message: String(info.error_message || "Meta reported an error.") };
  // FINISH, FINISH_ONLY_WABA: a signup for a number that LEAVES the Business
  // app (or for no number). MGT needs the phone to keep it; nothing here
  // registers a number, so it is refused rather than half-connected.
  if (event.indexOf("FINISH") === 0) {
    return { kind: "error", message: "Meta finished a different kind of signup (" + event + "). This page connects a number that stays on the WhatsApp Business app, so nothing was connected." };
  }
  return null;
}

// The server's steps (api/wa-onboard.js), in its order, in words.
export const CONNECT_STEPS = [
  { id: "exchange", label: "Sign-in code exchanged with Meta" },
  { id: "link", label: "Connection recorded in MGT" },
  { id: "subscribe", label: "MGT subscribed to the number's messages", retry: true },
  { id: "contacts", label: "The phone's contacts asked for", retry: true },
  { id: "history", label: "The phone's chat history asked for", retry: true },
  { id: "phone", label: "Number checked on the WhatsApp Business app", retry: true },
];

// A retry's answer folded into the steps shown: the retried step replaced,
// every other one kept.
export function mergeSteps(steps, retried) {
  const byId = {};
  (retried || []).forEach(function (s) { byId[s.id] = s; });
  return (steps || []).map(function (s) { return byId[s.id] || s; });
}

// The one sentence for the server's answer: the result's heading, and what
// the page's hidden status region says when the answer lands. "Connected"
// needs the link step: without it no webhook from the number is accepted.
export function resultHeadline(steps) {
  const list = steps || [];
  if (list.length > 0 && list.every(function (s) { return s.ok; })) return "Connected.";
  return list.some(function (s) { return s.id === "link" && s.ok; }) ? "Connected, with a step to finish." : "Not connected.";
}

// What the status region says after a Try again: how the step went, then
// the headline over every step as they now stand. A step that succeeds takes
// its button (and the focus on it) away, so this is the only place a screen
// reader hears that it worked.
export function retryAnnouncement(id, retried, merged) {
  const def = CONNECT_STEPS.find(function (d) { return d.id === id; });
  const s = (retried || []).find(function (x) { return x.id === id; });
  return (def ? def.label : id) + (s && s.ok ? ": done. " : ": failed again. ") + resultHeadline(merged);
}
