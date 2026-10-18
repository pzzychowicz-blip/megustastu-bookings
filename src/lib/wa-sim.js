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

import { normalizePhone, WA_WINDOW_MS, AUTO_ACK_TEXT, mergeDraft, clampConfidence, WA_MAX_TEXT_LEN, sanitizeParse, snippet } from "./whatsapp";
import { backendEnabled } from "./wa-backend";
import { countLabel } from "./booking-logic";
import { backendInbound, postSimEvent } from "./wa-backend-sim";
import { contactPatch, echoRecord, echoConvPatch, editPatch, revokePatch, changeLine, threadPlan, historyConvPatch } from "./wa-coexist";
import {
  simEventRefusal, simContactValue, simEchoValue, simHistoryValue, simContent, lastCustomerMessage,
} from "./wa-sim-coexist";

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
    // v18.4.5: the caller hears how the post ended (`ctx.onBackend(error|null)`).
    // It used to hear nothing, so the panel said "Sent via backend" for a post
    // the server had refused, with the reason only in the console. Two-argument
    // `then`, so a throwing report is not caught below and reported as a failed
    // post (the `.then` after a `.catch` trap, the other way round).
    const report = ctx && typeof ctx.onBackend === "function" ? ctx.onBackend : null;
    backendInbound({ phone: params.phone, text: params.text || "", name: params.parse && params.parse.name, windowAgeMs: params.windowAgeMs || 0 })
      .then(
        function () { if (report) report(null); },
        function (e) { console.warn("[waSim] backend inbound post failed:", e.message); if (report) report(e); }
      );
    return normalizePhone(params.phone);
  }
  const { conversations } = ctx;
  const phoneKey = params.phoneKeyOverride || normalizePhone(params.phone);
  if (!phoneKey) return null;
  const lang = params.language === "en" ? "en" : "es";
  const ts = Date.now() - (params.windowAgeMs || 0);
  const text = (params.text || "").slice(0, WA_MAX_TEXT_LEN); // same storage cap as the backend
  // Same boundary as the server's draftPatchFromParse (v18.0.0 phase 6,
  // CT-WA-01) — the simulator hands `parse` straight in from a scenario or from
  // __waSim.custom(), so without this the sandbox is the one path that can still
  // build a draft the app cannot use.
  const parse = sanitizeParse(params.parse || null);
  const intent = parse ? (parse.intent || "new_booking") : null;
  const isDraftIntent = intent === "new_booking" || intent === "cancel" || intent === "modify";

  // First-ever inbound for this number → fire the one-time auto-ack.
  const existing = (conversations || []).find((c) => c.phoneKey === phoneKey) || null;
  // v18.9.0: the server's rule (processInbound) — a "Not a customer"
  // conversation stores the message and does nothing else.
  const muted = !!(existing && existing.muted);
  const firstEver = !muted && (!existing || !existing.autoAckSent);

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
      occasions: parse.occasions || null,
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
    unread: !muted,
    windowExpiresAt: ts + WA_WINDOW_MS,
    language: lang,
    acceptedBadgeDismissedAt: null, // inbound re-shows the "confirmed" banner
    autoAckSent: true,
    _waSim: true,
  };
  if (!muted) { patch.archived = false; patch.archivedAt = null; } // auto-unarchive on inbound
  if (params.acceptedBookingId !== undefined) patch.acceptedBookingId = params.acceptedBookingId;

  // A draft intent sets/UPDATES the draft; question/other leave any existing
  // draft (or linked booking) untouched so we don't clobber an accepted thread.
  // Draft-aware merge (client-mode mirror of the backend rule): when a PENDING
  // draft exists, the new parse merges into it via the shared mergeDraft —
  // follow-up details fill gaps, corrections overwrite, confidence recomputed.
  // draftUpdatedAt: the intent-banner re-show gate (intentBannerVisible) —
  // stamped ONLY where a parse sets/updates the draft, so "thank you" can't
  // re-raise a handled banner. Mirrors the server's draftPatchFromParse.
  const draftPatch = isDraftIntent && !muted ? {
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
    ctx.upsertConversation(phoneKey, Object.assign({}, base, patch, { parsing: true, parsingAt: Date.now() }));
    ctx.appendMessage(phoneKey, inboundMsg);
    if (autoAckMsg) ctx.appendMessage(phoneKey, autoAckMsg);
    setTimeout(function () {
      ctx.patchConversation(phoneKey, Object.assign({ parsing: null, parsingAt: null }, draftPatch));
    }, WA_SIM_PARSE_MS);
    return phoneKey;
  }

  ctx.upsertConversation(phoneKey, Object.assign({}, base, patch, draftPatch || {}));
  ctx.appendMessage(phoneKey, inboundMsg);
  if (autoAckMsg) ctx.appendMessage(phoneKey, autoAckMsg);

  return phoneKey;
}

// ── Coexistence events (v18.9.0) ─────────────────────────────────────────────
// simulateCoexist(event, params, ctx) → a promise of the sentence the panel
// shows, rejected with the reason when the event cannot run. The events are
// src/lib/wa-sim-coexist.js's SIM_EVENTS; params are `{ phone, name, text,
// remove }` as each needs them.
//
// BACKEND MODE posts the event to /api/wa-sim-inbound, which stores it through
// the real webhook's handlers. CLIENT MODE stores the four the browser can
// write (a contact, a phone reply, an edit or delete, the history) through the
// same pure planners (src/lib/wa-coexist.js) and the hook's savers; anything
// that writes `waLink` or a message's media is the server's alone and is
// refused with the sentence `simEventRefusal` gives both halves.
//
// ctx: { conversations, messagesMap, contacts, waLink, upsertConversation,
//        patchConversation, appendMessage (the hook's simAppendMessage),
//        patchMessage, simSetContacts }
export function simulateCoexist(event, params, ctx) {
  const p = params || {};
  if (backendEnabled()) {
    return postSimEvent(event, p).then(function (data) { return coexistDone(event, p, data); });
  }
  const refusal = simEventRefusal(event, ctx.waLink, false);
  if (refusal) return Promise.reject(new Error(refusal));
  try {
    return Promise.resolve(clientCoexist(event, p, ctx)).then(function (r) { return coexistDone(event, p, r); });
  } catch (e) {
    return Promise.reject(e);
  }
}

