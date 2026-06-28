// api/_lib/inbound-core.js
//
// WhatsApp backend — the inbound-message mechanics. This is the SERVER port of
// the sandbox's src/lib/wa-sim.js::simulateInbound (which mocked exactly this
// file's job client-side): given one normalized inbound message + its LLM
// parse, upsert the conversation and append the message — with every Phase-1b
// behaviour the design doc assigned to the backend:
//
//   · opens/RESETS the 24h service window on every inbound
//   · AUTO-ACK fires ONCE EVER per phone number (autoAckSent gate, Q1),
//     language-matched, sent through the real send layer (mock/live applies)
//   · auto-unarchives an archived conversation (Q2)
//   · clears acceptedBadgeDismissedAt → the "Booking confirmed" banner
//     re-surfaces on new activity
//   · draft intents (new_booking|cancel|modify) set/REPLACE the draft;
//     question/other leave any existing draft + linked booking untouched
//   · intentHandledAt needs no explicit reset — a draft-setting parse stamping
//     draftUpdatedAt past it is what re-shows the intent banner (the shared
//     intentBannerVisible rule). Neither lastMessageAt (staff replies move it)
//     nor a bare every-inbound stamp (a customer "thank you" moves it) may be
//     the gate — both resurrected handled banners in live QA
//
// Pure-helper imports come from the CLIENT module src/lib/whatsapp.js — same
// normalizer, same window length, same auto-ack texts. One source of truth.
//
// Idempotency: Meta retries webhook deliveries (up to 7 days on failure). The
// message id is the sanitized wamid, so a redelivery targets the same RTDB
// path; we additionally skip the whole upsert when the message already exists.

import { normalizePhone, WA_WINDOW_MS, AUTO_ACK_TEXT, WA_MAX_TEXT_LEN, clampConfidence } from "../../src/lib/whatsapp.js";
import { getConversation, upsertConversation, appendMessage, messageExists, sanitizeKey, readOperatingHours } from "./rtdb.js";
import { sendText } from "./meta.js";
import { parseMessage, mockParse } from "./gemini.js";

// draftPatchFromParse(parse, ts) — the conversation fields a draft-intent
// parse sets. Shared by processInbound (when called with a parse — the
// harness's /dev paths still do) and applyParse (the async post-response
// path). `draftUpdatedAt` (= the triggering message's ts) is the intent-banner
// re-show gate (intentBannerVisible): ONLY a parse that sets/updates the draft
// stamps it, so a customer's "thank you" (intent other — drafts untouched)
// never resurrects a handled banner.
function draftPatchFromParse(parse, ts) {
  const draftData = {
    name: parse.name != null ? parse.name : null,
    size: parse.size != null ? parse.size : null,
    date: parse.date || null,
    time: parse.time || null,
    notes: parse.notes || "",
    preference: parse.preference || "auto",
    intent: parse.intent,
    confidence: parse.confidence || "high",
    ambiguity: parse.ambiguity || null,
  };
  // Confidence ceiling: high only when size/date/time are all present and there's
  // no ambiguity (see clampConfidence). A draft missing the party size can never
  // read "high confidence".
  draftData.confidence = clampConfidence(draftData.confidence, draftData);
  return { draftStatus: "parsed", draftUpdatedAt: ts || Date.now(), draftData };
}

// applyParse(phoneKey, parse, ts) — the ASYNC half of the inbound flow.
// wa-inbound answers Meta first (processInbound ran with parse=null, so the
// message is already stored and visible), then the LLM result lands here as a
// follow-up conversation patch: draft intents set/REPLACE the draft (the parse
// was already draft-aware-merged by the caller) and stamp draftUpdatedAt=ts
// (the message's ts — the banner re-show gate); question/other only refresh
// the detected language. No-op on a null parse (LLM failed → no draft).
export async function applyParse(phoneKey, parse, ts) {
  if (!phoneKey) return;
  // Always clear the "analyzing…" indicator — the LLM route has finished, even
  // on a null/failed parse, so the indicator can never get stuck.
  const patch = { parsing: null };
  if (parse) {
    patch.language = parse.language === "en" ? "en" : "es";
    const intent = parse.intent || null;
    if (intent === "new_booking" || intent === "cancel" || intent === "modify") {
      Object.assign(patch, draftPatchFromParse(parse, ts));
    }
  }
  await upsertConversation(phoneKey, patch);
}

