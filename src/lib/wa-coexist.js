// src/lib/wa-coexist.js
//
// v18.9.0 — WhatsApp COEXISTENCE, the pure half: what each coexistence webhook
// becomes in the database, decided once. The server (api/_lib/coexist-core.js)
// reads what it needs, asks these functions and writes the answer through
// firebase-admin; the simulator's client mode (src/lib/wa-sim.js) asks the same
// functions and writes through the browser SDK — so a simulated contact or phone
// reply is stored the way a real one is, and the inbox can be checked on DEV
// without a deployment.
//
// Imported under Node ESM by api/_lib, so every specifier carries its `.js`
// extension (api/CLAUDE.md). Imported in src/ by the simulator alone, which a
// production build loads through a dead dynamic import.

import { normalizePhone, isPhoneKey, mediaLabel, WA_MAX_TEXT_LEN } from "./whatsapp.js";

// secondsTs(raw, now) — a Meta timestamp (seconds since the epoch, usually as a
// string) as ms, clamped to FACTS: not a positive finite number → now; in the
// future → now (a delivery cannot be stamped after it arrived, so this only
// absorbs clock skew); an old one is left alone, because a redelivery after an
// outage, and every message of an imported history, is genuinely old. The rule
// api/wa-inbound.js's `inboundTs` was written for (CT-WA-02, with the
// measurements), shared now that four more webhook fields carry timestamps.
export function secondsTs(raw, now) {
  if (raw === undefined || raw === null || raw === "") return now;
  const ms = parseInt(raw, 10) * 1000;
  if (!Number.isFinite(ms) || ms <= 0) return now;
  return Math.min(ms, now);
}

// webhookPhoneKey(digits) — the conversation key for a number as Meta sends it
// ("34600111222", no plus), or null when it is not one (`isPhoneKey`: "+" is a
// legal RTDB key and is nobody).
export function webhookPhoneKey(digits) {
  const k = normalizePhone("+" + String(digits == null ? "" : digits).replace(/^\+/, ""));
  return isPhoneKey(k) ? k : null;
}

// ── Contacts: the phone's address book (smb_app_state_sync) ─────────────────
// Each contact the Business app holds arrives as one `state_sync[]` item:
//   { type: "contact", action: "add" | "remove",
//     contact: { full_name, first_name, phone_number }, metadata: { timestamp } }
// An edit on the phone arrives as an `add` with the new name. Every contact is
// KEPT (Patryk, 2026-10-15), suppliers and staff included, so a regular saved
// months ago is named the first time they write.
//
// Stored at `waContacts/<phoneKey>` as `{ name, first?, at }`. Written by the
// server alone (the Admin SDK), deleted by the browser only per key, by Delete
// customer — the rules grant `waContacts/$phoneKey` and nothing above it.
export const WA_CONTACT_NAME_MAX = 80;

// What a name from the phone may hold: no control characters (it is shown, and
// it reaches a CSV), whitespace collapsed, trimmed, capped.
export function cleanContactName(s) {
  if (typeof s !== "string") return "";
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, WA_CONTACT_NAME_MAX);
}

// contactPlan(item, now) → null (not a contact we can key) or
// `{ phoneKey, contact }`, where `contact` is the record to store, or null to
// delete it. A contact saved with no name at all is still SAVED: it is stored
// with `name: ""`, which names nothing (the inbox falls through to the booking)
// and still says "saved on the phone".
export function contactPlan(item, now) {
  if (!item || typeof item !== "object" || item.type !== "contact") return null;
  const c = item.contact;
  if (!c || typeof c !== "object") return null;
  const phoneKey = webhookPhoneKey(c.phone_number);
  if (!phoneKey) return null;
  const at = secondsTs(item.metadata && item.metadata.timestamp, now);
  if (item.action === "remove") return { phoneKey, at, contact: null };
  const first = cleanContactName(c.first_name);
  const contact = { name: cleanContactName(c.full_name) || first, at };
  if (first && first !== contact.name) contact.first = first;
  return { phoneKey, at, contact };
}

