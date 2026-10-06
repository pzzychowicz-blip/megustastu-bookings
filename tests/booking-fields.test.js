// tests/booking-fields.test.js — v18.3.4 phase 8
//
// ── THE GUARD: a booking field reaches STORAGE ──────────────────────────────
// A booking's fields are one table, `BOOKING_FIELDS` (src/lib/booking-fields.js):
// the read, undo, the edit's history line and the edit form's draft are derived
// from its rows. The four builders that WRITE a booking are not: `buildBooking`,
// `applyEdit`, `walkinBooking` and `occurrenceBooking` (src/lib/booking-save.js)
// stay explicit code, because which fields a particular save writes is the one
// decision worth seeing (Patryk, 2026-10-01). This file checks each of them
// against the table instead, so a new row fails here until every builder has
// been decided for it.
//
// What it replaces: a grep that paired `deposit:` with `voucherCode:` on any
// line also setting `status:`. It knew one pair of fields, could not see the
// walk-in (which writes no deposit), and checked spelling rather than what was
// stored. v18.0.0 lost `voucherCode` on the write side with every test passing,
// and the wipe it describes — a field the edit form does not open with is
// written back empty by the next save — is invisible until somebody edits a
// booking that had one. Both are run here, not read.
//
// One check reads source: which code opens the booking form on an EXISTING
// booking (v18.3.4's /code-review). It reads it comment-stripped
// (tests/test-hygiene.test.js), because comments here name the call it hunts.

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { stripComments } from "../scripts/strip-comments.mjs";
import { BOOKING_FIELDS, sanitize, draftFromBooking } from "../src/lib/booking-fields.js";
import { applyEdit, buildBooking, walkinBooking, occurrenceBooking } from "../src/lib/booking-save.js";
import { undoSnapshots } from "../src/lib/booking-logic.js";
import { EMPTY_FORM } from "../src/lib/constants.js";
import { normalizeCode } from "../src/lib/vouchers.js";
import { addDays, todayStr } from "../src/lib/day.js";

const KEYS = BOOKING_FIELDS.map((r) => r.key);
const today = todayStr();
// An ordinary future date (tests/CLAUDE.md: derived, never a literal): no seat,
// no completion, and the optimiser's day.
const D = addDays(today, 14);

// ── What every written row must be ──────────────────────────────────────────
// Only the table's keys (a read drops anything else, so a key outside it is
// written and lost), and no `undefined` anywhere: RTDB's `set()` and
// `update()` throw on one, which inside the write path refuses the whole save.
function undefinedAt(v, path) {
  if (v === undefined) return [path];
  if (v === null || typeof v !== "object") return [];
  return Object.keys(v).flatMap((k) => undefinedAt(v[k], path + "." + k));
}
function expectWellFormed(row, who) {
  expect(Object.keys(row).filter((k) => !KEYS.includes(k)), who + " writes a key outside the table").toEqual([]);
  expect(undefinedAt(row, who), who + " writes undefined").toEqual([]);
}

// The edit, as App's `doSaveEdit` hands it over (no swap, no blocks).
function edit(list, id, draft) {
  return applyEdit({
    list, live: list, id, draft, blocks: [], swap: null, autoOptimizer: true,
    today, nowMins: 12 * 60, phonePrefix: "+34", getUser: () => "t",
  });
}
// The create, likewise.
function create(draft) {
  return buildBooking({ list: [], draft, blocks: [], swap: null, autoOptimizer: true, phonePrefix: "+34", getUser: () => "t" });
}

// ── A booking holding every field ───────────────────────────────────────────
// Each value is its own, not the default an empty row reads as, so a field that
// comes back default after a save was wiped rather than kept. A hand-placed
// pending party (`_manual`, `_locked`: what "Save pending" with tables picked
// by hand writes), so no optimiser pass moves it; `noShow` set on a booking
// that is not cancelled is what a form walk-back from a no-show leaves (ROADMAP).
const RICH_VALUES = {
  id: "rich", name: "Ana Ruiz", phone: "+34 600 111 222", date: D, time: "20:30", scheduledTime: "20:30",
  size: 4, duration: 105, originalDuration: 105, preference: "outdoor", notes: "window seat",
  status: "pending", tables: ["7"], customDur: 105, _manual: true, _locked: true, _conflict: false,
  preferredTables: ["7"], returnOf: "src1",
  history: [{ at: "2026-09-01T10:00:00.000Z", by: "t", action: "created" }],
  noShow: true, deposit: 20, voucherCode: "ABCD2345", recurringId: "rule1", recurringDate: D,
  anonymized: true, guestId: "gana", stayedMin: 80, updatedAt: 1790000000000,
};
const RICH = sanitize(RICH_VALUES, "rich");
// Fields whose stored value the save itself derives, so the fixture cannot hold
// a value of its own in them.
const DERIVED = {
  _conflict: "the save's optimiser pass sets it, and a placed booking holds false",
};

