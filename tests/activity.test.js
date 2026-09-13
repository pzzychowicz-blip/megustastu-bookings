// tests/activity.test.js — v18.0.0 session 8 (item 1)
//
// The activity log's pure core. It is pure precisely so that this file can
// exist: "what does the log say happened" is a decision the restaurant acts on
// — it is the screen somebody opens to find out who cancelled a table — and the
// v17.8.0 rule keeps that kind of decision out of a `useEffect`.
//
// Two of these tests read `database.rules.json`. That is not scope creep: the
// kind list and the prune window are stated in BOTH files and neither can read
// the other, so the only thing standing between them is an assertion.
import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ACTIVITY_KINDS, PRUNE_AFTER_MS, bookingToken, tokenizeNames, renderText,
  bookingWriteEntries, voucherWriteEntries, settingsWriteEntry, changedKeys,
  isPrunable, activityWindow, activityCsv, activityCsvName, clearedEntry,
  retentionMs, retentionLabel, RETENTION_CHOICES, DEFAULT_RETENTION_DAYS,
} from "../src/lib/activity.js";
import {
  setActivitySink, emitActivity, resetActivitySink,
} from "../src/lib/activitySink.js";
// The identity rule `guestKeyOf` delegates to. Imported so the agreement test
// below compares against the REAL function rather than against a restatement of
// it — which is the entire property being tested, and which the first version
// of this file failed to do, by not importing it at all.
import { identityKey } from "../src/lib/customers.js";
// The hook-point sweep below reads JS source, so it strips comments first — and
// this file is a good example of why the rule exists: several of those hooks now
// carry paragraphs explaining which writes are deliberately NOT logged, and a
// raw read would match the explanation instead of the code.
import { stripComments } from "../scripts/strip-comments.mjs";

const RULES = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "..", "database.rules.json"), "utf8"
);

// The `.write` on `/activity/$eid`, as a string. Pulled out rather than grepped
// over the whole file, so an assertion about "no age gate here" cannot be
// satisfied or broken by an unrelated `now - …` somewhere else in the rules.
function activityWriteRule() {
  const parsed = JSON.parse(RULES);
  const w = parsed.rules.activity.$eid[".write"];
  expect(typeof w, "/activity/$eid lost its .write").toBe("string");
  return w;
}

const bk = (o = {}) => Object.assign({
  id: "b1", name: "Pau Estévez", phone: "+34600111222",
  date: "2026-09-01", time: "20:00", scheduledTime: "20:00", size: 4,
  duration: 90, status: "confirmed", tables: ["3"], history: [],
}, o);

const hist = (action) => ({ at: "2026-09-01T19:00:00.000Z", by: "staff@x", action });

// ── The two facts stated in two files ────────────────────────────────────────

describe("the rules and this module agree", () => {
  it("the kind list matches the pattern the rules validate against", () => {
    // The rule is a single regex alternation; pulling it apart is the only way
    // to compare the two, and doing so is what makes adding a kind in one file
    // fail here rather than at runtime against a server that refuses it.
    const m = RULES.match(/\^\(booking\|[a-z|]*\)\$/);
    expect(m, "the kind validate in database.rules.json changed shape").toBeTruthy();
    const inRules = m[0].replace(/^\^\(/, "").replace(/\)\$$/, "").split("|");
    expect(inRules.slice().sort()).toEqual(ACTIVITY_KINDS.slice().sort());
  });

  it("the rules NO LONGER age-gate a delete — the floor is the app's alone", () => {
    // This assertion read `expect(RULES).toContain("now - " + PRUNE_AFTER_MS)`
    // until v18.0.0 session 11, and inverting it deliberately is the point.
    //
    // The rule used to refuse a delete of anything under a year old, which made
    // the log tamper-EVIDENT by construction. "Remove by date or a range of
    // dates" cannot coexist with that: the rule cannot tell a retention prune
    // from a deliberate clear, because they are the same operation on the same
    // node. So the floor moved into the client and `clearedEntry` took its
    // place — a clear now writes a line saying it happened.
    //
    // Asserting the ABSENCE is what keeps that a decision rather than a drift:
    // if somebody restores the age gate, the prune still works and the CLEAR
    // silently stops working for recent entries, which is a bug with no visible
    // symptom beyond "nothing happened".
    const write = activityWriteRule();
    expect(write).not.toMatch(/now - \d+/);
  });

  it("a delete is still gated on the settingsAdmin capability", () => {
    // What the relaxation must NOT have cost. The emulator suite proves the
    // behaviour against a real server; this proves the rule still mentions the
    // gate at all, which is the half that would go missing in a careless edit.
    const write = activityWriteRule();
    expect(write).toContain("!newData.exists()");
    expect(write).toContain("settingsAdmin");
  });

  it("is 365 days, stated as arithmetic so the number can be checked by eye", () => {
    expect(PRUNE_AFTER_MS).toBe(365 * 24 * 60 * 60 * 1000);
  });
});

// ── Tokens ───────────────────────────────────────────────────────────────────