// contactPatch(items, stored, now) → `{ patch, count }`: the per-key update of
// `waContacts` one webhook makes. `stored` is the node as read (or {}). A change
// OLDER than what is stored is skipped, so an edit delivered out of order never
// replaces a newer name with an older one; the later of two changes to one key
// in the same webhook wins. A remove deletes the key and leaves no marker, so an
// add delivered after the remove that followed it brings the contact back —
// Meta delivers in order unless a delivery failed, and the cost is a stale name.
export function contactPatch(items, stored, now) {
  const patch = {};
  const seenAt = {};
  let count = 0;
  (Array.isArray(items) ? items : []).forEach(function (item) {
    const p = contactPlan(item, now);
    if (!p) return;
    const prior = Object.prototype.hasOwnProperty.call(seenAt, p.phoneKey)
      ? seenAt[p.phoneKey]
      : (stored && stored[p.phoneKey] && Number(stored[p.phoneKey].at)) || 0;
    if (prior > p.at) return;
    seenAt[p.phoneKey] = p.at;
    patch[p.phoneKey] = p.contact;
    count++;
  });
  return { patch, count };
}

// ── Phone replies (smb_message_echoes) ───────────────────────────────────────
// A message staff send from the WhatsApp Business app on the phone comes back
// as an ECHO: `message_echoes[]`, each shaped like an inbound message but with
// `from` = the restaurant and `to` = the customer. It is stored as an outgoing
// message with `source: "phone"`, so the thread in MGT is the whole
// conversation, whichever of the two the reply was typed on.
export const WA_SOURCE_PHONE = "phone";

// echoRecord(msgId, wamid, content, ts) — the stored message. `content` is what
// `inboundContent` made of it (the text, the media). Its status stays "sent":
// Meta reports delivery for what the API sent, and the bubble shows "phone" in
// that place anyway.
export function echoRecord(msgId, wamid, content, ts) {
  const msg = {
    id: msgId, direction: "out", source: WA_SOURCE_PHONE,
    text: String((content && content.text) || ""), ts, status: "sent",
    isAutoAck: false, channel: "whatsapp", providerMsgId: wamid || null,
  };
  if (content && content.media) msg.media = content.media;
  return msg;
}

// echoConvPatch(existing, { phoneKey, phone, ts, snippet }) — what a phone reply
// does to its conversation (Patryk, 2026-10-15):
//   · it is READ — staff answered it, on the phone
//   · it comes back out of Archived, as a reply from MGT does (`api/wa-send.js`)
//     — unless the conversation is muted ("Not a customer"), which stays put
//   · the auto-reply is settled: a customer the restaurant has written to from
//     the phone is not a new customer (`autoAckSent: true`)
//   · the 24h window is NOT touched: only the customer's own message opens it
//   · the snippet and time move only FORWARD, so a delayed echo never makes an
//     older reply the conversation's last line
// A conversation the phone started is created here, with the shape
// `processInbound` creates one with, minus the window.
export function echoConvPatch(existing, o) {
  const patch = { unread: false, autoAckSent: true };
  if (!existing) {
    return Object.assign(patch, {
      phoneKey: o.phoneKey, phone: o.phone || o.phoneKey, channel: "whatsapp",
      createdAt: o.ts, lastMessageAt: o.ts, lastMessageSnippet: o.snippet,
      acceptedBookingId: null, draftStatus: null, draftData: null,
      archived: false, archivedAt: null,
    });
  }
  if (!(Number(existing.lastMessageAt) > o.ts)) {
    patch.lastMessageAt = o.ts;
    patch.lastMessageSnippet = o.snippet;
  }
  if (existing.archived && !existing.muted) { patch.archived = false; patch.archivedAt = null; }
  return patch;
}

