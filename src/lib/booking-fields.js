// src/lib/booking-fields.js
//
// ── v18.3.4: one table for the fields of a booking ───────────────────────────
// A booking's fields used to be written out by hand in eight places: `sanitize`,
// `UNDO_FIELDS` and `diffBooking` here, `openEdit`, `doSaveNew`, `doSaveEdit` and
// the weekly generator in App, and the walk-in in `useWalkin`. A field missing
// from any one of them is silently wiped or never written, and nothing goes red:
// v18.0.0 lost `voucherCode` that way with every test passing (ROADMAP #13).
//
// `BOOKING_FIELDS` is one row per STORED field, and each row answers, in one
// place, every question a new field has to answer:
//
//   read     how a read normalises it — `sanitize` is the rows in order;
//   undo     whether undo (and the reconciliation's day signature) compares it —
//            `UNDO_FIELDS` is the rows that say yes;
//   clause   the clause the edit's history line gives a change, at its position
//            in that line — `diffBooking` is the rows that have one;
//   draft    what the edit form opens with for it, at its position in the draft —
//            `draftFromBooking` (what `openEdit` opens) is the rows that have one.
//
// The row ORDER is the stored key order, because `sanitize`'s object literal set
// it and `write-path.js`'s `contentKey` is an order-sensitive JSON compare: a
// row that moves makes every stored booking read as changed. Append; never
// reorder. A `clause` and a `draft` state their positions instead, because the
// history line and the form's draft have always had orders of their own.
//
// The builders that WRITE a booking stay explicit code (Patryk, 2026-10-01): a
// generated builder hides the one decision worth seeing, which fields a
// particular save writes. `tests/booking-fields.test.js` checks each of them
// against this table instead, so a new row fails there until every builder has
// been decided for it.
//
// ── Imports: leaves only ─────────────────────────────────────────────────────
// `booking-logic.js` imports this file, so an import from here back into it
// would close a cycle. In a cycle one module's body runs before the other's, and
// whatever it reads from the other at MODULE scope is not initialised yet: a TDZ
// ReferenceError at load, in every importer. Neither file reads the other at
// module scope today (`booking-logic.js` reads `UNDO_FIELDS` only inside
// `undoKey`, at call time, and the derivations below read only this table), so
// such an edge would not fail at once; the next module-scope read added on either
// side would. Leaves only keeps that from being a question: `constants.js` and
// `vouchers.js` each import only `day.js`, which imports nothing. (v18.3.4's
// /code-review: this said `booking-logic.js` reads `UNDO_FIELDS` at module scope,
// which it does not.) Explicit ".js" specifiers: this
// file is on the WhatsApp backend's Node ESM chain (api/* → whatsapp.js →
// customers.js → booking-logic.js → here), and Node does not add the extension
// the way Vite does (`tests/wa-sandbox-integrity.test.js` walks it).
import { DUR_TIERS } from "./constants.js";
import { normalizeCode, formatCode } from "./vouchers.js";

// ── The helpers the rows read ────────────────────────────────────────────────
// Moved here from booking-logic.js (which re-exports them, so no import site
// changed) because the table needs them and the table may import only leaves.

// v16.1.0: default duration reads the DUR_TIERS live binding (settings/
// bookingDefaults via useBookingDefaults). Seed = the historical literals
// (≤4 → 90, else 120), so behaviour is unchanged until the setting is edited.
// Read at call time — never capture DUR_TIERS into a local (live binding).
export function getDur(s){const ts=DUR_TIERS.tiers||[];for(let i=0;i<ts.length;i++){if(s<=ts[i].max) return ts[i].dur;}return DUR_TIERS.restDur;}

export function genId(){return Date.now().toString(36)+Math.random().toString(36).slice(2,6);}