describe("names never reach an entry", () => {
  it("replaces a name with its token", () => {
    expect(tokenizeNames("seated Pau Estévez", [bk()])).toBe("seated " + bookingToken("b1"));
  });

  it("survives a name full of regex metacharacters", () => {
    // A guest name is free text. Building a RegExp out of one is how a log
    // entry throws while recording a booking that saved perfectly well.
    const b = bk({ id: "b9", name: "A(x)+.*" });
    expect(tokenizeNames("cancelled A(x)+.*", [b])).toBe("cancelled " + bookingToken("b9"));
  });

  it("tokenises the LONGER name first when one is a prefix of another", () => {
    const a = bk({ id: "b1", name: "Ana" });
    const c = bk({ id: "b2", name: "Ana María" });
    const out = tokenizeNames("moved Ana María", [a, c]);
    expect(out).toBe("moved " + bookingToken("b2"));
    // The failure this guards: shortest-first leaves " María" beside a token.
    expect(out).not.toContain("María");
  });

  it("ignores a booking with no name rather than replacing every empty string", () => {
    expect(tokenizeNames("created", [bk({ name: "" })])).toBe("created");
  });

  it("resolves a token against the live list, and falls back when it is gone", () => {
    expect(renderText("seated {b:b1}", { b1: bk() })).toBe("seated Pau Estévez");
    expect(renderText("seated {b:b1}", {})).toBe("seated a deleted booking");
    expect(renderText("seated {b:b1}", {}, "Pau Estévez")).toBe("seated Pau Estévez");
  });

  it("renders an anonymised booking as the app already names it", () => {
    // The property the whole token design is for: no pass over the log.
    const anon = bk({ name: "Data removed", anonymized: true });
    expect(renderText("seated {b:b1}", { b1: anon })).toBe("seated Data removed");
  });
});

// ── Bookings ─────────────────────────────────────────────────────────────────

