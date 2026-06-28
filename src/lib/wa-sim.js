// src/lib/wa-sim.js
//
// Local WhatsApp message simulator — the stand-in for the (deferred) Phase 1b
// backend (Meta Cloud API webhook + Gemini LLM intent classification). It is the
// mock `/api/wa-inbound`: given an inbound customer message + a pre-baked "parse"
// (we don't fake an LLM here — scenarios supply the classification directly), it
// upserts the conversation and appends the message through the SAME guarded
// useWhatsApp savers, so everything flows Firebase → onValue → inbox exactly as
// the real webhook eventually will.
//
// As the mock backend it legitimately performs the inbound-side behaviours the
// design doc marks "Phase 1b backend": opens/resets the 24h window, fires the
// one-time language-matched auto-ack, clears acceptedBadgeDismissedAt, and
// auto-unarchives. All dev-only — this module is only ever imported by the
// DEV-gated simulator surfaces.
//
// ctx (supplied by the simulator panel / console): {
//   conversations,            // current array (snapshot, for the auto-ack check)
//   upsertConversation,       // useWhatsApp saver (phoneKey, fullObject) — keyed
//   appendMessage,            // useWhatsApp saver (phoneKey, msg) — keyed
//   saveBookings,             // usePersistence saver (for seeding sample bookings)
// }
//
// BACKEND MODE (Phase 1b): when the Sim panel's Backend toggle is ON, this
// function does NOT write Firebase client-side — it wraps the message in a
// Meta-shaped webhook payload and POSTs it to the local /api/wa-inbound, so
// the REAL pipeline (server parse + keyed RTDB writes + one-time auto-ack)
// produces the result. The pre-baked `parse` / `acceptedBookingId` /
// phoneKeyOverride params are ignored on that path — the server decides, like
// production will (see src/lib/wa-backend.js).

import { normalizePhone, WA_WINDOW_MS, AUTO_ACK_TEXT, mergeDraft, clampConfidence, WA_MAX_TEXT_LEN } from "./whatsapp";
import { backendEnabled, backendInbound } from "./wa-backend";