// v17.16.5 (CT-2A-03, client half): is this value a time the rest of the app can
// READ? `sanitize` has always guarded truthiness — `b.time || "13:00"` — and
// every consumer needs something `toMins` can take apart. The gap between the
// two is not academic: `toMins` is `t.split(":")` at 83 call sites, so a stored
// `time: 2000` survives sanitisation (a number is truthy), reaches the first
// consumer and throws `t.split is not a function`. v17.16.0's error boundary
// contains that crash; it does not make the day usable. And it is reachable
// from the server, because v17.16.1's per-field rules deliberately check TYPE
// and not FORMAT — the two halves of one finding, and this is the client half.
//
// The predicate is deliberately the CONSUMER'S requirement rather than a format
// of its own: readable means `toMins` yields a finite number. That is the
// narrowest possible guard — a value only stops being kept if it already throws
// or already produces NaN today — so nothing that currently works can move. The
// cost of that choice, stated rather than hidden: `":"` reads as 00:00 and is
// therefore KEPT, because it is not a crash. Times outside the day (`"25:99"`
// reads as 1599) are kept for the same reason; normalising them would rewrite a
// record that renders, which is a different decision and not this one.
export function isReadableTime(v){
  if(typeof v!=="string") return false;
  const p=v.split(":");
  return p.length>=2&&Number.isFinite(Number(p[0]))&&Number.isFinite(Number(p[1]));
}

// ── v18.0.0 session 8 (R5): what counts as a phone somebody ENTERED ─────────
// Empty, a bare "+", or exactly the untouched prefix seed all mean "no phone" —
// the prefix is a typing convenience the form puts in the field, not data.
// App's `cleanPhoneOf` has applied that rule on the SAVE path since v17.0.0.
// `diffBooking` applied HALF of it to one side ("+" only) and NONE of it to the
// other, so a booking with no stored phone, opened in a form that seeds "+34"
// into the field, differed from itself on every save: history recorded "phone
// none→+34" and the Undo pill was armed for a change that never happened, while
// the stored phone stayed "". Measured live 2026-09-11: 4 of 4 ordinary edits.
//
// One rule, one place, both callers — and `phonePrefix` has to be passed in
// because it is a restaurant SETTING and this module reads no settings.
export function enteredPhone(p,prefix){
  const t=p==null?"":String(p).trim();
  return (t===""||t==="+"||t===prefix)?"":t;
}

