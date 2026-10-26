// api/wa-send.js
//
// WhatsApp backend — staff reply endpoint. The booking app's composer calls
// this instead of writing the outbound message client-side (the sandbox's
// 800ms mock in useWhatsApp.handleSendReply is the OFF-mode fallback).
//
//   POST { phoneKey, text }
//   Authorization: Bearer <Firebase ID token>   (auth.currentUser.getIdToken())
//
// Guards, in order:
//   401 — missing, expired or malformed staff token (verified against the SAME
//         Firebase project the database belongs to — DEV in the sandbox)
//   403 — the token is valid but the ACCOUNT may not use this endpoint: either
//         it is absent from WA_STAFF_EMAILS, or its address is on the list but
//         unverified. The two carry different messages; they need opposite
//         fixes. Re-authenticating fixes neither, which is why this is not 401.
//   503 — server misconfigured: no FIREBASE_SERVICE_ACCOUNT (no token can be
//         verified at all), or WA_STAFF_EMAILS is unset on a backend where it
//         is required (WA_SEND_MODE=live, or WA_DB_URL off the DEV database).
//         All three auth statuses come from ONE mapping, `staffAuthError`
//         in _lib/rtdb.js, shared by the five token-gated endpoints.
//   400 — missing phoneKey/text
//   404 — conversation does not exist (replies only go to existing threads)
//   410 — 24h service window expired: Cloud API would reject a free-form
//         message; only template messages are allowed then, and we opted out
//         of proactive templates (Q15). The composer is already disabled
//         client-side; this is the server-side enforcement of the same rule.
//
// On success: sends via meta.sendText (mock → fake wamid + "delivered";
// live → Graph API + "sent", later advanced by webhook statuses[]), appends
// the outbound message (authorEmail from the verified token — the audit
// trail), updates the conversation snippet/lastMessageAt, and auto-unarchives
// (Q2: replying to an archived conversation un-archives it, unless it is
// "Not a customer": `replyUnarchives`). The window is NOT reset — only inbound
// customer messages reset it.
//
// v18.12.0: a conversation the sandbox simulator created (`sim: true`) is sent
// as mock mode would, even on a live deployment (`simulated`, _lib/meta.js).

import { verifyStaffToken, staffAuthError, getConversation, upsertConversation, appendMessage } from "./_lib/rtdb.js";
import { readJsonBody, bearerToken } from "./_lib/request.js";
import { sendText } from "./_lib/meta.js";
import { capOutbound, snippet, replyUnarchives, isSimConversation } from "../src/lib/whatsapp.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "method not allowed" });
    return;
  }

  // ── Staff auth ──────────────────────────────────────────────────────────────
  const idToken = bearerToken(req);
  if (!idToken) { res.status(401).json({ error: "missing token" }); return; }
  let staff;
  try {
    staff = await verifyStaffToken(idToken);
  } catch (e) {
    const f = staffAuthError(e);
    res.status(f.status).json({ error: f.error });
    return;
  }

  const body = await readJsonBody(req);
  const phoneKey = body && body.phoneKey;
  // v18.0.0 phase 6 (CT-WA-06): capped BEFORE the send, so the message
  // transmitted and the message stored are the same string.
  const text = capOutbound(body && typeof body.text === "string" ? body.text.trim() : "");
  if (!phoneKey || !text) { res.status(400).json({ error: "phoneKey and text are required" }); return; }

  const conv = await getConversation(phoneKey);
  if (!conv) { res.status(404).json({ error: "conversation not found" }); return; }
  if (!conv.windowExpiresAt || conv.windowExpiresAt <= Date.now()) {
    res.status(410).json({ error: "24h window expired — wait for the customer to message again" });
    return;
  }

  // ── Send + persist ──────────────────────────────────────────────────────────
  let sent;
  try {
    // v18.12.0: a simulator conversation (`sim`) never reaches Meta, whatever
    // the send mode: its phone is made up and may be somebody's real number.
    sent = await sendText(conv.phone || phoneKey, text, { simulated: isSimConversation(conv) });
  } catch (e) {
    console.error("[wa-send] provider send failed:", e.message);
    res.status(502).json({ error: "send failed: " + e.message });
    return;
  }
  const ts = Date.now();
  const msgId = "m" + ts.toString(36) + Math.random().toString(36).slice(2, 6);
  await appendMessage(phoneKey, {
    id: msgId,
    direction: "out",
    text,
    ts,
    status: sent.status,
    isAutoAck: false,
    channel: "whatsapp",
    providerMsgId: sent.wamid || null,
    authorEmail: staff.email || staff.uid,
  });
  const patch = { lastMessageAt: ts, lastMessageSnippet: snippet(text) };
  if (replyUnarchives(conv)) { patch.archived = false; patch.archivedAt = null; } // auto-unarchive on send
  await upsertConversation(phoneKey, patch);

  res.status(200).json({ ok: true, msgId, wamid: sent.wamid || null, status: sent.status });
}