describe("bookingWriteEntries", () => {
  it("emits one entry per history entry the write appended", () => {
    const prev = [bk({ history: [hist("created")] })];
    const next = [bk({ history: [hist("created"), hist("status → seated")] })];
    const out = bookingWriteEntries(prev, next);
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe("booking");
    expect(out[0].text).toBe("status → seated");
    expect(out[0].bookings).toEqual({ b1: true });
  });

  it("emits nothing at all when nothing it watches changed", () => {
    const prev = [bk({ history: [hist("created")] })];
    expect(bookingWriteEntries(prev, [bk({ history: [hist("created")] })])).toEqual([]);
  });

  it("SKIPS a duration-only change — the per-minute overstay extension", () => {
    // Not a special case: a duration change touches neither history nor tables,
    // so it is skipped by construction. Pinned because the alternative floods
    // the log with one row per tick per seated booking.
    const prev = [bk({ status: "seated", duration: 90, history: [hist("created")] })];
    const next = [bk({ status: "seated", duration: 105, history: [hist("created")] })];
    expect(bookingWriteEntries(prev, next)).toEqual([]);
  });

  it("summarises optimiser table moves as ONE Automatic entry", () => {
    const prev = [
      bk({ id: "b1", tables: ["3"], history: [hist("created")] }),
      bk({ id: "b2", tables: ["4"], history: [hist("created")] }),
    ];
    const next = [
      bk({ id: "b1", tables: ["1A"], history: [hist("created")] }),
      bk({ id: "b2", tables: ["1B"], history: [hist("created")] }),
    ];
    const out = bookingWriteEntries(prev, next);
    expect(out).toHaveLength(1);
    expect(out[0].auto).toBe(true);
    expect(out[0].text).toBe("2 bookings re-placed");
  });

  it("says one booking in the singular", () => {
    const prev = [bk({ tables: ["3"], history: [hist("created")] })];
    const next = [bk({ tables: ["1A"], history: [hist("created")] })];
    expect(bookingWriteEntries(prev, next)[0].text).toBe("1 booking re-placed");
  });

  it("does not summarise a move that ALREADY has a history entry", () => {
    // A person dragging a booking writes history; counting it again would
    // report the same move twice, once named and once anonymously.
    const prev = [bk({ tables: ["3"], history: [hist("created")] })];
    const next = [bk({ tables: ["1A"], history: [hist("created"), hist("moved to 1A")] })];
    const out = bookingWriteEntries(prev, next);
    expect(out).toHaveLength(1);
    expect(out[0].text).toBe("moved to 1A");
  });

  it("records a deletion with the subject and guest key erasure needs", () => {
    const out = bookingWriteEntries([bk()], []);
    expect(out).toHaveLength(1);
    expect(out[0].text).toContain("deleted " + bookingToken("b1"));
    expect(out[0].subject).toEqual({
      name: "Pau Estévez", date: "2026-09-01", time: "20:00", size: 4,
    });
    expect(out[0].guestKey).toBe("+34600111222");
  });

  it("files guestKey under the NORMALISED phone, not the typed one", () => {
    // The key erasure searches by is `normalizePhone(...)`. Storing the typed
    // string means a punctuated number never matches, and a missed erasure is
    // indistinguishable from a successful one.
    const out = bookingWriteEntries([bk({ phone: "+34 600 111 222" })], []);
    expect(out[0].guestKey).toBe("+34600111222");
  });

  it("agrees with identityKey for every shape, because it IS identityKey", () => {
    // Pinned as an AGREEMENT rather than as a value: the two must not be able
    // to drift, and the first version of guestKeyOf drifted on two axes at once
    // (normalisation, and a six-digit floor against hasRealPhone's three).
    [
      bk({ phone: "+34600111222" }),
      bk({ phone: "(+34) 600 123 456" }),
      bk({ phone: "12345", guestId: "gb1" }),
      bk({ phone: "", guestId: "gb2" }),
      bk({ phone: "+34", guestId: "gb3" }),
    ].forEach(function (b) {
      const got = bookingWriteEntries([b], [])[0].guestKey;
      expect(got === undefined ? "" : got).toBe(identityKey(b) || "");
    });
  });

  it("falls back to guestId when a deleted booking had no real phone", () => {
    // `hasRealPhone`'s problem one module over: the form seeds the field with
    // the dial prefix, so "+34" is not a number anybody can be found by.
    const out = bookingWriteEntries([bk({ phone: "+34", guestId: "gb7" })], []);
    expect(out[0].guestKey).toBe("gb7");
  });

  it("OMITS guestKey for a booking nobody can ask to have erased", () => {
    // Absent rather than "", and the reason is the index: `guestKey` is an
    // `.indexOn` field, so an empty string would file every identity-less entry
    // under one key and a query for "" would sweep them up together. An entry
    // with no identity should not be IN the index at all.
    const e = bookingWriteEntries([bk({ phone: "", guestId: null })], [])[0];
    expect(Object.prototype.hasOwnProperty.call(e, "guestKey")).toBe(false);
  });

  it("treats a SHORTER history as no append rather than replaying the list", () => {
    // An undo, an anonymisation, or a booking arriving from another device with
    // less history. Slicing from the old length would emit every entry.
    const prev = [bk({ history: [hist("created"), hist("status → seated")] })];
    const next = [bk({ history: [hist("created")] })];
    expect(bookingWriteEntries(prev, next)).toEqual([]);
  });

  it("marks every entry Automatic when the write itself was", () => {
    const prev = [bk({ history: [hist("created")] })];
    const next = [bk({ history: [hist("created"), hist("auto-completed")] })];
    expect(bookingWriteEntries(prev, next, { auto: true })[0].auto).toBe(true);
  });

  it("OMITS `auto` on a human write rather than carrying it as undefined", () => {
    // Not cosmetic. Firebase's set/push THROWS on a property holding
    // `undefined`, so an entry built with `auto: undefined` would throw inside
    // the writer, be swallowed by emitActivity's try/catch exactly as that
    // catch is designed to, and vanish — every human entry, silently, with the
    // safety net hiding the bug rather than surfacing it. The key must be
    // genuinely absent, which is also what the rule's `auto === true` wants.
    const prev = [bk({ history: [hist("created")] })];
    const next = [bk({ history: [hist("created"), hist("edited")] })];
    const e = bookingWriteEntries(prev, next)[0];
    expect(Object.prototype.hasOwnProperty.call(e, "auto")).toBe(false);
    expect(Object.values(e).every(function (v) { return v !== undefined; })).toBe(true);
  });

  it("no entry it can produce carries an undefined value anywhere", () => {
    // The general form of the rule above, swept over every branch: deletion
    // (which has the most optional keys), append, and the Automatic summary.
    const prev = [bk({ id: "b1", tables: ["3"], history: [hist("created")] }), bk({ id: "b2" })];
    const next = [bk({ id: "b1", tables: ["1A"], history: [hist("created")] })];
    const all = bookingWriteEntries(prev, next)
      .concat(voucherWriteEntries([], [vc()]))
      .concat([settingsWriteEntry("settings/general", { a: 1 }, { a: 2 })]);
    all.forEach(function (e) {
      expect(Object.values(e).every(function (v) { return v !== undefined; })).toBe(true);
    });
  });

  it("tokenises the name inside an appended history entry", () => {
    const prev = [bk({ history: [] })];
    const next = [bk({ history: [hist("renamed Pau Estévez")] })];
    expect(bookingWriteEntries(prev, next)[0].text)
      .toBe("renamed " + bookingToken("b1"));
  });
});

// ── Vouchers ─────────────────────────────────────────────────────────────────

const vc = (o = {}) => Object.assign({
  code: "ABCD2345", value: 50, remaining: 50, status: "open",
}, o);

describe("voucherWriteEntries", () => {
  it("names an issue", () => {
    const out = voucherWriteEntries([], [vc()]);
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe("voucher");
    expect(out[0].text).toBe("issued voucher ABCD2345");
  });

  it("names a void and a reinstatement", () => {
    expect(voucherWriteEntries([vc()], [vc({ status: "void" })])[0].text)
      .toBe("voided voucher ABCD2345");
    expect(voucherWriteEntries([vc({ status: "void" })], [vc({ status: "open" })])[0].text)
      .toBe("reinstated voucher ABCD2345");
  });

  it("names a redemption and links the booking it was spent on", () => {
    const next = vc({ remaining: 30, redemptions: { b1: { amount: 20, at: 1, by: "x" } } });
    const out = voucherWriteEntries([vc()], [next]);
    expect(out).toHaveLength(1);
    expect(out[0].text).toBe("redeemed 20 of voucher ABCD2345 against " + bookingToken("b1"));
    expect(out[0].bookings).toEqual({ b1: true });
  });

  it("names a reversal", () => {
    const was = vc({ redemptions: { b1: { amount: 20 } } });
    const next = vc({ reversals: { b1_2000: { bookingId: "b1", amount: 20 } } });
    const out = voucherWriteEntries([was], [next]);
    expect(out.some(function (e) {
      return e.text === "restored 20 to voucher ABCD2345 from " + bookingToken("b1");
    })).toBe(true);
  });

  it("does NOT log `remaining` moving on its own", () => {
    // It is recomputed from the ledger rather than decremented, so logging it
    // would record an arithmetic consequence as though it were an action.
    expect(voucherWriteEntries([vc({ remaining: 50 })], [vc({ remaining: 30 })])).toEqual([]);
  });

  it("emits nothing for an untouched voucher", () => {
    expect(voucherWriteEntries([vc()], [vc()])).toEqual([]);
  });
});

