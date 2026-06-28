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
//   401 — missing/invalid staff token (verified against the SAME Firebase
//         project the database belongs to — DEV in the sandbox)
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
// (Q2: replying to an archived conversation un-archives it). The window is
// NOT reset — only inbound customer messages reset it.

import { verifyStaffToken, getConversation, upsertConversation, appendMessage } from "./_lib/rtdb.js";
import { sendText } from "./_lib/meta.js";

function readJsonBody(req) {
  if (req.body !== undefined && req.body !== null) {
    // Vercel's helper may have parsed it already (string or object).
    if (typeof req.body === "string") { try { return Promise.resolve(JSON.parse(req.body)); } catch { return Promise.resolve(null); } }
    return Promise.resolve(req.body);
  }
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
      catch { resolve(null); }
    });
    req.on("error", () => resolve(null));
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "method not allowed" });
    return;
  }

  // ── Staff auth ──────────────────────────────────────────────────────────────
  const authHeader = req.headers["authorization"] || "";
  const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!idToken) { res.status(401).json({ error: "missing token" }); return; }
  let staff;
  try {
    staff = await verifyStaffToken(idToken);
  } catch (e) {
    // A missing service account can't verify ANY token — surface it as a server
    // misconfig (503) rather than a misleading "invalid token".
    if (e && e.code === "NO_SERVICE_ACCOUNT") { res.status(503).json({ error: e.message }); return; }
    res.status(401).json({ error: "invalid token" });
    return;
  }

  const body = await readJsonBody(req);
  const phoneKey = body && body.phoneKey;
  const text = body && typeof body.text === "string" ? body.text.trim() : "";
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
    sent = await sendText(conv.phone || phoneKey, text);
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
  const patch = { lastMessageAt: ts, lastMessageSnippet: text };
  if (conv.archived) { patch.archived = false; patch.archivedAt = null; } // auto-unarchive on send
  await upsertConversation(phoneKey, patch);

  res.status(200).json({ ok: true, msgId, wamid: sent.wamid || null, status: sent.status });
}
