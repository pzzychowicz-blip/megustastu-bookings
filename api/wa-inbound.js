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
// Flow per inbound message (TWO PHASES since the async-parse change; a photo,
// voice note or document since v18.8.0 too — see inboundContent):
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
//
// v18.9.0 — COEXISTENCE. Every change is dispatched on its `field`: `messages`
// takes the flow above; the four coexistence fields (contacts, phone replies,
// imported history, account events) go to _lib/coexist-core.js; anything else
// is counted as `ignored` and answered 200. And before any of that, the NUMBER
// GUARD: a change whose `metadata.phone_number_id` is not the restaurant's is
// ignored (`numberIsOurs`, with why it accepts the id Embedded Signup wrote too).

import { env } from "./_lib/env.js";
import { verifySignature } from "./_lib/meta.js";
import { parseMessage, mockParse } from "./_lib/gemini.js";
import { processInbound, applyParse, inboundContent } from "./_lib/inbound-core.js";
import { updateMessageStatusByWamid, readOperatingHours, getConversation } from "./_lib/rtdb.js";
import { makeNumberGuard, COEXIST_HANDLERS, applyMessageChange } from "./_lib/coexist-core.js";
import { normalizePhone, isPhoneKey } from "../src/lib/whatsapp.js";
import { secondsTs, webhookPhoneKey, editedMessage } from "../src/lib/wa-coexist.js";

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
  } catch { /* no Vercel context — local harness */ }
}

// inboundTs(raw) — the message's own timestamp, or now (v18.0.0 phase 6,
// CT-WA-02). Meta's `timestamp` is seconds-since-epoch as a string, and it was
// trusted as one: `parseInt(m.timestamp, 10) * 1000`. Three things follow from a
// value that is not what it claims, and all three were measured against the
// emulator with a correctly-signed payload:
//
//   · NON-NUMERIC → NaN. RTDB REFUSES NaN ("values argument contains NaN in
//     property 'conversations.+34600111222.lastMessageAt'"), so the whole
//     message throws, `results.errors` is the only non-zero counter, and the
//     handler answers **500**. Meta redelivers a 500 for up to seven days, every
//     redelivery fails identically, and the customer's message is never stored.
//     A poison pill: a bill and a dropped booking request, on repeat.
//   · NEGATIVE / tiny → `windowExpiresAt` lands in 1970 (measured: 86399000), so
//     the 24h service window is already expired and staff can never reply to
//     that customer at all — `api/wa-send` answers 410 forever.
//   · ABSURDLY LARGE → `windowExpiresAt` in the year 5138 (measured:
//     100000086399000). The composer stays enabled indefinitely and the Cloud
//     API rejects every free-form send.
//
// Reachability is Meta or whoever holds META_APP_SECRET — the HMAC gate is
// sound (verified across ten cases). That is what makes it P2 rather than P1,
// and it is not what makes it acceptable: the failure is permanent, silent to
// staff, and costs money for a week.
//
// The upper clamp is a FACT rather than a policy — a webhook delivery cannot be
// timestamped after it arrived — so it only ever absorbs clock skew. An old
// timestamp is left alone: Meta redelivering after an outage is legitimate, and
// the expired window it produces is the honest answer.
// EXPORTED so it can be tested at all — it decides the 24h service window, which
// is the difference between staff being able to answer a customer and not. The
// rule v17.8.0 wrote down for `placeWaitlist` and `presenceState`.
// v18.9.0: the rule itself is `secondsTs` (src/lib/wa-coexist.js), which the
// coexistence fields' timestamps (contacts, phone replies, history) share.
export function inboundTs(raw) {
  return secondsTs(raw, Date.now());
}

// inboundContent(m) — what one webhook message becomes: moved to
// _lib/inbound-core.js in v18.8.0 phase 6, where the simulator's media messages
// take the same road. Re-exported here, where its tests import it.
export { inboundContent };

