// src/lib/whatsapp.js
//
// WhatsApp Inbox — pure helpers (no React, no DOM). Ported from the
// pre-refactor preview (`restaurant_booking_v_unknown_preview 6.jsx`) into the
// current architecture as a sibling to booking-logic.js / reminders.js.
//
// These are the channel-agnostic primitives the WA module shares: phone
// normalisation, customer matching across the bookings list, relative/clock
// time formatting, and the 24-hour service-window calculation. The real LLM
// intent classification and Meta Cloud API plumbing live in the (deferred)
// Phase 1b backend; here we only carry what the UI + local simulator need.

// ≥ this viewport width → two-pane inbox; below → stacked (list ⇄ conversation).
export const INBOX_TWO_PANE_BREAKPOINT = 900;

// The WhatsApp service-conversation window: 24h from the last INBOUND message.
export const WA_WINDOW_MS = 24 * 60 * 60 * 1000;

// Inbound-text safety caps, shared client/server so every path agrees.
// A legitimate booking message is <300 chars — these only bite hostile or
// garbage input (signature-valid traffic CAN be hostile: any customer).
//   WA_MAX_TEXT_LEN   — chars STORED per message (RTDB bloat guard)
//   WA_PARSE_TEXT_LEN — chars sent to the LLM prompt (token/quota guard)
export const WA_MAX_TEXT_LEN = 4000;
export const WA_PARSE_TEXT_LEN = 1000;

// Default quick-reply templates (EN/ES). Staff-editable via the TemplatesEditor;
// persisted to Firebase `templates/` in this sandbox (was localStorage in the
// preview). Seeded once on first load when the node is empty.
export const DEFAULT_TEMPLATES = [
  { id: "t1", key: "confirm", labelEn: "Confirm", labelEs: "Confirmar", textEn: "Your booking is confirmed — see you soon!", textEs: "Su reserva está confirmada — ¡le esperamos!" },
  { id: "t2", key: "ask_size", labelEn: "Ask size", labelEs: "Pedir número", textEn: "How many people will you be?", textEs: "¿Para cuántas personas?" },
  { id: "t3", key: "ask_time", labelEn: "Ask time", labelEs: "Pedir hora", textEn: "What time would you like to come?", textEs: "¿A qué hora le gustaría venir?" },
  { id: "t4", key: "full", labelEn: "Fully booked", labelEs: "Completo", textEn: "Sorry, we're fully booked then. Could another time work?", textEs: "Lo siento, estamos completos. ¿Le sirve otra hora?" },
  { id: "t5", key: "large_group", labelEn: "Large group", labelEs: "Grupo grande", textEn: "For groups of 10+, please call us to arrange the booking.", textEs: "Para grupos de 10+, llámenos por favor para coordinar." },
];

// The auto-acknowledgment text sent on a customer's first-ever inbound message,
// matched to the detected language. (In Phase 1b this gating is server-side.)
export const AUTO_ACK_TEXT = {
  en: "Thanks for your message! We'll get back to you shortly.",
  es: "¡Gracias por su mensaje! Le contestaremos en breve.",
};

// Phone normalisation: strip all non-digits except a single leading +.
// Used for matching customers across bookings and conversations — the same
// normaliser must run everywhere so keys line up.
export function normalizePhone(p) {
  if (!p) return "";
  const s = String(p).trim();
  const hasPlus = s.charAt(0) === "+";
  const digits = s.replace(/[^\d]/g, "");
  return (hasPlus ? "+" : "") + digits;
}

// Pretty display phone (inserts a space after the country code for readability).
export function formatPhone(p) {
  if (!p) return "";
  const n = normalizePhone(p);
  if (n.length < 4) return n;
  if (n.charAt(0) === "+") return n.slice(0, 3) + " " + n.slice(3);
  return n;
}

