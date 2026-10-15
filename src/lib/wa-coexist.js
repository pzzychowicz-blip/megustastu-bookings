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

import { normalizePhone, isPhoneKey } from "./whatsapp.js";

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