// processInbound({ phone, text, ts, wamid, profileName, parse, langHint, preloadedConv })
//   ts           — ms epoch (from the Meta payload's timestamp; faithful for
//                  retries and lets local testing back-date the window)
//   parse        — gemini.parseMessage() result or null (= no draft). When the
//                  conversation had a PENDING draft, the caller already fed it
//                  to the parse, so `parse` IS the merged/updated draft.
//                  The webhook path now passes null and parses AFTER answering
//                  Meta (applyParse above); a non-null parse still works — the
//                  harness's synchronous /dev paths use it.
//   langHint     — "en"|"es"|null: cheap regex language detection (gemini.js
//                  mockParse) used for the auto-ack language when parse is null
//                  (the async flow acks before the LLM answers).
//   preloadedConv— the conversation the caller (wa-inbound) already read for
//                  the draft-aware parse; passing it avoids a duplicate read.
// Returns { phoneKey, skipped } — skipped=true when the wamid was seen before.
export async function processInbound({ phone, text, ts, wamid, profileName, parse, langHint, preloadedConv, willParse }) {
  const phoneKey = normalizePhone(phone);
  if (!phoneKey) return { phoneKey: null, skipped: true };
  // Storage cap — one choke point for every caller (webhook, harness /dev).
  text = String(text || "").slice(0, WA_MAX_TEXT_LEN);
  const msgId = wamid ? sanitizeKey(wamid) : "in" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  if (wamid && (await messageExists(phoneKey, msgId))) {
    return { phoneKey, skipped: true }; // webhook redelivery — already processed
  }

  const lang = parse ? (parse.language === "en" ? "en" : "es") : (langHint === "en" ? "en" : "es");
  const intent = parse ? parse.intent || null : null;
  const isDraftIntent = intent === "new_booking" || intent === "cancel" || intent === "modify";

  const existing = preloadedConv !== undefined ? preloadedConv : await getConversation(phoneKey);
  const firstEver = !existing || !existing.autoAckSent;

  // ── Conversation upsert (per-key update(); see rtdb.js on the keyed shape) ──
  const patch = {
    phoneKey,
    phone: phone || phoneKey,
    channel: "whatsapp",
    lastMessageAt: ts,
    lastMessageSnippet: String(text || "").slice(0, 200),
    unread: true,
    windowExpiresAt: ts + WA_WINDOW_MS,
    language: lang,
    acceptedBadgeDismissedAt: null, // inbound re-shows the "confirmed" banner
    archived: false,
    archivedAt: null,               // auto-unarchive on inbound
    autoAckSent: true,
  };
  if (!existing) {
    patch.createdAt = ts;
    patch.acceptedBookingId = null;
    patch.draftStatus = null;
    patch.draftData = null;
  }
  if (profileName && (!existing || !existing.profileName)) patch.profileName = profileName;
  if (isDraftIntent) Object.assign(patch, draftPatchFromParse(parse, ts));
  // Async path (parse runs after the response): flag "analyzing…" so the inbox
  // shows the LLM route in progress; applyParse clears it when the draft lands.
  if (parse == null && willParse) patch.parsing = true;
  await upsertConversation(phoneKey, patch);

  // ── The inbound message itself ────────────────────────────────────────────
  await appendMessage(phoneKey, {
    id: msgId,
    direction: "in",
    text: String(text || ""),
    ts,
    status: "delivered",
    isAutoAck: false,
    channel: "whatsapp",
    providerMsgId: wamid || null,
  });

  // ── One-time auto-ack (after the inbound so the thread reads naturally) ───
  if (firstEver) {
    const ackText = AUTO_ACK_TEXT[lang] || AUTO_ACK_TEXT.es;
    try {
      const sent = await sendText(phoneKey, ackText);
      await appendMessage(phoneKey, {
        id: "ack" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        direction: "out",
        text: ackText,
        ts: ts + 1500,
        status: sent.status,
        isAutoAck: true,
        channel: "whatsapp",
        providerMsgId: sent.wamid || null,
      });
    } catch (e) {
      // Auto-ack failure must never fail the inbound — log and move on.
      console.warn("[wa-inbound] auto-ack send failed: " + e.message);
    }
  }

  return { phoneKey, skipped: false };
}

// injectSimInbound({ phone, text, name, agoMs }, afterResponse) — the SANDBOX
// inbound flow shared by api/wa-sim-inbound (online Sim panel) and
// api/wa-sim-generate (Gemini-invented scenarios). Mirrors api/wa-inbound for a
// single message: store fast (processInbound, parse=null + auto-ack), then parse
// with Gemini AFTER the response via `afterResponse` (the endpoint's Vercel
// waitUntil / harness shim) so the draft lands through the client's onValue.
// `afterResponse(promise)` schedules post-response work; returns the
// processInbound result ({ phoneKey, skipped }).
export async function injectSimInbound({ phone, text, name, agoMs = 0 }, afterResponse) {
  const ts = Date.now() - (Number(agoMs) || 0);
  const conv = await getConversation(normalizePhone(phone));
  const existingDraft = conv && conv.draftStatus === "parsed" ? conv.draftData : null;
  const r = await processInbound({
    phone, text, ts,
    wamid: "sim." + Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
    profileName: name || null,
    parse: null,
    langHint: mockParse(text).language,
    preloadedConv: conv,
    willParse: true, // flags "analyzing…" until applyParse lands the draft
  });
  afterResponse((async () => {
    try {
      const hours = await readOperatingHours();
      const parse = await parseMessage(text, { hours, existingDraft });
      await applyParse(r.phoneKey, parse, ts);
    } catch (e) {
      console.warn("[wa-sim] parse failed: " + e.message);
      try { await applyParse(r.phoneKey, null, ts); } catch (_) {} // clear the indicator
    }
  })());
  return r;
}