// matchCustomerByPhone — look up a customer by phone across the bookings list.
// Returns null if there's no match. Otherwise:
//   name            — most recent booking's name (for display)
//   count           — total bookings matched (all statuses, incl. the linked one)
//   latestDate      — most recent booking date
//   all             — all matched bookings, sorted by date desc
//   regularCount    — bookings that count toward "regular" status: completed AND
//                     not the currently linked booking. Confirmed/cancelled don't
//                     count. Gates the "Regular · X past visits" chip.
//   regularBookings — those bookings, sorted desc by date.
// excludeBookingId is the conversation's acceptedBookingId (the linked booking),
// excluded so a customer's first-ever booking doesn't trigger the regular chip.
export function matchCustomerByPhone(phoneKey, bookings, excludeBookingId) {
  if (!phoneKey || !Array.isArray(bookings)) return null;
  const key = normalizePhone(phoneKey);
  if (!key) return null;
  const matches = bookings.filter((b) => b && b.phone && normalizePhone(b.phone) === key);
  if (!matches.length) return null;
  const sorted = matches.slice().sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  const regular = sorted.filter((b) => b.status === "completed" && (!excludeBookingId || b.id !== excludeBookingId));
  return {
    name: sorted[0].name,
    count: matches.length,
    latestDate: sorted[0].date,
    all: sorted,
    regularCount: regular.length,
    regularBookings: regular,
  };
}

// Human-readable relative time ("2 min ago", "yesterday", "3 days ago").
export function formatRelativeTime(ts) {
  if (!ts) return "";
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return m + " min ago";
  const h = Math.floor(m / 60);
  if (h < 24) return h + "h ago";
  const d = Math.floor(h / 24);
  if (d === 1) return "yesterday";
  if (d < 7) return d + " days ago";
  const dt = new Date(ts);
  return dt.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
}

// Format a timestamp as an inline bubble caption ("14:32").
export function formatClockTime(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
}

// Format remaining time on the 24h WA window → { label, expired } or null.
export function formatWindow(expiresAt) {
  if (!expiresAt) return null;
  const diff = expiresAt - Date.now();
  if (diff <= 0) return { label: "Window expired", expired: true };
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  if (h >= 1) return { label: "Window: " + h + "h " + m + "m left", expired: false };
  return { label: "Window: " + m + "m left", expired: false };
}

// clampConfidence(stated, draft) — the confidence ceiling rule (decided
// 2026-06-26). HIGH is allowed ONLY when every crucial field (size, date, time)
// is present AND there is no ambiguity. Count "issues" = missing crucial fields
// + (1 if an ambiguity note is present): 0 → high · 1 → medium · 2+ → low. The
// LLM's own stated confidence is the ceiling's upper bound (so a complete draft
// the model still flagged low/medium isn't bumped up). Single source of truth,
// applied wherever a draft is finalized (mergeDraft here, the server's
// draftPatchFromParse, and the client simulator's draftData build).
export function clampConfidence(stated, draft) {
  const d = draft || {};
  const missing = [d.size, d.date, d.time].filter((v) => v === null || v === undefined || v === "").length;
  const hasAmbiguity = !!(d.ambiguity && String(d.ambiguity).trim());
  const issues = missing + (hasAmbiguity ? 1 : 0);
  const ceiling = issues >= 2 ? "low" : issues === 1 ? "medium" : "high";
  const rank = { low: 0, medium: 1, high: 2 };
  const s = rank[stated] != null ? rank[stated] : 2; // unknown stated → let the ceiling govern
  return ["low", "medium", "high"][Math.min(s, rank[ceiling])];
}

