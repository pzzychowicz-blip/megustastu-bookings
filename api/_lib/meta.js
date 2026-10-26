// api/_lib/meta.js
//
// WhatsApp backend — the Meta Cloud API edge: webhook signature verification
// and outbound message sending. Everything Meta-specific lives here so the
// handlers stay readable and the mock mode has one switch point.
//
// SEND MODES (env WA_SEND_MODE):
//   mock (default) — no network. Returns a fake wamid and status "delivered".
//                    This is the sandbox mode until the number is migrated.
//   live           — POST to graph.facebook.com/v26.0/{PHONE_NUMBER_ID}/messages
//                    with the Cloud API bearer token. Returns the real wamid;
//                    status starts "sent" and advances via webhook statuses[].
//
// SIGNATURE: Meta signs every webhook POST with X-Hub-Signature-256 =
// "sha256=" + HMAC_SHA256(app_secret, raw_body). verifySignature() compares
// constant-time. WA_ALLOW_UNSIGNED=1 (local harness only) skips it so curl /
// the Sim panel can post without computing HMACs.

import crypto from "node:crypto";
import { env, sendMode, allowUnsigned } from "./env.js";
import { mockMediaId } from "../../src/lib/wa-mock-media.js";

// v18.3.1: v21.0 → v26.0 (shipped 2026-07-29). Meta removes v21.0 on
// 21 January 2027. The one call made here (a text message to /messages) has
// no documented breaking change across 22–26; the v24 change to the status
// webhook's `conversation` object touches nothing wa-inbound.js reads
// (recipient_id, id, status). The WEBHOOK's version is set in the Meta app
// dashboard, not here. Unexercised until go-live: WA_SEND_MODE is mock.
// v18.9.0: exported, because the /wa-connect page initialises Meta's JS SDK
// with the same version (api/wa-onboard.js hands it over): two copies of a
// version are a version waiting to disagree.
export const GRAPH_VERSION = "v26.0";

// rawBody: Buffer|string of the EXACT bytes received (HMAC is byte-sensitive).
export function verifySignature(rawBody, signatureHeader) {
  if (allowUnsigned()) return true;
  const secret = env("META_APP_SECRET", null);
  if (!secret || !signatureHeader || !signatureHeader.startsWith("sha256=")) return false;
  const expected = "sha256=" + crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signatureHeader);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function liveConfig() {
  const token = env("META_WA_TOKEN", null);
  const phoneNumberId = env("META_PHONE_NUMBER_ID", null);
  if (!token || !phoneNumberId) {
    throw new Error("WA_SEND_MODE=live but META_WA_TOKEN / META_PHONE_NUMBER_ID are not configured.");
  }
  return { token, phoneNumberId };
}

// The ONE call that puts a message in front of a customer: POST /messages.
// A text and a photo with its caption each make exactly one (checklist A4-5,
// pinned in tests/api-handlers.test.js); an upload is not a message.
//
// v18.12.0: `simulated` — the conversation is the sandbox simulator's (`sim`
// on the conversation, stamped where the simulator creates one), so its phone
// is made up and may belong to a real person. It sends as mock mode does,
// whatever WA_SEND_MODE says: once the sandbox sends from a real number (the
// rehearsal, R-15), a reply to a simulator chat would otherwise reach whoever
// owns that number. One flag, at the one function that sends.
//
// **The flag is REQUIRED (/code-review).** Every caller passes
// `{ simulated: isSimConversation(conv) }`, and a call that does not say is
// refused (`simulatedOf`) rather than read as "not simulated": a new send path
// that forgot it would otherwise send a simulator chat to Meta with no test
// failing. The refusal rejects, so it reaches the caller's own send-failed path.
export function simulatedOf(opts) {
  const v = opts && opts.simulated;
  if (typeof v !== "boolean") {
    throw new TypeError("a send must say whether the conversation is the simulator's: pass { simulated: isSimConversation(conv) }");
  }
  return v;
}
async function postMessage(phoneE164, payload, opts) {
  const simulated = simulatedOf(opts);
  if (sendMode() === "mock" || simulated) {
    const wamid = "wamid.MOCK." + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    return { wamid, status: "delivered" };
  }
  const { token, phoneNumberId } = liveConfig();
  const url = "https://graph.facebook.com/" + GRAPH_VERSION + "/" + phoneNumberId + "/messages";
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: JSON.stringify(Object.assign({
      messaging_product: "whatsapp",
      to: String(phoneE164).replace(/^\+/, ""),
    }, payload)),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (data && data.error && data.error.message) || ("Graph API error " + res.status);
    throw new Error(msg);
  }
  const wamid = data && data.messages && data.messages[0] && data.messages[0].id;
  return { wamid: wamid || null, status: "sent" };
}