// ── A customer edits or deletes a message (messages: edit / revoke) ─────────
// WhatsApp lets a customer EDIT a message for 15 minutes and DELETE it for
// everyone for two days, and under coexistence Meta tells the business. The
// thread follows the customer (Patryk, 2026-10-15): an edit replaces the text
// and marks the bubble "edited"; a delete replaces the text with a line saying
// so and drops the media. Neither is parsed again — a draft already made from
// the first version stays, and staff see the change in the thread. The same
// two arrive as ECHOES when staff edit or delete on the phone.
export const WA_REVOKED_IN = "Message deleted by the customer";
export const WA_REVOKED_OUT = "Message deleted on the phone";

// The id of the message an edit or a delete is about, or null.
export function changedMessageId(m) {
  const t = m && m.type;
  const body = t === "edit" ? m.edit : t === "revoke" ? m.revoke : null;
  const id = body && body.original_message_id;
  return typeof id === "string" && id ? id : null;
}

// The message an edit carries, as a webhook message of its own type, so
// `inboundContent` can read it when the original is not stored (it arrived
// before onboarding, or was pruned): the edit is then kept as a new message,
// under the edit's own id. Null when the edit carries no message.
export function editedMessage(m) {
  const inner = m && m.type === "edit" && m.edit && m.edit.message;
  if (!inner || typeof inner !== "object") return null;
  const type = typeof inner.type === "string" && inner.type ? inner.type : inner.text ? "text" : "";
  return Object.assign({}, inner, { type, id: m.id, from: m.from, to: m.to, timestamp: m.timestamp });
}

// The new text an edit carries: a text's body, or a photo's or a document's
// caption. Null when it carries neither, which leaves nothing to apply. Read
// here rather than through `inboundContent` because an edited caption may come
// without the media id, and `inboundContent` would read that as a message that
// stays on the phone.
export function editedText(m) {
  const inner = editedMessage(m);
  if (!inner) return null;
  if (inner.type === "text") return inner.text && typeof inner.text.body === "string" ? inner.text.body : null;
  const body = inner.type ? inner[inner.type] : null;
  return body && typeof body === "object" && typeof body.caption === "string" ? body.caption : null;
}

// editPatch(stored, text, ts) → the patch of a stored message, or null when
// there is nothing to apply: it was deleted already (a delete is final). A
// photo keeps its photo, and a caption edited away leaves the photo's label.
export function editPatch(stored, text, ts) {
  if (!stored || stored.revokedAt || typeof text !== "string") return null;
  const t = text.trim() ? text.slice(0, WA_MAX_TEXT_LEN) : stored.media ? mediaLabel(stored.media) : "";
  return { text: t, editedAt: ts };
}

// revokePatch(stored, ts) → the patch that deletes a message's content, or null
// when it is gone already. The record stays, so the thread keeps its shape and
// a later edit of it finds something to refuse.
export function revokePatch(stored, ts) {
  if (!stored || stored.revokedAt) return null;
  return { text: stored.direction === "in" ? WA_REVOKED_IN : WA_REVOKED_OUT, media: null, revokedAt: ts };
}

// ── History: the chats the phone already held (history) ──────────────────────
// Once, after onboarding and only if the business agreed on the phone, Meta
// sends the Business app's 1:1 chats of the last 180 days, in three phases
// (0: the last day, 1: to 90 days, 2: to 180), each in chunks:
//   history[] = [{ metadata: { phase, chunk_order, progress },
//                  threads: [{ id: <customer's number>, messages: [ … ] }] }]
// Each message is shaped as a webhook message, plus `history_context.status`.
// A photo or a file comes as a `media_placeholder`, and its media follows in a
// later `history` change carrying `value.messages[]` with the same id (within
// 14 days only). A business that said no gets error 2593109 instead.
//
// What an imported chat is (Patryk, 2026-10-15): read, never parsed, never
// auto-replied, and archived when nothing in it is newer than a week, so the
// inbox opens on today's customers and not on six months of the phone.
export const WA_HISTORY_DECLINED = 2593109;
export const WA_IMPORT_ARCHIVE_MS = 7 * 24 * 60 * 60 * 1000;