function genMsgId() { return "sim" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

// Simulated LLM parse latency (client mode) — how long the "parsing…" indicator
// shows before the draft is revealed. Mirrors the real backend's async round-trip.
const WA_SIM_PARSE_MS = 1100;

// simulateInbound(params, ctx) — inject one inbound message.
// params: {
//   phone, text, language,
//   parse: { intent, size, date, time, notes, confidence, ambiguity, name } | null,
//   acceptedBookingId,   // link this conversation to an existing booking (cancel/modify)
//   windowAgeMs,         // back-date the inbound so the 24h window is already expired
//   phoneKeyOverride,    // force a synthetic phoneKey (rare; e.g. a 2nd thread per number)
// }
export function simulateInbound(params, ctx) {
  // Backend mode: hand the message to the real pipeline (DEV harness or the
  // online staff-auth sim endpoint) and stop — the server parses with Gemini.
  if (backendEnabled()) {
    backendInbound({ phone: params.phone, text: params.text || "", name: params.parse && params.parse.name, windowAgeMs: params.windowAgeMs || 0 })
      .catch(function (e) { console.warn("[waSim] backend inbound post failed:", e.message); });
    return normalizePhone(params.phone);
  }
  const { conversations } = ctx;
  const phoneKey = params.phoneKeyOverride || normalizePhone(params.phone);
  if (!phoneKey) return null;
  const lang = params.language === "en" ? "en" : "es";
  const ts = Date.now() - (params.windowAgeMs || 0);
  const text = (params.text || "").slice(0, WA_MAX_TEXT_LEN); // same storage cap as the backend
  const parse = params.parse || null;
  const intent = parse ? (parse.intent || "new_booking") : null;
  const isDraftIntent = intent === "new_booking" || intent === "cancel" || intent === "modify";

  // First-ever inbound for this number → fire the one-time auto-ack.
  const existing = (conversations || []).find((c) => c.phoneKey === phoneKey) || null;
  const firstEver = !existing || !existing.autoAckSent;

  const inboundMsg = { id: genMsgId(), direction: "in", text, ts, status: "delivered", isAutoAck: false, channel: "whatsapp" };
  const autoAckMsg = firstEver
    ? { id: genMsgId(), direction: "out", text: AUTO_ACK_TEXT[lang] || AUTO_ACK_TEXT.es, ts: ts + 1500, status: "delivered", isAutoAck: true, channel: "whatsapp" }
    : null;

  let draftData = null;
  if (isDraftIntent) {
    draftData = {
      name: parse.name != null ? parse.name : null,
      size: parse.size != null ? parse.size : null,
      date: parse.date || null,
      time: parse.time || null,
      notes: parse.notes || "",
      preference: parse.preference || "auto",
      intent,
      confidence: parse.confidence || "high",
      ambiguity: parse.ambiguity || null,
    };
    // Confidence ceiling (see clampConfidence) — a draft missing the party size
    // (or any crucial field / with ambiguity) can never read "high confidence".
    draftData.confidence = clampConfidence(draftData.confidence, draftData);
  }

  // Keyed write: compute the merged conversation object from the ctx snapshot
  // and upsert it at conversations/{phoneKey} (the Phase-1b storage shape).
  const ex = (conversations || []).find((c) => c.phoneKey === phoneKey) || null;
  const base = ex || {
    phoneKey, phone: params.phone || phoneKey, channel: "whatsapp", language: lang,
    acceptedBookingId: null, autoAckSent: false, createdAt: ts,
    archived: false, archivedAt: null, draftStatus: null, draftData: null, _waSim: true,
  };
  const patch = {
    lastMessageAt: ts,
    lastMessageSnippet: text,
    unread: true,
    windowExpiresAt: ts + WA_WINDOW_MS,
    language: lang,
    acceptedBadgeDismissedAt: null, // inbound re-shows the "confirmed" banner
    archived: false, archivedAt: null, // auto-unarchive on inbound
    autoAckSent: true,
    _waSim: true,
  };
  if (params.acceptedBookingId !== undefined) patch.acceptedBookingId = params.acceptedBookingId;

  // A draft intent sets/UPDATES the draft; question/other leave any existing
  // draft (or linked booking) untouched so we don't clobber an accepted thread.
  // Draft-aware merge (client-mode mirror of the backend rule): when a PENDING
  // draft exists, the new parse merges into it via the shared mergeDraft —
  // follow-up details fill gaps, corrections overwrite, confidence recomputed.
  // draftUpdatedAt: the intent-banner re-show gate (intentBannerVisible) —
  // stamped ONLY where a parse sets/updates the draft, so "thank you" can't
  // re-raise a handled banner. Mirrors the server's draftPatchFromParse.
  const draftPatch = isDraftIntent ? {
    draftStatus: "parsed",
    draftUpdatedAt: ts,
    draftData: ex && ex.draftStatus === "parsed" && ex.draftData ? mergeDraft(ex.draftData, draftData) : draftData,
  } : null;

  // Two-phase (only for a draft intent, and only when a patcher is available):
  // show the inbound + a "parsing…" indicator first, then reveal the draft after
  // a simulated LLM round-trip — so the parsing UX is visible in client mode
  // (the real backend is genuinely async). Without patchConversation, fall back
  // to the original single write.
  if (draftPatch && ctx.patchConversation) {
    ctx.upsertConversation(phoneKey, Object.assign({}, base, patch, { parsing: true }));
    ctx.appendMessage(phoneKey, inboundMsg);
    if (autoAckMsg) ctx.appendMessage(phoneKey, autoAckMsg);
    setTimeout(function () {
      ctx.patchConversation(phoneKey, Object.assign({ parsing: null }, draftPatch));
    }, WA_SIM_PARSE_MS);
    return phoneKey;
  }

  ctx.upsertConversation(phoneKey, Object.assign({}, base, patch, draftPatch || {}));
  ctx.appendMessage(phoneKey, inboundMsg);
  if (autoAckMsg) ctx.appendMessage(phoneKey, autoAckMsg);

  return phoneKey;
}
