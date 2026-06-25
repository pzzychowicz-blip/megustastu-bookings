// api/_lib/meta.js
//
// WhatsApp backend — the Meta Cloud API edge: webhook signature verification
// and outbound message sending. Everything Meta-specific lives here so the
// handlers stay readable and the mock mode has one switch point.
//
// SEND MODES (env WA_SEND_MODE):
//   mock (default) — no network. Returns a fake wamid and status "delivered".
//                    This is the sandbox mode until the number is migrated.
//   live           — POST to graph.facebook.com/v21.0/{PHONE_NUMBER_ID}/messages
//                    with the Cloud API bearer token. Returns the real wamid;
//                    status starts "sent" and advances via webhook statuses[].
//
// SIGNATURE: Meta signs every webhook POST with X-Hub-Signature-256 =
// "sha256=" + HMAC_SHA256(app_secret, raw_body). verifySignature() compares
// constant-time. WA_ALLOW_UNSIGNED=1 (local harness only) skips it so curl /
// the Sim panel can post without computing HMACs.

import crypto from "node:crypto";
import { env, sendMode, allowUnsigned } from "./env.js";

const GRAPH_VERSION = "v21.0";

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

// sendText(phoneE164, text) → { wamid, status }
// phoneE164: "+34600..." (Cloud API wants digits without "+", handled here).
export async function sendText(phoneE164, text) {
  if (sendMode() === "mock") {
    const wamid = "wamid.MOCK." + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    return { wamid, status: "delivered" };
  }
  const token = env("META_WA_TOKEN", null);
  const phoneNumberId = env("META_PHONE_NUMBER_ID", null);
  if (!token || !phoneNumberId) {
    throw new Error("WA_SEND_MODE=live but META_WA_TOKEN / META_PHONE_NUMBER_ID are not configured.");
  }
  const url = "https://graph.facebook.com/" + GRAPH_VERSION + "/" + phoneNumberId + "/messages";
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: String(phoneE164).replace(/^\+/, ""),
      type: "text",
      text: { body: text },
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (data && data.error && data.error.message) || ("Graph API error " + res.status);
    throw new Error(msg);
  }
  const wamid = data && data.messages && data.messages[0] && data.messages[0].id;
  return { wamid: wamid || null, status: "sent" };
}