// ── Settings ─────────────────────────────────────────────────────────────────

describe("settingsWriteEntry", () => {
  it("names the node in words and lists the keys that changed", () => {
    const e = settingsWriteEntry("settings/general",
      { v: 1, restaurantName: "A", currency: "€" },
      { v: 1, restaurantName: "B", currency: "€" });
    expect(e.kind).toBe("settings");
    expect(e.text).toBe("changed the general settings · restaurantName");
  });

  it("returns NULL when nothing differs — a save is not a change", () => {
    // writeWithRev is called on every save whether or not anything moved, so an
    // unconditional entry logs a row every time somebody opens a tab.
    expect(settingsWriteEntry("settings/general", { v: 1, a: 1 }, { v: 1, a: 1 })).toBeNull();
  });

  it("ignores the schema version", () => {
    expect(settingsWriteEntry("settings/general", { v: 1, a: 1 }, { v: 2, a: 1 })).toBeNull();
  });

  it("gives the non-settings collections their own kind", () => {
    expect(settingsWriteEntry("tableBlocks", [], [{ id: "k1" }]).kind).toBe("table");
    expect(settingsWriteEntry("waitlist", [], [{ id: "w1" }]).kind).toBe("waitlist");
    expect(settingsWriteEntry("reminders", [], [{ id: "r1" }]).kind).toBe("reminder");
    expect(settingsWriteEntry("recurring", { a: 1 }, { a: 2 }).kind).toBe("standing");
    expect(settingsWriteEntry("roles", { a: 1 }, { a: 2 }).kind).toBe("people");
  });

  it("every kind it can produce is one the rules accept", () => {
    ["settings/general", "tableBlocks", "waitlist", "reminders", "recurring", "roles", "invites"]
      .forEach(function (p) {
        const e = settingsWriteEntry(p, { a: 1 }, { a: 2 });
        expect(ACTIVITY_KINDS).toContain(e.kind);
      });
  });

  it("reports a LIST node by its size, never by array indices", () => {
    // waitlist / reminders / roles / invites / the standing rules are arrays. A
    // key diff over one compares INDICES — "changed the waitlist · 0, 2" names
    // positions nobody can see — and inserting an entry at the FRONT renumbers
    // everything after it and reports the whole list as changed.
    const grew = settingsWriteEntry("waitlist", [{ id: "w1" }], [{ id: "w1" }, { id: "w2" }]);
    expect(grew.text).toBe("added to the waitlist · 1 → 2");
    const shrank = settingsWriteEntry("reminders", [{ id: "r1" }, { id: "r2" }], [{ id: "r2" }]);
    expect(shrank.text).toBe("removed from the reminders · 2 → 1");
  });

  it("does not report an index storm when one entry is inserted at the front", () => {
    // The measured failure of the key-diff version: every index from 0 onward
    // holds a different object, so all of them read as changed.
    const e = settingsWriteEntry("roles", [{ uid: "b" }], [{ uid: "a" }, { uid: "b" }]);
    expect(e.text).toBe("added to people and roles · 1 → 2");
    expect(e.text).not.toMatch(/\b0\b\s*,/);
  });

  it("says a same-length list changed without pretending to know which entry", () => {
    const e = settingsWriteEntry("waitlist", [{ id: "w1", size: 2 }], [{ id: "w1", size: 4 }]);
    expect(e.text).toBe("changed the waitlist");
  });

  it("returns NULL for an untouched list, exactly as for an untouched object", () => {
    expect(settingsWriteEntry("waitlist", [{ id: "w1" }], [{ id: "w1" }])).toBeNull();
    expect(settingsWriteEntry("reminders", [], [])).toBeNull();
  });

  it("falls back to the raw path rather than inventing a label", () => {
    expect(settingsWriteEntry("settings/somethingNew", { a: 1 }, { a: 2 }).text)
      .toBe("changed settings/somethingNew · a");
  });

  it("compares objects and arrays by content, and counts a reorder", () => {
    expect(changedKeys({ t: [1, 2] }, { t: [1, 2] })).toEqual([]);
    expect(changedKeys({ t: [1, 2] }, { t: [2, 1] })).toEqual(["t"]);
  });

  it("notices a key that was added or removed, not only one that moved", () => {
    expect(changedKeys({ a: 1 }, { a: 1, b: 2 })).toEqual(["b"]);
    expect(changedKeys({ a: 1, b: 2 }, { a: 1 })).toEqual(["b"]);
  });
});

// ── The prune ────────────────────────────────────────────────────────────────