// mergeDraft — the mechanical draft-update rule, shared by the server MOCK
// parser (api/_lib/gemini.js) and the client-mode simulator (wa-sim.js) so
// every test mode exercises the same flow the LIVE path gets semantically from
// Gemini (which receives the existing draft in its prompt and merges itself).
//
// Policy (decided 2026-06-05): ANY pending draft (draftStatus "parsed") is
// updated by follow-up messages — new details fill gaps, corrections overwrite,
// confidence is re-assessed and can go up OR down. Accepted/dismissed drafts
// are never touched here (the cancel/modify intent-banner flow owns those).
//
// Rules:
//   · different intent → return the new parse unchanged (the request changed —
//     e.g. a pending new_booking turns into a cancel; replace is correct).
//   · same intent → non-null-overwrite: a field the new message states wins;
//     a field it doesn't mention keeps the old value. notes: new if non-empty.
//   · confidence recomputed from the MERGED fields: size+date+time all present
//     → high · two of three → medium · else low.
//   · ambiguity: the new parse's note if present; cleared when everything is
//     filled; otherwise the old note carries over.
export function mergeDraft(oldDraft, newParse) {
  if (!oldDraft) return newParse;
  if (!newParse) return oldDraft;
  if (newParse.intent !== oldDraft.intent) return newParse;
  const pick = (a, b) => (a !== null && a !== undefined && a !== "" ? a : (b !== null && b !== undefined ? b : null));
  const merged = {
    intent: newParse.intent,
    name: pick(newParse.name, oldDraft.name),
    size: pick(newParse.size, oldDraft.size),
    date: pick(newParse.date, oldDraft.date),
    time: pick(newParse.time, oldDraft.time),
    notes: pick(newParse.notes, oldDraft.notes) || "",
    language: pick(newParse.language, oldDraft.language),
  };
  const filled = [merged.size, merged.date, merged.time].filter((v) => v !== null && v !== undefined && v !== "").length;
  merged.ambiguity = newParse.ambiguity || (filled === 3 ? null : oldDraft.ambiguity || null);
  merged.confidence = clampConfidence(newParse.confidence, merged);
  return merged;
}

// intentBannerVisible(conv) — single source of truth for the cancel/modify
// intent-banner show condition (ConversationView render + useWhatsApp's
// autoHandleCancelIntent gate). Once handled, the banner re-shows ONLY when a
// later inbound actually RENEWS the request: gate on `draftUpdatedAt`, stamped
// exclusively where an inbound parse SETS/UPDATES the draft (server
// draftPatchFromParse, client simulateInbound). Two wrong gates rejected in
// live QA 2026-06-13: `lastMessageAt` (staff's own reply resurrected the
// banner) and a bare every-inbound stamp (a customer's "thank you" did).
// "other"/"question" parses leave drafts — and this stamp — untouched, so only
// an actionable message re-raises the alert. Conversations written before the
// field existed read as 0: a handled banner stays hidden until the next
// actionable inbound stamps it.
export function intentBannerVisible(conv) {
  if (!conv || !conv.draftData) return false;
  const intent = conv.draftData.intent;
  if (intent !== "cancel" && intent !== "modify") return false;
  const handledAt = conv.intentHandledAt || 0;
  if (!handledAt) return true;
  return (conv.draftUpdatedAt || 0) > handledAt;
}

// sortConversations — the canonical inbox ordering for one tab: filter by the
// active tab (archived vs inbox), then sort newest-first. Inbox sorts by
// lastMessageAt; archived sorts by archivedAt (falling back to lastMessageAt).
// Shared by the list render (ConversationList) AND the keyboard-nav index math
// (InboxPanel) so the visible order and the ↑/↓ order can never drift apart.
// `.filter` already returns a fresh array, so the subsequent sort never mutates
// the caller's `conversations`.
export function sortConversations(conversations, archivedView) {
  if (!Array.isArray(conversations)) return [];
  return conversations
    .filter((c) => (archivedView ? c.archived : !c.archived))
    .sort((a, b) =>
      archivedView
        ? (b.archivedAt || b.lastMessageAt || 0) - (a.archivedAt || a.lastMessageAt || 0)
        : (b.lastMessageAt || 0) - (a.lastMessageAt || 0)
    );
}