// What the phone says became of a message the restaurant sent, as this app's
// statuses. A customer's own message is "delivered", as a live one is.
const HISTORY_STATUS = { PENDING: "sending", SENT: "sent", DELIVERED: "delivered", READ: "read", PLAYED: "read", ERROR: "failed" };
export function historyStatus(m, incoming) {
  if (incoming) return "delivered";
  const ctx = m && m.history_context;
  const s = ctx && typeof ctx.status === "string" ? ctx.status.toUpperCase() : "";
  return HISTORY_STATUS[s] || "sent";
}

// historyRecord(msgId, wamid, content, ts, incoming, status) — an imported
// message. `imported: true` says where it came from; the restaurant's side
// is tagged "phone", which is where it was typed.
export function historyRecord(msgId, wamid, content, ts, incoming, status) {
  const msg = {
    id: msgId, direction: incoming ? "in" : "out",
    text: String((content && content.text) || "").slice(0, WA_MAX_TEXT_LEN), ts, status,
    isAutoAck: false, channel: "whatsapp", providerMsgId: wamid || null, imported: true,
  };
  if (!incoming) msg.source = WA_SOURCE_PHONE;
  if (content && content.media) msg.media = content.media;
  return msg;
}

// historyConvPatch(existing, { phoneKey, oldest, newest, snippet, now }) —
// what an imported thread does to its conversation. A NEW conversation is
// created read, settled for the auto-reply (an existing customer), with no
// 24h window (Meta opens none for a message from before onboarding), and in
// Archived when its newest message is over a week old. An EXISTING one is
// settled too; its line and time move only forward, and its `createdAt`
// moves BACK to the oldest imported message, because the nightly prune reads
// only a conversation created before its cutoff (`mayHoldOld`,
// api/wa-prune.js): left alone, an imported message older than the
// conversation would outlive the retention it is under.
export function historyConvPatch(existing, o) {
  const patch = { autoAckSent: true };
  if (!existing) {
    const old = o.newest < o.now - WA_IMPORT_ARCHIVE_MS;
    return Object.assign(patch, {
      phoneKey: o.phoneKey, phone: o.phoneKey, channel: "whatsapp",
      createdAt: o.oldest, lastMessageAt: o.newest, lastMessageSnippet: o.snippet, unread: false,
      acceptedBookingId: null, draftStatus: null, draftData: null,
      archived: old, archivedAt: old ? o.now : null,
    });
  }
  if (!(Number(existing.lastMessageAt) > o.newest)) {
    patch.lastMessageAt = o.newest;
    patch.lastMessageSnippet = o.snippet;
  }
  if (!(Number(existing.createdAt) <= o.oldest)) patch.createdAt = o.oldest;
  return patch;
}

// Did the business decline to share its history? Meta answers 2593109 on the
// history item (or, defensively, on the change itself).
export function historyDeclined(x) {
  return !!(x && Array.isArray(x.errors) && x.errors.some(function (e) { return e && Number(e.code) === WA_HISTORY_DECLINED; }));
}

// historyProgress(cur, meta, now) → `waLink.history` after one chunk: the
// progress (0–100) and the phase only move forward, since chunks may arrive
// out of order, and `doneAt` is stamped once, at 100.
export function historyProgress(cur, meta, now) {
  const next = Object.assign({}, cur && typeof cur === "object" ? cur : {});
  const p = Number(meta && meta.progress);
  if (Number.isFinite(p)) next.progress = Math.max(Number(next.progress) || 0, Math.min(100, Math.max(0, p)));
  const ph = Number(meta && meta.phase);
  if (Number.isFinite(ph)) next.phase = Math.max(Number(next.phase) || 0, ph);
  next.at = now;
  if (next.progress >= 100 && !next.doneAt) next.doneAt = now;
  return next;
}