// ── The table ────────────────────────────────────────────────────────────────
// `read(b, out, key)`: `b` is the stored value, `out` the row built so far (so
// `scheduledTime` can fall back on the time already read), `key` the RTDB child
// key it was stored under. `clause.say(orig, draft, ctx)`: this field's clause
// in the history line, or null when it did not change; `ctx` is
// `{ size, phonePrefix }`. `draft.seed(b)`: the form's value for it, under the
// row's own key unless `draft.as` names the form's (the form never edits
// `tables` itself; it sends `manualTables`).
export const BOOKING_FIELDS = [
  // v17.16.13: `key` is the RTDB child key this row was stored under, and it is
  // the identity of LAST RESORT — `b.id || key || genId()`. It used to be
  // `b.id || genId()` with the key not passed at all, and `sanitizeAll` mapped
  // `Object.values(node)`, which THROWS THE KEY AWAY. So a `/bookings/{key}`
  // child whose stored value carries no `id` field got a brand-new identity on
  // every single read.
  //
  // That is the v17.16.4 block-id defect (CT-2B-06) one collection over, and
  // worse: there a `genId()` mint answered "what read was this" instead of "which
  // block is this" and had to be replaced by a content hash, because a block had
  // no stored identity to recover. A booking HAS one — it is the key — and the
  // code was discarding it two lines above the mint.
  //
  // Measured live against DEV (v17.16.13, three keyless rows left by an earlier
  // rules probe): every read invented ids, the write-diff saw a create, and
  // because `stampForWrite` had no `old` it stamped `baseUpdatedAt: 0` — which
  // the per-$id rule ACCEPTS for a create. So the row landed, the original
  // keyless row was read again, a new id was minted, and the node grew by one
  // booking per pass: `total=538 → 539 → 540 → 541` across four consecutive
  // listener fires, with the reconciliation effect re-placing the phantoms each
  // time. That effect writing forever is what `ROADMAP.md` recorded as an
  // oscillating reconciler; the reconciler was doing its job on data that changed
  // underneath it every read.
  //
  // The key is preferred over a mint and NOT over `b.id`: a row that states its
  // own identity keeps it, which is every row this app has ever written (the app
  // writes `id` inside the object AND uses it as the key, so the two agree). Only
  // a row written by something else — an Admin-SDK backend, a console edit, a
  // probe — reaches the `key` arm, and for those the key is the true identity by
  // definition, since it is the path the write went to.
  //
  // Not compared by undo: it is what undo matches rows BY.
  { key: "id", read: (b, out, key) => b.id || key || genId(), undo: false },
  { key: "name", read: (b) => b.name || "", undo: true, draft: { at: 1, seed: (b) => b.name },
    clause: { at: 1, say: (o, f) => (o.name !== f.name ? "name " + o.name + "→" + f.name : null) } },
  { key: "phone", read: (b) => b.phone || "", undo: true, draft: { at: 2, seed: (b) => b.phone || "" },
    clause: { at: 6, say: (o, f, c) => {
      const was = enteredPhone(o.phone, c.phonePrefix), now = enteredPhone(f.phone, c.phonePrefix);
      return was !== now ? "phone " + (was || "none") + "→" + (now || "none") : null;
    } } },
  { key: "date", read: (b) => b.date || "", undo: true, draft: { at: 3, seed: (b) => b.date },
    clause: { at: 4, say: (o, f) => (f.date !== o.date ? "date " + o.date + "→" + f.date : null) } },
  { key: "time", read: (b) => (isReadableTime(b.time) ? b.time : "13:00"), undo: true, draft: { at: 4, seed: (b) => b.time },
    clause: { at: 3, say: (o, f) => (f.time !== o.time ? "time " + o.time + "→" + f.time : null) } },
  { key: "scheduledTime", read: (b, out) => (isReadableTime(b.scheduledTime) ? b.scheduledTime : out.time), undo: true },
  { key: "size", read: (b) => Number(b.size) || 2, undo: true, draft: { at: 5, seed: (b) => b.size },
    clause: { at: 2, say: (o, f, c) => (c.size !== o.size ? "size " + o.size + "→" + c.size : null) } },
  // The length the form shows is `customDur || getDur(size)`, and the one the
  // booking was planned with is `originalDuration` (its `duration` once a seat or
  // an overstay has moved it), so the clause compares those two.
  { key: "duration", read: (b) => Number(b.duration) || 90, undo: true,
    clause: { at: 7, say: (o, f, c) => {
      const was = o.originalDuration || o.duration || 90, now = f.customDur || getDur(c.size);
      return was !== now ? "duration " + was + "→" + now + "min" : null;
    } } },
  { key: "originalDuration", read: (b) => Number(b.originalDuration) || Number(b.duration) || 90, undo: true },
  { key: "preference", read: (b) => b.preference || "auto", undo: true, draft: { at: 6, seed: (b) => b.preference },
    clause: { at: 5, say: (o, f) => (f.preference !== o.preference ? "pref " + o.preference + "→" + f.preference : null) } },
  { key: "notes", read: (b) => b.notes || "", undo: true, draft: { at: 7, seed: (b) => b.notes || "" },
    clause: { at: 9, say: (o, f) => (f.notes !== (o.notes || "") ? "notes updated" : null) } },
  { key: "status", read: (b) => b.status || "confirmed", undo: true, draft: { at: 8, seed: (b) => b.status },
    clause: { at: 8, say: (o, f) => (f.status !== o.status ? "status " + o.status + "→" + f.status : null) } },
  // The form never edits `tables` directly: it sends the tables picked by hand
  // (`manualTables`), and the history line names them. It opens with none.
  { key: "tables", read: (b) => (Array.isArray(b.tables) ? b.tables : []), undo: true,
    draft: { at: 12, as: "manualTables", seed: () => [] },
    clause: { at: 12, say: (o, f) => {
      const mt = Array.isArray(f.manualTables) && f.manualTables.length > 0 ? f.manualTables : null;
      return mt ? "tables manually set: " + mt.join(", ") : null;
    } } },
  // The form's length field. It opens on the planned length (`originalDuration`,
  // or `duration` before one existed) when that is not the default for the size,
  // and empty — "the default" — when it is.
  { key: "customDur", read: (b) => b.customDur || null, undo: true,
    draft: { at: 9, seed: (b) => ((b.originalDuration || b.duration) !== getDur(b.size) ? (b.originalDuration || b.duration) : null) } },
  // Clear (`_clearManual`) is what resets the hand placement, so it is this
  // row's clause.
  { key: "_manual", read: (b) => !!b._manual, undo: true,
    clause: { at: 13, say: (o, f) => (f._clearManual ? "manual assignment cleared" : null) } },
  { key: "_locked", read: (b) => !!b._locked, undo: true },
  { key: "_conflict", read: (b) => !!b._conflict, undo: true },
  { key: "preferredTables", read: (b) => (Array.isArray(b.preferredTables) ? b.preferredTables : []), undo: true,
    draft: { at: 13, seed: (b) => (Array.isArray(b.preferredTables) ? b.preferredTables.slice() : []) },
    clause: { at: 14, say: (o, f) => {
      const now = Array.isArray(f.preferredTables) ? f.preferredTables : [];
      const was = Array.isArray(o.preferredTables) ? o.preferredTables : [];
      return now.slice().sort().join(",") !== was.slice().sort().join(",") ? "preferred tables: " + (now.length ? now.join(", ") : "cleared") : null;
    } } },
  // Set only when Book Again creates a booking; the edit form opens without it,
  // and an edit never writes it.
  { key: "returnOf", read: (b) => b.returnOf || null, undo: true, draft: { at: 14, seed: () => null } },
  // Not compared by undo: every write appends to it, so comparing it would mark
  // every row changed.
  { key: "history", read: (b) => (Array.isArray(b.history) ? b.history : []), undo: false },
  // v16.0.0: no-show flag set by doCancelBooking(id,noShow=true). Whitelisted so
  // it survives reads; legacy no-shows (history entry only) are counted by
  // customers.js isNoShow's history fallback — no migration needed.
  { key: "noShow", read: (b) => !!b.noShow, undo: true },
  // v16.3.0: deposit / prepayment amount in € (0 = none). Whitelisted so it
  // survives reads; per-booking field → covered by the existing per-$id CAS.
  // Clamped ≥0 (/code-review): the form's min={0} only blocks the stepper —
  // a typed "-50" would otherwise pass Number() straight through.
  { key: "deposit", read: (b) => Math.max(0, Number(b.deposit) || 0), undo: true,
    draft: { at: 10, seed: (b) => (b.deposit ? String(b.deposit) : "") },
    clause: { at: 10, say: (o, f) => {
      const was = Math.max(0, Number(o.deposit) || 0), now = Math.max(0, Number(f.deposit) || 0);
      return was !== now ? "deposit " + was + "→" + now + " €" : null;
    } } },
  // v18.0.0: the gift voucher attached to this booking, "" for none. Per-booking,
  // so the existing per-$id CAS covers it — no new node and no rules change for
  // THIS half of the feature. Normalised on read through the same function the
  // issue field and every redemption lookup use, so a stored "abcd-2345" and a
  // stored "ABCD2345" can never resolve to two different vouchers. A row that
  // needs correcting self-heals on the next save, the way `sanitize` fills every
  // other gap.
  { key: "voucherCode", read: (b) => normalizeCode(b.voucherCode), undo: true,
    draft: { at: 11, seed: (b) => b.voucherCode || "" },
    clause: { at: 11, say: (o, f) => {
      const was = normalizeCode(o.voucherCode), now = normalizeCode(f.voucherCode);
      return was !== now ? "voucher " + (was ? formatCode(was) : "none") + "→" + (now ? formatCode(now) : "none") : null;
    } } },
  // v16.3.0: recurring-occurrence stamps (null for a one-off). recurringId links
  // to the settings/recurring rule; recurringDate is the occurrence's date. The
  // generator dedupes on these; doDelete adds recurringDate to the rule's
  // skipDates so a deleted occurrence is never regenerated.
  { key: "recurringId", read: (b) => b.recurringId || null, undo: true },
  { key: "recurringDate", read: (b) => b.recurringDate || null, undo: true },
  // v17.0.0: "Delete customer" anonymizes instead of deleting — the booking
  // stays for statistics as name "Data removed" (phone/notes/history wiped,
  // noShow kept). The flag excludes it from the name-search/autocomplete paths.
  { key: "anonymized", read: (b) => !!b.anonymized, undo: true },
  // v17.10.0: the SECOND customer-identity key, for guests who never give a
  // phone number — `"g"+<seed booking id>`, minted only when a human joins two
  // phone-less bookings from the name dropdown. Whitelisted so it survives
  // reads; per-booking field, so the existing per-$id updatedAt CAS covers it
  // and there is NO new node and no Firebase console step. See
  // customers.js → identityKey / matchCustomerFor.
  //
  // Not compared by undo, as it was not before v18.3.4, and no reason for that
  // is recorded. What it means: a join on its own takes no undo snapshot (the
  // edit offers no Undo — `tests/save-path.test.js` pins it), while an action
  // that moves a compared field too restores it with the rest, since a snapshot
  // is the whole row as it was.
  //
  // `guestSeed` is the draft's other half of a join: the booking picked from the
  // name list, stamped with the same id in the same write. Never stored.
  { key: "guestId", read: (b) => b.guestId || null, undo: false,
    draft: [{ at: 15, seed: (b) => b.guestId || null }, { at: 16, as: "guestSeed", seed: () => null }] },
  // v17.6.0: how long the party ACTUALLY stayed, in minutes — written by the two
  // completion paths ONLY on a real seated→completed transition (App.jsx's
  // updateStatus + doSave). Whitelisted so it survives reads. 0/absent means
  // "not known" (a direct confirmed→completed never sets it); read it through
  // booking-logic.js's stayedMins() rather than touching the field directly.
  //
  // Not compared by undo: only completion writes it, and completion always moves
  // `status` and `duration` too, which are.
  { key: "stayedMin", read: (b) => Number(b.stayedMin) || 0, undo: false },
  // v15.5.0: per-booking revision stamp for the per-node write model. Carried
  // through sanitise so it survives reads (this whitelist would otherwise drop
  // it) — used by usePersistence's write-diff/stamp + the per-$id Security Rule.
  //
  // Not compared by undo: per-write metadata, so a server echo must not read as
  // a change. (`baseUpdatedAt` is per-write metadata too, and is not a row at
  // all: a read drops it.)
  { key: "updatedAt", read: (b) => Number(b.updatedAt) || 0, undo: false },
];