describe("isPrunable", () => {
  const NOW = 1_800_000_000_000;

  it("is true a day past the year and false a day inside it", () => {
    expect(isPrunable({ at: NOW - PRUNE_AFTER_MS - 86400000 }, NOW)).toBe(true);
    expect(isPrunable({ at: NOW - PRUNE_AFTER_MS + 86400000 }, NOW)).toBe(false);
  });

  it("is false exactly ON the boundary — the rule is a strict <", () => {
    expect(isPrunable({ at: NOW - PRUNE_AFTER_MS }, NOW)).toBe(false);
  });

  it("refuses an entry with no usable timestamp rather than deleting it", () => {
    // The safe direction: an unreadable `at` means we do not know how old it
    // is, and the server would refuse the delete anyway.
    //
    // `null` is the one that MATTERED and it failed on the first run: the
    // original guard was `entry && Number(entry.at)`, which short-circuits to
    // `null` — and `Number(null)` is 0, so `isFinite` says yes and
    // `null < now - a year` coerces to `0 < …` and votes to DELETE. The
    // `lib/clamp.js` trap, in a function whose whole job is deciding what to
    // erase. Keep all four cases.
    expect(isPrunable({ at: "ages ago" }, NOW)).toBe(false);
    expect(isPrunable({}, NOW)).toBe(false);
    expect(isPrunable(null, NOW)).toBe(false);
    expect(isPrunable(undefined, NOW)).toBe(false);
    expect(isPrunable({ at: 0 }, NOW)).toBe(false);
  });
});

// ── The writer hook points ───────────────────────────────────────────────────
//
// Two things a reader cannot tell apart by looking: a write nobody got round to
// logging, and a write somebody decided not to log. The second is a decision and
// it is pinned here, the way `tests/a11y.test.js` pins the sixty List-card
// buttons nobody renamed ON PURPOSE.

