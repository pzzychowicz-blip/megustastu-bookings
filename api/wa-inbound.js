// api/wa-inbound.js
//
// WhatsApp backend — THE webhook. Vercel serverless function (also runnable
// under scripts/wa-backend-dev.mjs locally). Two jobs:
//
//   GET  — Meta's one-time webhook verification handshake: echo hub.challenge
//          when hub.verify_token matches META_VERIFY_TOKEN.
//   POST — every Cloud API event. One payload can carry BOTH messages[] and
//          statuses[] (delivery/read receipts) — which is why there is NO
//          separate /api/wa-status function (deviation from the Phase 1a list,
//          documented in the sandbox summary): Meta only ever calls ONE url.
//
// Flow per inbound text message (TWO PHASES since the async-parse change):
//   PHASE A (before the response): raw body → HMAC verify (X-Hub-Signature-256;
//   WA_ALLOW_UNSIGNED=1 skips it on the local harness) → normalize → wamid
//   dedupe → inbound-core.processInbound with parse=null (conversation upsert +
//   message + one-time auto-ack — auto-ack language from the cheap mockParse
//   regex, since the LLM hasn't run yet). Statuses update by wamid. Fast RTDB
//   writes only — the response goes out within Meta's webhook budget.
//   PHASE B (after the response): gemini.parseMessage (live, up to 15s) →
//   inbound-core.applyParse patches the draft onto the conversation. On Vercel
//   the work is registered via the request-context waitUntil so the function
//   isn't frozen; on the local harness the long-lived process just runs it.
//   A Meta RETRY now never reaches the LLM — dedupe happens in phase A.
//
// Always answer 200 once phase-A processing succeeded — Meta retries non-200s
// for up to 7 days, and retries are idempotent here (wamid-keyed message ids).
// Because only the fast writes gate the response, the 500-on-total-failure
// retry path now reflects exactly what matters: DB reachability. An LLM
// failure no longer triggers retries (it never should have — parse failure =
// message saved without draft, by design).
//
// bodyParser is disabled so the HMAC sees the exact raw bytes (a re-serialized
// JSON body would not verify).

import { env } from "./_lib/env.js";
import { verifySignature } from "./_lib/meta.js";
import { parseMessage, mockParse } from "./_lib/gemini.js";
import { processInbound, applyParse } from "./_lib/inbound-core.js";
import { updateMessageStatusByWamid, readOperatingHours, getConversation } from "./_lib/rtdb.js";
import { normalizePhone } from "../src/lib/whatsapp.js";

export const config = { api: { bodyParser: false } };

// Run `promise` AFTER the response is sent. On Vercel the runtime freezes the
// function once the response completes UNLESS the work is registered through
// the request-context waitUntil — the same hook the official @vercel/functions
// package wraps; read it directly to stay dependency-free (swap to the package
// if this internal symbol ever changes). On the local harness there is no
// freeze — the promise simply keeps running on the live node process.
function scheduleAfterResponse(promise) {
  promise.catch((e) => console.error("[wa-inbound] post-response work failed:", e && e.message));
  try {
    const ctx = globalThis[Symbol.for("@vercel/request-context")];
    const waitUntil = ctx && ctx.get && ctx.get() && ctx.get().waitUntil;
    if (typeof waitUntil === "function") waitUntil(promise);
  } catch (e) { /* no Vercel context — local harness */ }
}

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