describe("the fixture holds every field", () => {
  it("one value per row, already what a read returns", () => {
    expect(Object.keys(RICH_VALUES).sort()).toEqual([...KEYS].sort());
    expect(RICH).toStrictEqual(RICH_VALUES);
  });
  it("none of them the default an empty row reads as", () => {
    const empty = sanitize({}, "empty");
    const same = KEYS.filter((k) => !(k in DERIVED) && JSON.stringify(RICH[k]) === JSON.stringify(empty[k]));
    expect(same).toEqual([]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe("an edit saved unchanged rewrites nothing but its history", () => {
  // The round trip: what the edit form opens with (`draftFromBooking`), saved
  // as it is. A row whose draft seed is missing or wrong shows up three ways:
  // its field comes back changed, the history line names a change, and undo
  // is armed for a save that changed nothing.
  const plan = edit([RICH], "rich", draftFromBooking(RICH));
  const saved = plan.fin && plan.fin.find((b) => b.id === "rich");

  it("is not refused", () => {
    expect(plan.refusal).toBeUndefined();
    expect(saved).toBeTruthy();
  });
  it("keeps every field, in the table's key order", () => {
    const rest = (b) => Object.fromEntries(Object.entries(b).filter(([k]) => k !== "history"));
    expect(rest(saved)).toStrictEqual(rest(RICH));
    // The stored key order is what `contentKey` compares (write-path.js).
    expect(Object.keys(saved)).toEqual(KEYS);
  });
  it("adds one history entry, saying nothing changed", () => {
    expect(saved.history.slice(0, RICH.history.length)).toStrictEqual(RICH.history);
    expect(saved.history.slice(RICH.history.length).map((h) => h.action)).toEqual(["edited: saved (no field changes)"]);
  });
  it("arms no undo", () => {
    expect(plan.changed).toBe(false);
  });
  it("writes a well-formed row", () => {
    expectWellFormed(saved, "applyEdit");
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// The round trip above holds for a form that OPENS the table's draft, and only
// for that. v18.3.4's /code-review found two that did not: WhatsApp's "open the
// linked booking" and "Apply changes" wrote their edit drafts out by hand on top
// of EMPTY_FORM, so Save, with nothing changed, wiped the booking's deposit and
// voucher. So every place that opens the form on an existing booking — a
// `setEditId` with an id, after an `openForm` — is found here and must open
// `draftFromBooking`, with any requested changes laid on top of it.
const SRC = fileURLToPath(new URL("../src/", import.meta.url));
// Sorted: `readdirSync`'s order is the file system's (CI's ext4 is not alphabetical).
const sourceFiles = (dir) => readdirSync(dir).sort().flatMap((n) => {
  const p = join(dir, n);
  return statSync(p).isDirectory() ? sourceFiles(p) : /\.jsx?$/.test(n) ? [p] : [];
});
const EDIT_OPENERS = sourceFiles(SRC).flatMap((file) => {
  const code = stripComments(readFileSync(file, "utf8")).join("\n");
  if (!code.includes("openForm(")) return [];
  const out = [];
  const re = /setEditId\(([^)]*)\)/g;
  let m;
  while ((m = re.exec(code)) !== null) {
    if (m[1].trim() === "null") continue;
    const at = code.lastIndexOf("openForm(", m.index);
    out.push({ site: relative(SRC, file) + " " + m[1].trim(), opens: at < 0 ? "" : code.slice(at + "openForm(".length, at + 60) });
  }
  return out;
});

describe("every edit form opens the table's draft", () => {
  it("finds the one place that opens one", () => {
    // Counted, so a new door fails here until it is looked at. v18.3.5: it was
    // three; the WhatsApp inbox's two now call `openEdit`.
    expect(EDIT_OPENERS.map((o) => o.site)).toEqual([
      "App.jsx b.id",                        // openEdit
    ]);
  });
  it("it opens draftFromBooking, with a caller's changes on top", () => {
    expect(EDIT_OPENERS.filter((o) => !/^(changes\?)?(Object\.assign\()?draftFromBooking\(/.test(o.opens)).map((o) => o.site + ": " + o.opens)).toEqual([]);
  });
  // v18.3.5: the form's doors are App's. A hook that opened the form itself
  // skipped the capability check and left a pending waitlist entry set.
  it("only App calls openForm", () => {
    const callers = sourceFiles(SRC).filter((file) => /\bopenForm\(/.test(stripComments(readFileSync(file, "utf8")).join("\n"))).map((file) => relative(SRC, file));
    expect(callers).toEqual(["App.jsx"]);
  });
  it("the WhatsApp doors stop when App's door refuses", () => {
    const hook = stripComments(readFileSync(join(SRC, "hooks/useWhatsApp.js"), "utf8")).join("\n");
    expect(hook.match(/if \(!open(New|Edit)\(/g)).toEqual(["if (!openNew(", "if (!openEdit(", "if (!openEdit("]);
    expect(hook.match(/\bopen(New|Edit)\(/g).length).toBe(3);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// What a person can change in the booking form, and what the stored booking must
// then hold: `to` is the draft's new value, `field` the stored key (the draft's
// own by default), `stored` the value written (`to` by default). One entry per
// key the form's draft has, so a new draft key fails the coverage test until it
// is decided. `edit` / `skip` name a save that deliberately does not write it;
// `quiet` a field the edit writes without naming it in history or arming Undo.
const CHANGES = {
  name: { to: "Bea Gil" },
  phone: { to: "+44 7911 123456" },
  date: { to: addDays(D, 1) },
  time: { to: "21:00" },
  size: { to: 4 },
  preference: { to: "indoor" },
  notes: { to: "high chair" },
  status: { to: "pending" },
  customDur: { to: 150 },
  deposit: { to: "35", stored: 35 },
  voucherCode: { to: "wxyz-6789", stored: normalizeCode("wxyz-6789") },
  manualTables: { to: ["5A"], field: "tables" },
  preferredTables: { to: ["6"] },
  returnOf: { to: "src9", edit: "an edit never writes it: Book Again sets it on the booking it creates" },
  guestId: { to: "gbea", quiet: "a join on its own is not undone: its row has `undo: false` and no clause, as before v18.3.4 (the row says what that means)" },
  guestSeed: { to: "seed1", skip: "not a field of this booking: it names the booking picked from the name list, which the same write stamps with the guest id" },
};
// A placed, confirmed booking with nothing set: what each change is made to.
const PLAIN = sanitize({ id: "plain", name: "Ana Ruiz", phone: "+34 600 111 222", date: D, time: "20:00", size: 2, status: "confirmed", tables: ["3"], history: [] }, "plain");
// A new booking's form as `openNew` seeds it, filled in.
const NEW_FORM = () => Object.assign({}, EMPTY_FORM, { name: "Ana Ruiz", phone: "+34 600 111 222", date: D, time: "20:00" });

describe("a field the form edits is written by both saves", () => {
  const draftKeys = Object.keys(draftFromBooking(PLAIN));
  // PLAIN saved with nothing changed: what each change's Undo is measured
  // against. On the optimiser's day every save re-places the booking (3 → 1A
  // here), so measured against PLAIN itself the tables alone would arm one.
  const SAME = edit([PLAIN], "plain", draftFromBooking(PLAIN)).fin;

  it("every key of the form's draft is decided here", () => {
    expect(Object.keys(CHANGES).sort()).toEqual([...draftKeys].sort());
  });
  it("the new-booking form opens with every key the edit form does", () => {
    // `EMPTY_FORM` (constants.js) is written out by hand too: a key it lacks
    // reaches `buildBooking` as undefined.
    expect(draftKeys.filter((k) => !(k in EMPTY_FORM))).toEqual([]);
    const FORM_ONLY = { repeatWeekly: "the new-booking form's switch: it makes a standing rule, and is not a field of the booking" };
    expect(Object.keys(EMPTY_FORM).filter((k) => !draftKeys.includes(k)).sort()).toEqual(Object.keys(FORM_ONLY).sort());
  });

  Object.keys(CHANGES).forEach((key) => {
    const c = CHANGES[key];
    const field = c.field || key;
    const stored = "stored" in c ? c.stored : c.to;

    it(key + " — the edit", () => {
      const plan = edit([PLAIN], "plain", Object.assign(draftFromBooking(PLAIN), { [key]: c.to }));
      expect(plan.refusal).toBeUndefined();
      const saved = plan.fin.find((b) => b.id === "plain");
      expectWellFormed(saved, "applyEdit");
      if (c.skip) return;
      if (c.edit) {
        expect(saved[field]).toStrictEqual(PLAIN[field]);
        return;
      }
      expect(PLAIN[field]).not.toStrictEqual(stored);
      expect(saved[field]).toStrictEqual(stored);
      // And the save says so (v18.3.4's /code-review): the history line names
      // the change, and Undo is armed to put it back. `changed` is the gate, and
      // the snapshot exists only when a field undo compares has moved, so the
      // row needs a `clause` and `undo: true`. Without either, the field is
      // stored, every check above passes, and the edit reads "saved (no field
      // changes)" with no Undo.
      const said = saved.history[saved.history.length - 1].action;
      const undoes = undoSnapshots(SAME, plan.fin).map((b) => b.id);
      if (c.quiet) {
        expect([plan.changed, said, undoes]).toStrictEqual([false, "edited: saved (no field changes)", []]);
        return;
      }
      expect(plan.changed).toBe(true);
      expect(said).not.toBe("edited: saved (no field changes)");
      expect(undoes).toEqual(["plain"]);
    });

    it(key + " — the create", () => {
      const plan = create(Object.assign(NEW_FORM(), { [key]: c.to }));
      expect(plan.refusal).toBeUndefined();
      const made = plan.fin.find((b) => b.id === plan.id);
      expectWellFormed(made, "buildBooking");
      if (c.skip) return;
      expect(made[field]).toStrictEqual(stored);
    });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// The three builders that CREATE a booking write a row's field or leave it to
// the read, and which one is a decision: each list names what that builder
// leaves out and why. A row added to the table and to neither fails here.
const NOT_YET = "a booking is created before anyone could fail to arrive; a read fills false";
const ANON = "only Delete customer anonymises a booking, and it rewrites an existing one; a read fills false";
const STAY = "the save that completes the booking writes how long the party stayed; a read fills 0";
const STAMP = "the write path stamps it on every write (`stampForWrite`, write-path.js), not a builder";
const OMITS = {
  buildBooking: { noShow: NOT_YET, anonymized: ANON, stayedMin: STAY, updatedAt: STAMP },
  walkinBooking: {
    _conflict: "its tables are the ones chosen at the door and no optimiser pass follows its write; a read fills false",
    preferredTables: "the walk-in form has no preferred tables",
    returnOf: "Book Again opens the booking form, not the walk-in's",
    deposit: "the walk-in form takes no deposit",
    voucherCode: "the walk-in form has no voucher field; one is attached later, from the edit form",
    recurringId: "a walk-in is not a standing booking",
    recurringDate: "a walk-in is not a standing booking",
    guestId: "a walk-in has no phone-less identity until somebody joins it from the name list; a read fills null",
    noShow: NOT_YET, anonymized: ANON, stayedMin: STAY, updatedAt: STAMP,
  },
  occurrenceBooking: {
    guestId: "a standing rule carries no guest identity; a read fills null",
    noShow: NOT_YET, anonymized: ANON, stayedMin: STAY, updatedAt: STAMP,
  },
};
const CREATED = {
  buildBooking: () => { const p = create(NEW_FORM()); return p.fin.find((b) => b.id === p.id); },
  walkinBooking: () => walkinBooking({ size: 2, notes: "", tables: ["3"], time: "19:30", customDur: null }, 1, today, "t"),
  occurrenceBooking: () => occurrenceBooking({
    id: "wk", name: "Weekly", phone: "+34 600 000 001", size: 2, weekday: 3, time: "20:00",
    preference: "auto", notes: "", active: true, skipDates: [], createdAt: 1, startDate: today,
  }, D),
};

describe("each new booking writes a row's field or says why not", () => {
  Object.keys(CREATED).forEach((who) => {
    it(who, () => {
      const row = CREATED[who]();
      expectWellFormed(row, who);
      expect(KEYS.filter((k) => !(k in row)).sort()).toEqual(Object.keys(OMITS[who]).sort());
      Object.values(OMITS[who]).forEach((why) => expect(why.length).toBeGreaterThan(10));
    });
  });
  it("the walk-in with a typed length and no time is well-formed too", () => {
    expectWellFormed(walkinBooking({ size: "5", notes: "high chair", tables: ["7"], time: "", customDur: 100 }, 4, today, "t"), "walkinBooking");
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe("the table itself", () => {
  it("names each field once", () => {
    expect(new Set(KEYS).size).toBe(KEYS.length);
  });
  it("gives each history clause and each draft seed a position of its own", () => {
    // The two orders are sorted by these; a tie would leave the order to the
    // sort's stability, which nothing states.
    const clauseAt = BOOKING_FIELDS.filter((r) => r.clause).map((r) => r.clause.at);
    expect(new Set(clauseAt).size).toBe(clauseAt.length);
    const draftAt = BOOKING_FIELDS.flatMap((r) => (r.draft ? [].concat(r.draft).map((d) => d.at) : []));
    expect(new Set(draftAt).size).toBe(draftAt.length);
  });
  it("says for every row how it is read and whether undo compares it", () => {
    BOOKING_FIELDS.forEach((r) => {
      expect(typeof r.read, r.key).toBe("function");
      expect(typeof r.undo, r.key).toBe("boolean");
    });
  });
});