// sendText(phoneE164, text) → { wamid, status }
// phoneE164: "+34600..." (Cloud API wants digits without "+", handled here).
// opts.simulated — required, see postMessage.
export function sendText(phoneE164, text, opts) {
  return postMessage(phoneE164, { type: "text", text: { body: text } }, opts);
}

// ── Media the restaurant sends (v18.8.0) ─────────────────────────────────────
// Two calls, one message: the file is uploaded to the number's media store
// (`POST /{phone-number-id}/media`, multipart), and the id that comes back is
// sent with the caption INSIDE the message, so a caption never becomes a
// second message. Meta keeps an uploaded file 30 days.
//
// In mock mode nothing leaves: the id is `MOCK.<kind>.<random>` (`mockMediaId`,
// shared with the simulator), which api/wa-media.js answers with its bundled
// sample while the mode is mock.
// v18.12.0: `opts.simulated` (required, see postMessage) uploads nothing, as mock mode.
export async function uploadMedia(bytes, mime, filename, kind, opts) {
  const simulated = simulatedOf(opts);
  if (sendMode() === "mock" || simulated) return mockMediaId(kind);
  const { token, phoneNumberId } = liveConfig();
  const form = new FormData();
  form.append("messaging_product", "whatsapp");
  form.append("type", mime);
  form.append("file", new Blob([bytes], { type: mime }), filename || (kind === "document" ? "document.pdf" : "photo.jpg"));
  const res = await fetch("https://graph.facebook.com/" + GRAPH_VERSION + "/" + phoneNumberId + "/media", {
    method: "POST",
    headers: { Authorization: "Bearer " + token },
    body: form,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data || typeof data.id !== "string") throw graphError(res, data);
  return data.id;
}

// sendMedia(phoneE164, {kind, mediaId, caption, filename}) → { wamid, status }
export function sendMedia(phoneE164, { kind, mediaId, caption, filename }, opts) {
  const body = { id: mediaId };
  if (caption) body.caption = caption;
  if (kind === "document" && filename) body.filename = filename;
  return postMessage(phoneE164, { type: kind, [kind]: body }, opts);
}

// ── Media a customer sent (v18.8.0) ──────────────────────────────────────────
// Meta keeps the FILE, this app keeps only its id (a message's `media`). To
// show it: `GET /{media-id}` answers a short-lived URL plus the type and size,
// and that URL answers the bytes, asked with the SAME bearer. Both calls need
// the token whatever WA_SEND_MODE says: viewing a real customer's photo is not
// a send, and in mock mode there is no real id to view (api/wa-media.js serves
// its bundled samples for the simulator's `MOCK.` ids instead).
//
// A failed call throws with `.status` = Meta's HTTP status, so the caller can
// tell "gone" (4xx: Meta keeps a received file 7 days) from "Meta is down".
function mediaToken() {
  const token = env("META_WA_TOKEN", null);
  if (!token) { const e = new Error("META_WA_TOKEN is not configured."); e.status = 503; e.config = true; throw e; }
  return token;
}
function graphError(res, data) {
  const e = new Error((data && data.error && data.error.message) || ("Graph API error " + res.status));
  e.status = res.status;
  return e;
}
export async function mediaInfo(mediaId) {
  const token = mediaToken();
  const res = await fetch("https://graph.facebook.com/" + GRAPH_VERSION + "/" + encodeURIComponent(mediaId), {
    headers: { Authorization: "Bearer " + token },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw graphError(res, data);
  const size = Number(data.file_size);
  return {
    url: typeof data.url === "string" ? data.url : "",
    mime: typeof data.mime_type === "string" ? data.mime_type : "",
    size: Number.isFinite(size) && size > 0 ? size : null,
  };
}
// The bearer goes only to a host Meta serves media from. The URL comes out of
// Meta's own answer, so this is belt and braces: a token sent to a host taken
// from a response is a token handed to whoever controls that response. If Meta
// moves its media hosts, viewing fails loudly (502) and this list is the fix.
const MEDIA_HOSTS = ["fbsbx.com", "facebook.com", "fbcdn.net", "whatsapp.net"];
export function isMediaHost(url) {
  let u;
  try { u = new URL(url); } catch { return false; }
  if (u.protocol !== "https:") return false;
  return MEDIA_HOSTS.some((h) => u.hostname === h || u.hostname.endsWith("." + h));
}
// The Response itself, so the caller can stream its body without holding it.
export async function downloadMedia(url) {
  const token = mediaToken();
  if (!isMediaHost(url)) { const e = new Error("unexpected media host"); e.status = 502; throw e; }
  const res = await fetch(url, { headers: { Authorization: "Bearer " + token } });
  if (!res.ok) throw graphError(res, null);
  return res;
}

// ── Embedded Signup (v18.9.0, api/wa-onboard.js) ────────────────────────────
// The calls that connect a WhatsApp Business app number to this app. Each one
// takes its bearer as an ARGUMENT: at onboarding it is the business token the
// signup code was exchanged for, which is never stored or returned, so it is
// handed down rather than read from the environment. A retry later uses
// META_WA_TOKEN, passed the same way. None of these looks at WA_SEND_MODE:
// connecting a number is not a send, and there is nothing to mock it with.
//
// A failure throws with `.status` (graphError), Meta's message as the text.
async function graphJson(method, path, token, body) {
  const headers = { Authorization: "Bearer " + token };
  if (body) headers["Content-Type"] = "application/json";
  const res = await fetch("https://graph.facebook.com/" + GRAPH_VERSION + "/" + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw graphError(res, data);
  return data || {};
}

// The code Embedded Signup returns lives 30 seconds. POSTed as a form, so the
// app secret travels in a body and never in a URL a log could keep.
export async function exchangeCode(code, appId, appSecret) {
  const res = await fetch("https://graph.facebook.com/" + GRAPH_VERSION + "/oauth/access_token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: appId, client_secret: appSecret, code }).toString(),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data || typeof data.access_token !== "string" || !data.access_token) throw graphError(res, data);
  return data.access_token;
}

// Without this the account sends this app no webhooks at all.
export function subscribeApp(wabaId, token) {
  return graphJson("POST", wabaId + "/subscribed_apps", token);
}

// `smb_app_state_sync` (the phone's contacts) or `history` (its chats). Meta
// allows each once, within 24 hours of onboarding; the answer is a request id,
// and the data arrives later as webhooks.
export async function requestSmbSync(phoneNumberId, syncType, token) {
  const data = await graphJson("POST", phoneNumberId + "/smb_app_data", token, {
    messaging_product: "whatsapp",
    sync_type: syncType,
  });
  return typeof data.request_id === "string" ? data.request_id : null;
}

// v18.10.0: the cost counter's one call. The account's currency and Meta's
// daily pricing breakdown between two UNIX times (seconds), by category and
// type (`src/lib/wa-usage.js` reads the answer). Daily rather than monthly so
// each bucket can be filed under a calendar month by its own middle, whatever
// timezone the account counts its days in.
export function pricingAnalytics(wabaId, startS, endS, token) {
  const fields = "currency,pricing_analytics.start(" + startS + ").end(" + endS + ")"
    + ".granularity(DAILY).dimensions(PRICING_CATEGORY,PRICING_TYPE)";
  return graphJson("GET", wabaId + "?fields=" + fields, token);
}

// Is the number on the Business app, and on which platform? The last check of
// an onboarding: a coexistence number answers `is_on_biz_app: true`.
export async function phoneInfo(phoneNumberId, token) {
  const data = await graphJson("GET", phoneNumberId + "?fields=is_on_biz_app,platform_type", token);
  return {
    isOnBizApp: data.is_on_biz_app === true,
    platformType: typeof data.platform_type === "string" ? data.platform_type : null,
  };
}