export default async function handler(req, res) {
  // ── GET: webhook verification handshake ────────────────────────────────────
  if (req.method === "GET") {
    const q = req.query || {};
    const mode = q["hub.mode"];
    const token = q["hub.verify_token"];
    const challenge = q["hub.challenge"];
    const expected = env("META_VERIFY_TOKEN", null);
    if (mode === "subscribe" && expected && token === expected) {
      res.status(200).send(String(challenge || ""));
      return;
    }
    res.status(403).json({ error: "verification failed" });
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ error: "method not allowed" });
    return;
  }

  // ── POST: events ────────────────────────────────────────────────────────────
  let raw;
  try {
    raw = await readRawBody(req);
  } catch (e) {
    res.status(400).json({ error: "unreadable body" });
    return;
  }
  if (!verifySignature(raw, req.headers["x-hub-signature-256"])) {
    res.status(401).json({ error: "bad signature" });
    return;
  }
  let payload;
  try {
    payload = JSON.parse(raw.toString("utf8"));
  } catch (e) {
    res.status(400).json({ error: "invalid JSON" });
    return;
  }

  const results = { messages: 0, statuses: 0, skipped: 0, errors: 0 };
  const parseJobs = []; // phase-B work: one LLM parse per stored text message
  try {
    const entries = Array.isArray(payload.entry) ? payload.entry : [];
    for (const entry of entries) {
      const changes = Array.isArray(entry.changes) ? entry.changes : [];
      for (const change of changes) {
        const value = change && change.value;
        if (!value) continue;

        // contacts[] carries the WhatsApp profile name keyed by wa_id.
        const profileByWaId = {};
        (value.contacts || []).forEach((c) => {
          if (c && c.wa_id && c.profile && c.profile.name) profileByWaId[c.wa_id] = c.profile.name;
        });

        // ── Inbound messages (phase A: store fast, parse later) ───────────
        for (const m of value.messages || []) {
          try {
            // Text only for now (Phase 3 covers media); non-text becomes a
            // placeholder message with no draft (and no parse job).
            const isText = m.type === "text" && m.text;
            const text = isText ? m.text.body : "[" + (m.type || "unsupported") + " message]";
            const phone = "+" + String(m.from || "").replace(/^\+/, "");
            const ts = m.timestamp ? parseInt(m.timestamp, 10) * 1000 : Date.now();
            // Read the conversation ONCE: a PENDING draft (draftStatus "parsed")
            // becomes the phase-B parse's merge context so follow-up messages
            // UPDATE it (fill gaps, apply corrections, re-assess confidence)
            // instead of replacing it blind. Accepted/dismissed drafts are not
            // draft context. The same conv object is handed to processInbound.
            const conv = await getConversation(normalizePhone(phone));
            const existingDraft = conv && conv.draftStatus === "parsed" ? conv.draftData : null;
            const r = await processInbound({
              phone, text, ts,
              wamid: m.id || null,
              profileName: profileByWaId[m.from] || null,
              parse: null, // the LLM runs in phase B, after the response
              // Auto-ack language before the LLM has run: the mock parser's
              // regex detection is free and good enough for a two-line ack.
              langHint: isText ? mockParse(text).language : null,
              preloadedConv: conv,
              willParse: isText, // flag "analyzing…" only for messages we'll parse
            });
            if (r.skipped) results.skipped++;
            else {
              results.messages++;
              if (isText) parseJobs.push({ phoneKey: r.phoneKey, text, existingDraft, ts });
            }
          } catch (e) {
            results.errors++;
            console.error("[wa-inbound] message processing failed:", e.message);
          }
        }

        // ── Delivery / read statuses ──────────────────────────────────────
        for (const s of value.statuses || []) {
          try {
            const phoneKey = normalizePhone("+" + String(s.recipient_id || "").replace(/^\+/, ""));
            if (phoneKey && s.id && s.status) {
              const ok = await updateMessageStatusByWamid(phoneKey, s.id, s.status);
              if (ok) results.statuses++;
            }
          } catch (e) {
            results.errors++;
            console.error("[wa-inbound] status processing failed:", e.message);
          }
        }
      }
    }
  } catch (e) {
    console.error("[wa-inbound] payload processing error:", e);
  }
  // Retry semantics: 200 tells Meta "delivered, don't retry". If EVERYTHING in
  // the payload failed (e.g. the database was unreachable), answer 500 so Meta
  // redelivers later — the wamid-keyed idempotency makes the retry safe.
  if (results.errors > 0 && results.messages === 0 && results.statuses === 0 && results.skipped === 0) {
    res.status(500).json({ error: "processing failed", ...results });
    return;
  }

  // ── Phase B: LLM parse + draft patch, after the response ───────────────────
  // One readOperatingHours per payload (was per message). Jobs run sequentially
  // — a payload virtually never carries >1 text message from the same webhook.
  if (parseJobs.length > 0) {
    scheduleAfterResponse((async () => {
      const hours = await readOperatingHours();
      for (const job of parseJobs) {
        try {
          const parse = await parseMessage(job.text, { hours, existingDraft: job.existingDraft });
          await applyParse(job.phoneKey, parse, job.ts);
        } catch (e) {
          // Parse failure = message stays draft-less (the designed failure
          // mode); never affects the already-sent response. Still clear the
          // "analyzing…" indicator so it can't get stuck on.
          console.error("[wa-inbound] async parse failed:", e.message);
          try { await applyParse(job.phoneKey, null, job.ts); } catch (_) {}
        }
      }
    })());
  }
  res.status(200).json({ ok: true, ...results });
}