function convOf(ctx, phoneKey) {
  return (ctx.conversations || []).find(function (c) { return c.phoneKey === phoneKey; }) || null;
}

// The conversation half of a client-mode write: a patch (update semantics)
// for one that exists, the patch as the whole record for a new one, as the
// server's upsertConversation does with the same patch.
function writeConv(ctx, phoneKey, existing, patch) {
  if (existing) ctx.patchConversation(phoneKey, patch);
  else ctx.upsertConversation(phoneKey, patch);
}

function clientCoexist(event, p, ctx) {
  const now = Date.now();
  if (event === "history") {
    let stored = 0, chats = 0, skipped = 0;
    const value = simHistoryValue(now);
    value.history[0].threads.forEach(function (thread) {
      const key = normalizePhone("+" + thread.id);
      // The browser reads only an open thread's messages, so it cannot ask
      // which of these are stored: a chat already here is left as it is.
      if (convOf(ctx, key)) { skipped++; return; }
      const plan = threadPlan(thread, [], simContent, function (id) { return id; }, now);
      if (!plan || plan.newest === -Infinity) return;
      writeConv(ctx, plan.phoneKey, null, historyConvPatch(null, { phoneKey: plan.phoneKey, oldest: plan.oldest, newest: plan.newest, snippet: snippet(plan.line), now }));
      plan.records.forEach(function (r) { ctx.appendMessage(plan.phoneKey, r); });
      stored += plan.records.length;
      chats++;
    });
    return { history: stored, chats, skipped };
  }
  const phoneKey = normalizePhone(p.phone);
  if (!phoneKey) throw new Error("Pick a conversation first.");
  if (event === "contact") {
    const value = simContactValue({ phone: phoneKey, name: p.name, remove: p.remove === true, now });
    const { patch } = contactPatch(value.state_sync, ctx.contacts || {}, now);
    if (!Object.keys(patch).length) throw new Error("Nothing to save: a newer change to this contact is stored.");
    return ctx.simSetContacts(patch).then(function (wrote) {
      if (!wrote) throw new Error("Nothing was saved: WhatsApp is off, or this is not the sandbox.");
      return {};
    });
  }
  const conv = convOf(ctx, phoneKey);
  if (event === "echo") {
    const text = String(p.text || "").trim();
    if (!text) throw new Error("Type the reply first.");
    const m = simEchoValue({ phone: phoneKey, text, now }).message_echoes[0];
    const content = simContent(m);
    writeConv(ctx, phoneKey, conv, echoConvPatch(conv, { phoneKey, phone: phoneKey, ts: now, snippet: snippet(content.snippet) }));
    ctx.appendMessage(phoneKey, echoRecord(m.id, m.id, content, now));
    return {};
  }
  // edit · revoke: the customer's newest message in the open thread.
  const list = (ctx.messagesMap || {})[phoneKey] || [];
  const target = lastCustomerMessage(list.map(function (m) { return { key: m.id, msg: m }; }));
  if (!target) throw new Error("That conversation has no message from the customer to " + (event === "edit" ? "edit." : "delete."));
  const text = String(p.text || "").trim();
  if (event === "edit" && !text) throw new Error("Type the edited text first.");
  const stored = target.msg;
  const patch = event === "revoke" ? revokePatch(stored, now) : editPatch(stored, text, now);
  if (!patch) return { outcome: "unchanged" };
  ctx.patchMessage(phoneKey, target.key, patch);
  if (conv && Number(conv.lastMessageAt) === Number(stored.ts)) {
    ctx.patchConversation(phoneKey, { lastMessageSnippet: snippet(changeLine(stored, patch, event === "edit" ? text : null)) });
  }
  return { outcome: "applied" };
}

// The panel's line for an event that ran, from what either half answered.
function coexistDone(event, p, r) {
  const res = (r && r.results) || r || {};
  if (event === "contact") return p.remove ? "Contact removed on the phone." : "Contact saved on the phone as " + (String(p.name || "").trim() || "(no name)") + ".";
  if (event === "echo") return "Reply sent from the phone.";
  if (event === "edit" || event === "revoke") {
    if (r && r.outcome && r.outcome !== "applied") return "Nothing changed: that message is already deleted.";
    return event === "edit" ? "The customer edited their last message." : "The customer deleted their last message.";
  }
  if (event === "history") {
    const n = Number(res.history) || 0;
    if (r && r.skipped && !r.chats) return "Both chats are here already. Clear conversations to import them again.";
    return n ? "Chat history imported: " + countLabel(n, "message", "messages") + "." : "Chat history is here already: nothing new to import.";
  }
  if (event === "history-media") return (Number(res.history) || 0) ? "The imported chat's photo arrived." : "The photo is there already.";
  if (event === "connect") return "Connected (simulated).";
  if (event === "disconnect") return "Disconnected (simulated): the inbox shows the banner.";
  if (event === "reconnect") return "Reconnected (simulated).";
  if (event === "forget") return r && r.removed ? "The simulated connection is forgotten." : "Nothing to forget: no simulated connection is recorded.";
  return "Done.";
}