// ── Derived: what a read keeps ───────────────────────────────────────────────
// The rows in order, so the key order is the table's. Anything not in the table
// is dropped, which is what makes it a whitelist: `baseUpdatedAt` and any field
// written by something other than this app.
export function sanitize(b,key){
  if(!b||typeof b!=="object") return null;
  const out={};
  BOOKING_FIELDS.forEach(function(row){ out[row.key]=row.read(b,out,key); });
  return out;
}

// ── Derived: what undo and the reconciliation compare ────────────────────────
// `booking-logic.js`'s `undoKey` joins these values in this order. The order of
// the list is not visible anywhere: the key is only ever compared with another
// key built the same way, never stored or shown, and every value is escaped
// against the separators, so two keys are equal exactly when every value is.
export const UNDO_FIELDS = BOOKING_FIELDS.filter(function(row){ return row.undo; }).map(function(row){ return row.key; });

// ── Derived: the edit's history line ─────────────────────────────────────────
const HISTORY_CLAUSES = BOOKING_FIELDS.filter(function(row){ return row.clause; })
  .map(function(row){ return row.clause; })
  .sort(function(a,b){ return a.at-b.at; });

// `size` is the size being saved, already a number; `phonePrefix` is the
// restaurant's (`settings/general`), because "no phone" includes the prefix the
// form seeds into the field.
export function diffBooking(orig,f,size,phonePrefix){
  const ctx={size:size,phonePrefix:phonePrefix};
  const ch=[];
  HISTORY_CLAUSES.forEach(function(h){ const s=h.say(orig,f,ctx); if(s) ch.push(s); });
  return ch.length?ch.join(", "):"saved (no field changes)";
}

// ── Derived: what the edit form opens with ───────────────────────────────────
// `openEdit`'s draft, in the order it has always had: the form's baseline for
// the unsaved-changes guard (`sameDraft`) is this object, and every field of it
// that the save reads back is one a row seeds. A field the draft leaves out is
// the silent wipe ROADMAP #13 named — the form opens without it and Save writes
// the gap.
const DRAFT_SEEDS = BOOKING_FIELDS.reduce(function(all,row){
  if(!row.draft) return all;
  return all.concat([].concat(row.draft).map(function(d){ return {key:d.as||row.key, at:d.at, seed:d.seed}; }));
},[]).sort(function(a,b){ return a.at-b.at; });

export function draftFromBooking(b){
  const d={};
  DRAFT_SEEDS.forEach(function(s){ d[s.key]=s.seed(b); });
  return d;
}
