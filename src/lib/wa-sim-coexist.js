// src/lib/wa-sim-coexist.js — the simulator's coexistence events (v18.9.0).
//
// What the WhatsApp Business app sends once the restaurant number is shared
// with MGT (coexistence): a contact saved on the phone, a reply typed on the
// phone, a customer editing or deleting a message, the chats the phone already
// held, and the connection itself going and coming back. Built here as Meta's
// webhook `value`s, so both halves of the simulator store them through the
// code the real webhooks go through:
//   · the server (api/_lib/sim-events.js, behind /api/wa-sim-inbound `event`)
//     hands them to api/_lib/coexist-core.js's own handlers;
//   · the client mode (src/lib/wa-sim.js) hands them to the same pure planners
//     in src/lib/wa-coexist.js and writes through the browser SDK.
//
// Pure, and shared with the server (Node ESM, so every specifier carries its
// `.js`). In src/ only the simulator imports it (tests/wa-sim-not-in-prod),
// so it never reaches a production chunk.

import { normalizePhone, WA_OPEN_ON_PHONE } from "./whatsapp.js";
import { simMediaMessage } from "./wa-mock-media.js";

// The restaurant's own number in a simulated webhook: postFakeWebhook's
// `display_phone_number`, so the simulator is one business throughout.
export const SIM_BUSINESS = "34600000000";
// The account and number a simulated connection names. Meta-shaped (digits,
// as wa-onboard checks), and in a range no real id is in.
export const SIM_WABA_ID = "999000000000001";
export const SIM_PHONE_NUMBER_ID = "999000000000002";
// The two chats "Import chat history" brings: one from this week, which stays
// in the Inbox, and one from forty days ago, which goes straight to Archived.
export const SIM_HISTORY_RECENT = "34611000101";
export const SIM_HISTORY_OLD = "34611000102";
// The photo in the recent chat, imported as a placeholder until "Photo for the
// imported chat" sends its media under the same id.
export const SIM_HISTORY_PHOTO_ID = "wamid-SIMHIST-101-3";

// Each event: `link`, it writes `waLink` on the server (refused while a REAL
// connection is recorded, see simMayTouchLink); `server`, only the backend can
// store it (the browser has no write on `waLink`, and only the server writes a
// message's media).
export const SIM_EVENTS = {
  contact: { link: true, server: false },
  echo: { link: false, server: false },
  edit: { link: false, server: false },
  revoke: { link: false, server: false },
  history: { link: true, server: false },
  "history-media": { link: false, server: true },
  connect: { link: true, server: true },
  disconnect: { link: true, server: true },
  reconnect: { link: true, server: true },
  forget: { link: true, server: true },
};

// May the simulator write `waLink`? Not over a connection Embedded Signup
// recorded: the sandbox runs on DEV Firebase, which is where the rehearsal's
// real connection lives (go-live plan §3b), and a simulated contact, history
// import or disconnection would put words in its Settings section and its
// banner that Meta never said. A link with no ids (only a sync's stamp) and a
// link the simulator made are fair game.
export function simMayTouchLink(link) {
  if (!link || typeof link !== "object") return true;
  if (link.sim === true) return true;
  return !link.wabaId && !link.phoneNumberId;
}

// simEventRefusal(event, link, viaServer) → the sentence the panel shows, or
// null when the event may run. One rule for both halves.
export function simEventRefusal(event, link, viaServer) {
  const rule = Object.prototype.hasOwnProperty.call(SIM_EVENTS, event) ? SIM_EVENTS[event] : null;
  if (!rule) return "Unknown event.";
  if (rule.server && !viaServer) return "Turn on backend mode first: only the server can store this.";
  if (rule.link && !simMayTouchLink(link)) return "A real Business-app connection is recorded on this database, so the simulator leaves it alone.";
  if ((event === "disconnect" || event === "reconnect") && !(link && link.sim === true)) return "Connect (simulated) first.";
  return null;
}