describe("the writer hook points", () => {
  const HOOKS = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "hooks");
  const read = (f) => stripComments(readFileSync(join(HOOKS, f), "utf8")).join("\n");

  // The body of one function, so an assertion about it cannot be satisfied by a
  // neighbouring one in the same file.
  function bodyOf(src, decl) {
    const at = src.indexOf(decl);
    expect(at, decl + " was renamed or removed").toBeGreaterThan(-1);
    const rest = src.slice(at + decl.length);
    const next = rest.search(/\n {2}(?:const|function) /);
    return next < 0 ? rest : rest.slice(0, next);
  }

  it("reminderFires is NOT logged — the app is not a person", () => {
    // `saveReminderFires` records that the app showed a reminder, on a timer.
    // Logging it would fill the activity log with the app talking to itself,
    // and it would do so while nobody was using the restaurant.
    const src = read("useReminders.jsx");
    expect(bodyOf(src, "function saveReminderFires")).not.toContain("emitActivity");
    // …while its sibling in the same file IS logged, so this is a choice about
    // reminderFires and not a hook that was simply missed.
    expect(bodyOf(src, "function saveReminders")).toContain("emitActivity");
  });

  it("a user's own preferences are NOT logged — one person's theme is not a record", () => {
    // settings/users/$uid/prefs is the one settings node that is per-USER
    // rather than restaurant-wide. Theme, reduce-motion and nav-lock are
    // nobody else's business, and an activity log that reported them would be
    // a log of what each member of staff finds comfortable.
    expect(read("useUserPrefs.js")).not.toContain("activitySink");
  });

  it("the seeding write that turns WhatsApp on is NOT logged", () => {
    // useWhatsApp seeds DEFAULT_TEMPLATES when the module is switched on. That
    // is the app populating a node, not a person editing templates, and it
    // would log on first load of a freshly enabled module.
    expect(read("useWhatsApp.js")).not.toContain("activitySink");
  });

  it("every hook that imports emitActivity actually calls it", () => {
    // The half-wired shape, which is what `useWaitlist` briefly was: a captured
    // `prev`, an import, and no emit — an unused variable and a silent gap in
    // the log.
    //
    // **This asks about `emitActivity`, not about the sink module**, and the
    // narrowing is a correction rather than a retreat. The first version keyed
    // on "mentions lib/activitySink", which was the same question only while
    // every consumer was an EMITTER. `useActivityLog` is the second kind —
    // it imports `setActivitySink` to INSTALL the writer and correctly never
    // emits — so the broad form failed the one file whose job is the other half
    // of this module. The teeth are unchanged: the defect it catches is an
    // `emitActivity` import with no call, which is exactly what is tested here.
    const offenders = readdirSync(HOOKS)
      .filter((f) => /\.jsx?$/.test(f))
      .map((f) => [f, read(f)])
      .filter(([, src]) => /\bemitActivity\b/.test(src))
      .filter(([, src]) => !/emitActivity\s*\(/.test(src))
      .map(([f]) => f);
    expect(offenders).toEqual([]);
  });

  it("deleting a customer still erases the log's copy of their name", () => {
    // Erasure is the one thing here that leaves NO trace when it stops
    // happening: the booking anonymisation is visible on screen, and a log
    // entry nobody redacted looks exactly like one that was never there. So the
    // call is pinned rather than trusted to survive a later refactor.
    const app = stripComments(
      readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8")
    ).join("\n");
    const at = app.indexOf("function deleteCustomer");
    expect(at, "deleteCustomer was renamed or removed").toBeGreaterThan(-1);
    const end = app.indexOf("\n  function ", at + 1);
    const body = end < 0 ? app.slice(at) : app.slice(at, end);
    expect(body).toMatch(/redactGuest\s*\(/);
    // …and with the PLURAL guest ids, not just the phone: matchesIdentity spans
    // every absorbed guest group, so a single-key erasure leaves some behind.
    expect(body).toMatch(/guestIds/);
  });

  it("the writer hook installs the sink, and is the only thing that does", () => {
    // The companion to the narrowing above, so that excluding `useActivityLog`
    // from the emitter sweep does not quietly exclude it from coverage
    // altogether. Exactly one installer: two would race, and the last one
    // mounted would silently win.
    const installers = readdirSync(HOOKS)
      .filter((f) => /\.jsx?$/.test(f))
      .map((f) => [f, read(f)])
      .filter(([, src]) => /setActivitySink\s*\(/.test(src))
      .map(([f]) => f);
    expect(installers).toEqual(["useActivityLog.js"]);
  });

  // ── Entries that are EVENTS, not diffs ────────────────────────────────────
  //
  // The sweep below assumes an emit in a hook reports a CHANGE, so it must have
  // captured the before-state. That held for every hook in the app — measured,
  // all fifteen were exactly 1:1 — until v18.0.0 session 11 added one entry
  // that is not a diff of anything: clearing a range of the log is an event,
  // and there is no prior version of a deletion to compare against.
  //
  // A BUDGET and not a blanket exemption, deliberately. `useActivityLog.js` is
  // the file that owns the sink, so excusing it wholesale would retire the
  // guard exactly where an unnoticed emit is most likely; excusing ONE emit
  // means a second one has to come back here and say what it is.
  const EVENT_EMITS = { "useActivityLog.js": 1 };   // clearActivityAndLog

  it("no hook emits without having captured a prev to diff against", () => {
    // `prev` read one line late is the same object as `next`, so the diff says
    // nothing changed and the entry is silently empty rather than visibly
    // wrong. Counts, not ordering — ordering is not decidable by regex — but a
    // site that forgot `prev` entirely cannot hide from this.
    readdirSync(HOOKS)
      .filter((f) => /\.jsx?$/.test(f))
      .map((f) => [f, read(f)])
      .filter(([, src]) => /emitActivity\s*\(/.test(src))
      .forEach(([f, src]) => {
        const emits = (src.match(/emitActivity\s*\(/g) || []).length;
        const prevs = (src.match(/const prev\s*=/g) || []).length;
        const allowed = EVENT_EMITS[f] || 0;
        expect(prevs, f + " emits " + emits + " entries (" + allowed
          + " allowed as events) with " + prevs + " prev captures")
          .toBeGreaterThanOrEqual(emits - allowed);
      });
  });

  it("the event-emit budget is SPENT — an unused allowance is a stale excuse", () => {
    // Without this, deleting `clearActivityAndLog` would leave a standing
    // permission for one unexplained emit in the file that owns the sink, and
    // nothing would ever say so. The same reason v17.16.10 deleted a ROADMAP
    // pointer to work that had already shipped: the half nobody looks at is the
    // half that goes stale.
    Object.keys(EVENT_EMITS).forEach((f) => {
      const src = read(f);
      const emits = (src.match(/emitActivity\s*\(/g) || []).length;
      const prevs = (src.match(/const prev\s*=/g) || []).length;
      expect(emits - prevs, f + " no longer needs its event-emit allowance")
        .toBe(EVENT_EMITS[f]);
    });
  });
});

// ── The sink ─────────────────────────────────────────────────────────────────

describe("the activity sink", () => {
  afterEach(function () { resetActivitySink(); vi.restoreAllMocks(); });

  it("hands entries to the installed writer", () => {
    const seen = [];
    setActivitySink(function (e) { seen.push(e); });
    emitActivity([{ kind: "booking", text: "x" }]);
    expect(seen).toHaveLength(1);
    expect(seen[0][0].text).toBe("x");
  });

  it("is silent with no sink, which is the normal state for most of a session", () => {
    expect(function () { emitActivity([{ kind: "booking", text: "x" }]); }).not.toThrow();
  });

  it("ignores an empty or malformed list", () => {
    const sink = vi.fn();
    setActivitySink(sink);
    emitActivity([]);
    emitActivity(null);
    emitActivity("nope");
    expect(sink).not.toHaveBeenCalled();
  });

  it("SWALLOWS a throwing sink — a log entry is worth less than the write", () => {
    // The property the whole module exists for: these callers are inside the
    // booking write path.
    vi.spyOn(console, "warn").mockImplementation(function () {});
    setActivitySink(function () { throw new Error("boom"); });
    expect(function () { emitActivity([{ kind: "booking", text: "x" }]); }).not.toThrow();
    expect(console.warn).toHaveBeenCalled();
  });

  it("lets the writer be uninstalled, so a stale closure cannot outlive its tree", () => {
    const sink = vi.fn();
    setActivitySink(sink);
    setActivitySink(null);
    emitActivity([{ kind: "booking", text: "x" }]);
    expect(sink).not.toHaveBeenCalled();
  });
});


// ── The feed's window (v18.0.0 session 11) ──────────────────────────────────
//
// `activityWindow` decides what the app ASKS the one Firebase query in the
// codebase, and the failure it guards is not a wrong list — it is
// `startAt(NaN)` throwing inside an effect, which the error boundary answers by
// unmounting the whole app. That is why it is a pure function in lib/ rather
// than four lines in App.
describe("activityWindow", () => {
  const DAY = 86400000;

  it("is UNBOUNDED when both fields are empty, and that is not an error", () => {
    // The most important case in this block. Empty is the resting state of both
    // date fields, so this is what the log shows every time it opens — and the
    // obvious implementation, a `Number.isFinite` check on both bounds, calls
    // it invalid and withholds the default view. null and NaN are different
    // answers and everything downstream has to keep them apart.
    expect(activityWindow("", "")).toEqual({
      from: null, to: null, badDay: false, backwards: false, ok: true,
    });
  });

  it("bounds only the side that was filled in", () => {
    const onlyFrom = activityWindow("2026-09-13", "");
    expect(onlyFrom.from).toBe(new Date("2026-09-13T00:00:00").getTime());
    expect(onlyFrom.to).toBe(null);
    expect(onlyFrom.ok).toBe(true);

    const onlyTo = activityWindow("", "2026-09-13");
    expect(onlyTo.from).toBe(null);
    expect(onlyTo.to).toBe(new Date("2026-09-13T00:00:00").getTime() + DAY - 1);
    expect(onlyTo.ok).toBe(true);
  });

  it("makes ONE DAY the two fields holding the same date", () => {
    // Not a mode of its own — which is the property that lets the delete act on
    // exactly the window you are reading, whatever shape it has.
    const w = activityWindow("2026-09-13", "2026-09-13");
    const midnight = new Date("2026-09-13T00:00:00").getTime();
    expect(w.from).toBe(midnight);
    expect(w.to).toBe(midnight + DAY - 1);
    expect(w.to - w.from).toBe(DAY - 1);
    expect(w.ok).toBe(true);
  });

  it("refuses the shapes isReadableDate lets through", () => {
    // These all pass `isReadableDate` and are all NaN once "T00:00:00" is
    // appended, which is the entire reason `dayRangeMs` exists. A window that
    // merely trusted the readability predicate would hand NaN to `startAt`.
    for (const bad of ["2026-8-3", "2026/09/13", "Sep 13 2026", "nonsense"]) {
      const w = activityWindow(bad, "");
      expect(w.badDay).toBe(true);
      expect(w.ok).toBe(false);
      expect(Number.isNaN(w.from)).toBe(false);   // null, never NaN
    }
  });

  it("never returns NaN on either bound, whatever it is given", () => {
    // The property that actually protects the app, stated directly rather than
    // inferred from the cases above: `ok` decides whether to ask, but a NaN
    // leaking through would throw even from a caller that ignored `ok`.
    for (const a of ["", "2026-09-13", "2026-8-3", "x"]) {
      for (const b of ["", "2026-09-14", "nope"]) {
        const w = activityWindow(a, b);
        expect(w.from === null || Number.isFinite(w.from)).toBe(true);
        expect(w.to === null || Number.isFinite(w.to)).toBe(true);
      }
    }
  });

  it("reports a backwards range rather than quietly asking for nothing", () => {
    const w = activityWindow("2026-09-20", "2026-09-13");
    expect(w.backwards).toBe(true);
    expect(w.badDay).toBe(false);
    expect(w.ok).toBe(false);
  });

  it("does NOT call one day backwards", () => {
    // `from` is that day's first ms and `to` its last, so from < to. Had the
    // comparison been written on the date STRINGS it would be `>=` on equal
    // values and every single-day window would report itself backwards.
    expect(activityWindow("2026-09-13", "2026-09-13").backwards).toBe(false);
  });
});


// ── The CSV export (v18.0.0 session 11) ─────────────────────────────────────
//
// The export half of "remove the data" — on the free plan there are no backups,
// so a clear without a copy first is a one-way door. Every field can hold a
// GUEST'S NAME, and names contain commas, quotes and accents as a matter of
// course, so the escaping is the part worth testing rather than the columns.
describe("activityCsv", () => {
  const row = (o) => Object.assign({
    at: new Date("2026-09-13T20:05:00").getTime(),
    email: "pau@app.com", kind: "booking", text: "status → seated",
  }, o);

  it("quotes every field and doubles internal quotes", () => {
    // A name holding a comma splits into two columns otherwise — silently, and
    // only on the rows that have one, which is the worst way for it to happen.
    const out = activityCsv([row({ text: 'cancelled O"Brien, party of 4' })], {});
    expect(out).toContain('"cancelled O""Brien, party of 4"');
  });

  it("starts with a BOM, or Excel mangles every accented name", () => {
    // "Estévez" arrives as "EstÃ©vez" without it, on the machines this
    // restaurant actually uses.
    expect(activityCsv([], {})[0]).toBe("\ufeff");
  });

  it("defuses a cell Excel would run as a FORMULA", () => {
    // =, +, - and @ all start a formula. The text is partly guest-controlled
    // through resolved names, so the leading apostrophe is cheap insurance on
    // a file somebody will open in a spreadsheet.
    for (const bad of ["=1+1", "+x", "-x", "@x"]) {
      expect(activityCsv([row({ text: bad })], {})).toContain('"\'' + bad + '"');
    }
  });

  it("RESOLVES tokens, so the file inherits the erasure property", () => {
    // A raw dump of the node would quietly undo "Delete customer & all data":
    // entries hold `{b:<id>}` tokens, and an anonymised booking must read
    // "Data removed" in the export exactly as it does on screen.
    const byId = { b1: { id: "b1", name: "Data removed", anonymized: true } };
    const out = activityCsv([row({ text: "cancelled " + bookingToken("b1") })], byId);
    expect(out).toContain("Data removed");
    expect(out).not.toContain("{b:b1}");
  });

  it("writes a header and one line per row, CRLF", () => {
    const out = activityCsv([row(), row()], {});
    const lines = out.split("\r\n").filter(Boolean);
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain("What happened");
  });

  it("survives a null row and a missing at", () => {
    const out = activityCsv([null, row({ at: undefined })], {});
    expect(out.split("\r\n").filter(Boolean)).toHaveLength(2);
  });

  it("names the file after the window it exported", () => {
    expect(activityCsvName("2026-09-13", "2026-09-13")).toBe("mgt-activity-2026-09-13.csv");
    expect(activityCsvName("2026-09-01", "2026-09-13")).toBe("mgt-activity-2026-09-01_2026-09-13.csv");
    expect(activityCsvName("", "")).toBe("mgt-activity-all.csv");
  });
});

// ── clearedEntry (v18.0.0 session 11) ───────────────────────────────────────

describe("clearedEntry", () => {
  it("returns null for a count of zero, so a REFUSED clear leaves no line", () => {
    // The property that stopped the app lying on DEV, where the clear came back
    // PERMISSION_DENIED: the count is a count of DELETES, and a line saying
    // "cleared 27 entries" over a log that still holds 27 would be worse than
    // no line at all.
    expect(clearedEntry("2026-09-12", "2026-09-12", 0)).toBe(null);
    expect(clearedEntry("2026-09-12", "2026-09-12", undefined)).toBe(null);
  });

  it("names the range and the count", () => {
    expect(clearedEntry("2026-09-12", "2026-09-12", 27).text)
      .toBe("cleared the activity log · 2026-09-12 · 27 entries");
    expect(clearedEntry("2026-09-01", "2026-09-12", 1).text)
      .toBe("cleared the activity log · 2026-09-01 to 2026-09-12 · 1 entry");
  });

  it("is kind `data` — an action on the RECORD, not on the restaurant", () => {
    expect(clearedEntry("2026-09-12", "2026-09-12", 3).kind).toBe("data");
    // And that kind must be one the rules accept, or the line the clear depends
    // on for its honesty is itself refused.
    expect(ACTIVITY_KINDS).toContain("data");
  });
});


// ── Retention as a setting (v18.0.0 session 11) ─────────────────────────────
//
// It could only BECOME a setting because session 11 took the year out of the
// rules — until then the window was stated in two languages that cannot read
// each other, and a configurable one would have meant the app asking for
// deletes the server refuses. These tests guard the direction of every fallback,
// because this number drives a DELETE and the unsafe direction is silent.
describe("retention", () => {
  const YEAR = 365 * 86400000;

  it("falls back to the shipped year for anything unusable", () => {
    // The important direction. A node that came back holding 0, "", null or
    // nonsense must widen to a year, never narrow to zero — "prune everything
    // older than 0ms" is the whole log, deleted by whoever next opened it.
    for (const bad of [0, -5, null, undefined, "", "soon", NaN, {}]) {
      expect(retentionMs(bad)).toBe(YEAR);
    }
  });

  it("converts days to ms for real values", () => {
    expect(retentionMs(90)).toBe(90 * 86400000);
    expect(retentionMs(DEFAULT_RETENTION_DAYS)).toBe(YEAR);
  });

  it("isPrunable defaults the same way, not to zero", () => {
    // Same guard one layer down, and it has to agree: `pruneActivity` asks the
    // server for a window and then re-checks each row with this. Two fallbacks
    // that disagreed would mean asking for rows it then declines to delete —
    // or, the wrong way round, deleting rows it never asked for.
    const now = Date.now();
    const yesterday = { at: now - 86400000 };
    expect(isPrunable(yesterday, now, 0)).toBe(false);
    expect(isPrunable(yesterday, now, null)).toBe(false);
    expect(isPrunable(yesterday, now)).toBe(false);
    // …and honours a window that really is shorter than the entry's age.
    expect(isPrunable(yesterday, now, 3600000)).toBe(true);
  });

  it("every offered choice is inside what sanitizeAdminSettings allows", () => {
    // The clamp is 30…3650 days. A choice outside it would be offered in the
    // dropdown, written, and silently read back as something else — a control
    // that does not do what it says, which is worse than not having it.
    RETENTION_CHOICES.forEach((c) => {
      expect(c.days).toBeGreaterThanOrEqual(30);
      expect(c.days).toBeLessThanOrEqual(3650);
      expect(Number.isInteger(c.days)).toBe(true);
    });
    expect(RETENTION_CHOICES.some((c) => c.days === DEFAULT_RETENTION_DAYS)).toBe(true);
  });

  it("labels a stored value, including one no longer offered", () => {
    expect(retentionLabel(365)).toBe("12 months");
    expect(retentionLabel(90)).toBe("3 months");
    // A value written by an older build, or by hand in the console, still reads
    // as something rather than as blank.
    expect(retentionLabel(400)).toBe("400 days");
  });
});