// handleMessagesChange(value, results, parseJobs) — one `messages` change: the
// customer's messages (phase A here, the parse queued for phase B) and the
// delivery/read receipts. The loop body of the handler until v18.9.0, moved
// out unchanged when the handler began dispatching on the field.
async function handleMessagesChange(value, results, parseJobs) {
  // contacts[] carries the WhatsApp profile name keyed by wa_id.
  const profileByWaId = {};
  // v18.0.0 phase 6 (CT-WA-04): `entry` and `changes` were checked with
  // Array.isArray and these three were not, so a `value.messages` that is a
  // STRING is iterated by `for...of` ONE CHARACTER AT A TIME. Measured
  // against the emulator with a correctly-signed body: `messages: "abc"`
  // answered 200 with `messages: 3` and manufactured three records.
  (Array.isArray(value.contacts) ? value.contacts : []).forEach((c) => {
    if (c && c.wa_id && c.profile && c.profile.name) profileByWaId[c.wa_id] = c.profile.name;
  });

  // ── Inbound messages (phase A: store fast, parse later) ───────────
  for (const raw of Array.isArray(value.messages) ? value.messages : []) {
    try {
      let m = raw;
      // v18.9.0: a customer's EDIT or DELETE changes the message it names and
      // adds none (applyMessageChange, _lib/coexist-core.js), and is never
      // parsed. An edit of a message we never stored is kept as a new message
      // under the edit's own id, so what the customer said is not lost; a
      // delete of one has nothing to delete.
      if (m && (m.type === "edit" || m.type === "revoke")) {
        const key = webhookPhoneKey(m.from);
        const r = key ? await applyMessageChange(key, m) : "invalid";
        if (r === "applied") { results.edits++; continue; }
        if (r !== "missing" || m.type === "revoke") { results.skipped++; continue; }
        m = editedMessage(m);
        if (!m) { results.skipped++; continue; }
      }
      // v18.8.0: a photo, a voice note or a document is stored with its
      // media; a caption is parsed like a text (see inboundContent).
      const content = inboundContent(m);
      const willParse = content.parseText !== null;
      const phone = "+" + String(m.from || "").replace(/^\+/, "");
      const ts = inboundTs(m.timestamp);
      // Read the conversation ONCE: a PENDING draft (draftStatus "parsed")
      // becomes the phase-B parse's merge context so follow-up messages
      // UPDATE it (fill gaps, apply corrections, re-assess confidence)
      // instead of replacing it blind. Accepted/dismissed drafts are not
      // draft context. The same conv object is handed to processInbound.
      const conv = await getConversation(normalizePhone(phone));
      const existingDraft = conv && conv.draftStatus === "parsed" ? conv.draftData : null;
      const r = await processInbound({
        phone, text: content.text, ts,
        media: content.media,
        snippetText: content.snippet,
        wamid: m.id || null,
        profileName: profileByWaId[m.from] || null,
        parse: null, // the LLM runs in phase B, after the response
        // Auto-ack language before the LLM has run: the mock parser's
        // regex detection is free and good enough for a two-line ack.
        langHint: willParse ? mockParse(content.parseText).language : null,
        preloadedConv: conv,
        willParse, // flag "analyzing…" only for messages we'll parse
      });
      if (r.skipped) results.skipped++;
      else {
        results.messages++;
        if (willParse) parseJobs.push({ phoneKey: r.phoneKey, text: content.parseText, existingDraft, ts });
      }
    } catch (e) {
      results.errors++;
      console.error("[wa-inbound] message processing failed:", e.message);
    }
  }

  // ── Delivery / read statuses ──────────────────────────────────────
  for (const s of Array.isArray(value.statuses) ? value.statuses : []) {
    try {
      const phoneKey = normalizePhone("+" + String(s.recipient_id || "").replace(/^\+/, ""));
      // isPhoneKey, not truthiness — `normalizePhone("+")` is `"+"`, which
      // is truthy and is nobody. CT-WA-04 replaced this test in
      // `processInbound` and left the statuses branch of the same handler
      // spelling it the old way: one rule, two spellings, one file.
      if (isPhoneKey(phoneKey) && s.id && s.status) {
        const ok = await updateMessageStatusByWamid(phoneKey, s.id, s.status);
        if (ok) results.statuses++;
      }
    } catch (e) {
      results.errors++;
      console.error("[wa-inbound] status processing failed:", e.message);
    }
  }
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
  } catch {
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
  } catch {
    res.status(400).json({ error: "invalid JSON" });
    return;
  }

  // v18.9.0: one counter per kind of record, plus `ignored` (a change for
  // another number, or a field this webhook does not handle).
  const results = { messages: 0, statuses: 0, echoes: 0, edits: 0, contacts: 0, history: 0, events: 0, skipped: 0, ignored: 0, errors: 0 };
  const parseJobs = []; // phase-B work: one LLM parse per stored text message
  const isOurs = makeNumberGuard();
  // v18.9.0: a coexistence handler that must be sent again (a history chunk
  // with a thread that failed) says so; the delivery is then answered 500.
  let retry = false;
  try {
    const entries = Array.isArray(payload.entry) ? payload.entry : [];
    for (const entry of entries) {
      const changes = Array.isArray(entry.changes) ? entry.changes : [];
      for (const change of changes) {
        const value = change && change.value;
        if (!value || typeof value !== "object") continue;
        // v18.9.0 — DISPATCH BY FIELD. Before coexistence Meta sent this URL
        // one field, so the handler read `value.messages` whatever the field
        // said; a coexistence number adds four more (_lib/coexist-core.js), and
        // a `history` change carries `value.messages` of its own (a photo's id,
        // arriving after its placeholder), which must not reach the inbound
        // path and its auto-reply. An absent field reads as `messages`, the one
        // field there was.
        const field = typeof change.field === "string" && change.field ? change.field : "messages";
        let ours;
        try {
          ours = await isOurs(value);
        } catch (e) {
          results.errors++;
          console.error("[wa-inbound] number guard could not read waLink:", e.message);
          continue;
        }
        if (!ours) {
          results.ignored++;
          console.warn("[wa-inbound] ignored a " + field + " change for another number (" + value.metadata.phone_number_id + ")");
          continue;
        }
        if (field === "messages") { await handleMessagesChange(value, results, parseJobs); continue; }
        const coexist = Object.prototype.hasOwnProperty.call(COEXIST_HANDLERS, field) ? COEXIST_HANDLERS[field] : null;
        if (!coexist) { results.ignored++; continue; } // a field this webhook does not handle
        try {
          const out = await coexist(value, results);
          if (out && out.retry) retry = true;
        } catch (e) {
          results.errors++;
          console.error("[wa-inbound] " + field + " processing failed:", e.message);
        }
      }
    }
  } catch (e) {
    console.error("[wa-inbound] payload processing error:", e);
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
          try { await applyParse(job.phoneKey, null, job.ts); } catch { /* ignore */ }
        }
      }
    })());
  }
  // Retry semantics: 200 tells Meta "delivered, don't retry". If EVERYTHING in
  // the payload failed (e.g. the database was unreachable), answer 500 so Meta
  // redelivers later — the wamid-keyed idempotency makes the retry safe.
  // v18.9.0: "everything" is every counter but `errors`, so a payload of
  // contacts or history that all failed is retried as a payload of messages is.
  const done = Object.keys(results).reduce((n, k) => (k === "errors" ? n : n + results[k]), 0);
  // v18.9.0: or when a handler asked to be sent again (`retry`). Phase B is
  // scheduled first, so a text stored in the same delivery is still parsed:
  // the resend finds it stored and skips it, parse and all.
  if ((results.errors > 0 && done === 0) || retry) {
    res.status(500).json({ error: "processing failed", ...results });
    return;
  }

  res.status(200).json({ ok: true, ...results });
}