// ── Builders ─────────────────────────────────────────────────────────────────
const MIN = 60 * 1000;
const DAY = 24 * 60 * MIN;
function secs(ms) { return String(Math.floor(ms / 1000)); }
// Meta's digits for a number ("34600111222", no plus), as webhooks send it.
export function simDigits(phone) { return String(normalizePhone(phone) || "").replace(/^\+/, ""); }
// A wamid for a simulated message. Path-safe as it stands (no `.`), so the
// client mode can key a message by it exactly as the server's sanitizeKey does.
export function simWamid(tag) { return "wamid-SIM" + tag + "-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
function value(extra) { return Object.assign({ messaging_product: "whatsapp", metadata: { display_phone_number: SIM_BUSINESS } }, extra); }

// A contact saved, renamed (an `add` with the new name) or removed on the phone.
export function simContactValue({ phone, name, remove, now }) {
  const n = String(name || "").trim();
  const contact = { phone_number: simDigits(phone) };
  if (!remove) { contact.full_name = n; contact.first_name = n.split(" ")[0] || ""; }
  return value({ state_sync: [{ type: "contact", action: remove ? "remove" : "add", contact, metadata: { timestamp: secs(now) } }] });
}

// A reply typed on the phone to `phone`.
export function simEchoValue({ phone, text, now, id }) {
  return value({ message_echoes: [{
    from: SIM_BUSINESS, to: simDigits(phone), id: id || simWamid("ECHO"), timestamp: secs(now),
    type: "text", text: { body: String(text || "") },
  }] });
}

// The customer's edit (`kind: "edit"`, with the new `text`) or delete
// (`kind: "revoke"`) of the message `originalId`, as a `messages[]` item.
export function simChangeMessage({ kind, phone, originalId, text, now, id }) {
  const m = { from: simDigits(phone), id: id || simWamid(kind === "revoke" ? "DEL" : "EDIT"), timestamp: secs(now), type: kind };
  if (kind === "revoke") m.revoke = { original_message_id: originalId };
  else m.edit = { original_message_id: originalId, message: { type: "text", text: { body: String(text || "") } } };
  return m;
}

// The message a simulated edit or delete is about: the customer's newest that
// is not deleted already, from `entries` = [{ key, msg }] (the server's node,
// the client's open thread). Null when there is none.
export function lastCustomerMessage(entries) {
  let best = null;
  (entries || []).forEach(function (e) {
    const m = e && e.msg;
    if (!m || m.direction !== "in" || m.revokedAt) return;
    if (!best || (Number(m.ts) || 0) >= (Number(best.msg.ts) || 0)) best = e;
  });
  return best;
}

// The two chats the phone already held, in one history chunk (phase 0, 100%).
// The ids are fixed, so importing twice stores nothing the second time, as a
// redelivered chunk does; the times are counted back from `now`, so the recent
// chat is always this week's.
export function simHistoryValue(now) {
  const R = SIM_HISTORY_RECENT;
  const O = SIM_HISTORY_OLD;
  const t = function (ago) { return secs(now - ago); };
  const text = function (body) { return { type: "text", text: { body } }; };
  return value({ history: [{
    metadata: { phase: 0, chunk_order: 1, progress: 100 },
    threads: [
      { id: R, messages: [
        Object.assign({ from: R, id: "wamid-SIMHIST-101-1", timestamp: t(2 * DAY) }, text("Hola, ¿tenéis mesa para cuatro el sábado por la noche?")),
        Object.assign({ from: SIM_BUSINESS, to: R, id: "wamid-SIMHIST-101-2", timestamp: t(2 * DAY - 10 * MIN), history_context: { status: "READ" } }, text("¡Hola! Sí, a las 21:00 hay sitio. ¿A qué nombre?")),
        { from: R, id: SIM_HISTORY_PHOTO_ID, timestamp: t(2 * DAY - 20 * MIN), type: "media_placeholder" },
        Object.assign({ from: R, id: "wamid-SIMHIST-101-4", timestamp: t(DAY) }, text("Perfecto, a nombre de Lucía. ¡Gracias!")),
      ] },
      { id: O, messages: [
        Object.assign({ from: O, id: "wamid-SIMHIST-102-1", timestamp: t(40 * DAY) }, text("Buenas, ¿hacéis menú del día?")),
        Object.assign({ from: SIM_BUSINESS, to: O, id: "wamid-SIMHIST-102-2", timestamp: t(40 * DAY - 30 * MIN), history_context: { status: "DELIVERED" } }, text("Sí, de lunes a viernes a mediodía.")),
      ] },
    ],
  }] });
}

// The photo the recent chat's placeholder stands for, as the later `history`
// change Meta sends with `messages[]` under the same id. A MOCK media id, so
// /api/wa-media answers with the bundled sample while sending is mock.
export function simHistoryMediaValue(now) {
  const msg = Object.assign({ from: SIM_HISTORY_RECENT, id: SIM_HISTORY_PHOTO_ID, timestamp: secs(now - 2 * DAY + 20 * MIN) }, simMediaMessage("image", "La terraza"));
  return value({ messages: [msg] });
}

// The connection going (PARTNER_REMOVED, as removing it in the Business app
// does) or coming back.
export function simAccountValue(event) {
  return event === "disconnect"
    ? { event: "PARTNER_REMOVED", disconnection_info: { reason: "USER_REQUESTED", initiated_by: "BUSINESS" } }
    : { event: "ACCOUNT_RECONNECTED" };
}

// The `waLink` fields "Connect (simulated)" writes. `phoneNumberId` is the
// deployment's own META_PHONE_NUMBER_ID when it has one, so Settings shows no
// mismatch warning for a connection nobody can set the variable for.
export function simLinkPatch({ now, by, phoneNumberId }) {
  return {
    status: "connected", wabaId: SIM_WABA_ID, phoneNumberId: phoneNumberId || SIM_PHONE_NUMBER_ID,
    connectedAt: now, connectedBy: String(by || ""), sim: true, disconnect: null,
  };
}

// What the inbox shows for a message this file builds: a text's body, or the
// placeholder's line. The server reads the same messages with
// `inboundContent` (api/_lib/inbound-core.js), which the browser cannot
// import; tests/api-handlers.test.js holds the two to one answer for every
// message the history chunk carries.
export function simContent(m) {
  if (m && m.type === "text" && m.text && typeof m.text.body === "string") {
    return { text: m.text.body, media: null, snippet: m.text.body };
  }
  const line = "Photo or file — " + WA_OPEN_ON_PHONE;
  return { text: line, media: null, snippet: line };
}
