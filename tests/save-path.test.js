// tests/save-path.test.js — v18.3.4 phase 1
//
// ── CHARACTERIZATION: what the save path DOES, pinned before it moves ────────
// v18.3.4 (ROADMAP #13) moves the booking save out of `BookingApp`: `doSaveEdit`
// (355 lines) and `doSaveNew` into pure `applyEdit` / `buildBooking`, the walk-in
// and the weekly occurrence into builders beside them, and the field lists into
// one table. "Write characterization tests first" — and until now no test could
// CALL any of that code: it is closures inside `App.jsx` and `useWalkin.js`, and
// this suite deliberately has no DOM (tests/CLAUDE.md).
//
// So this file runs the app's OWN code. It lifts the functions out of the
// comment-stripped source, compiles them in one scope that binds exactly the
// names their file imports from `src/lib/` (the same module objects), plus
// recorded stubs for the React half (`setError`, the refs, `saveBookings`,
// `flash` …), and drives them through a scenario matrix with the clock frozen.
// Every free name in the lifted text must be bound — ESLint's own `no-undef`
// decides which names those are — so a stub that goes missing fails the
// COMPILE, not just the one scenario that happens to reach it.
//
// Each scenario pins what the save did: every call it made, in order and with
// its arguments (refusals and the field they name included), and the rows its
// write would touch — a created row as one line of JSON in its own key order,
// a changed row field by field, so a key that appears, vanishes, moves or
// turns `undefined` shows. The `replay` line pins the v15.7.0 contract: the
// transform handed to `saveBookings` returns the same object for the same
// `prev` and an equal result for a fresh one.
//
// ── THE RULE THAT MAKES IT WORTH HAVING ─────────────────────────────────────
// The snapshots were generated against v18.3.3's code and reviewed when they
// were taken. **No later commit may change one.** A refactor that moves code
// keeps every snapshot byte-identical; a snapshot that moves is a behaviour
// change, which is a finding, not an expectation to update. Never run this
// file with `-u` to make a refactor pass.
//
// After the move the same scenarios run against the thin wrappers that call
// the lib (the scope picks up whatever the file imports), so this keeps
// guarding App's wiring — the first test that executes the save path at all.
//
// ── DETERMINISM ─────────────────────────────────────────────────────────────
// `vi.setSystemTime` at LOCAL times (the app's clock is local: `todayStr`,
// `getHours`) and TZ pinned to the restaurant's own zone for the file, so a
// history stamp (`toISOString`, UTC) reads the same on every machine.
// `Math.random` is a counter, so `genId()` is reproducible. The default clock
// is 19:30, after the 15:00 cutoff, so `autoOptimizer` defaults to the value
// the app holds then (off); a date that is not today is the optimiser's
// whatever the switch says (`optimizerActiveFor`).

import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import process from "node:process";
import { Linter } from "eslint";
import globals from "globals";
import { stripComments } from "../scripts/strip-comments.mjs";
import * as bookingLogic from "../src/lib/booking-logic.js";
import * as constants from "../src/lib/constants.js";
import * as customers from "../src/lib/customers.js";
import * as vouchers from "../src/lib/vouchers.js";
import * as day from "../src/lib/day.js";
import * as submitGuard from "../src/lib/submitGuard.js";
import * as recurringLib from "../src/lib/recurring.js";
import * as drafts from "../src/lib/drafts.js";

// ── The lib modules the lifted code may bind, by basename ───────────────────
// A lifted function that names an import from any OTHER module (a component, a
// hook, firebase) fails the scope build loudly rather than running without it.
const LIB = {
  "booking-logic": bookingLogic,
  "constants": constants,
  "customers": customers,
  "vouchers": vouchers,
  "day": day,
  "submitGuard": submitGuard,
  "recurring": recurringLib,
  "drafts": drafts,
};

const read = (rel) => stripComments(readFileSync(new URL("../" + rel, import.meta.url), "utf8")).join("\n");
const APP = read("src/App.jsx");
const WALKIN = read("src/hooks/useWalkin.js");

// ── Lifting ─────────────────────────────────────────────────────────────────
// Skip a string literal starting at `i`; returns the index of its closing quote.
function skipString(src, i) {
  const q = src[i];
  for (let j = i + 1; j < src.length; j++) {
    if (src[j] === "\\") { j++; continue; }
    if (src[j] === q) return j;
  }
  throw new Error("unterminated string at " + i);
}
// The index of the brace closing the one opened at `open`, skipping strings.
function closeOf(src, open) {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === '"' || c === "'" || c === "`") { i = skipString(src, i); continue; }
    if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return i;
  }
  throw new Error("unbalanced braces from " + open);
}
// `function NAME(…){…}` — exactly one declaration, or the lift is ambiguous.
function liftFunction(src, name) {
  const head = "function " + name + "(";
  const at = src.indexOf(head);
  if (at < 0) throw new Error("no function " + name);
  if (src.indexOf(head, at + 1) >= 0) throw new Error("two functions named " + name);
  const open = src.indexOf("{", src.indexOf(")", at));
  return src.slice(at, closeOf(src, open) + 1);
}
// The `useEffect(function(){…}` callback whose body holds `marker`.
function liftEffect(src, marker, as) {
  const m = src.indexOf(marker);
  if (m < 0) throw new Error("no marker " + marker);
  const at = src.lastIndexOf("useEffect(function(){", m);
  const open = src.indexOf("{", at);
  const close = closeOf(src, open);
  if (close < m) throw new Error("marker " + marker + " is not inside the effect before it");
  return "function " + as + "()" + src.slice(open, close + 1);
}

// `import { a, b as c } from "…/lib/x"` → { c: LIB.x.b, … } for every name the
// lifted text actually uses. Word-boundary match: binding an unused name is
// harmless, missing a used one is not (and `freeNames` below catches that).
function importScope(src, lifted) {
  const scope = {};
  const re = /import\s*\{([^}]*)\}\s*from\s*"([^"]+)"/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const lib = /(?:^|\/)lib\/([\w-]+)$/.exec(m[2]);
    m[1].split(",").map((s) => s.trim()).filter(Boolean).forEach((spec) => {
      const [imported, local] = spec.split(/\s+as\s+/).map((x) => x.trim());
      const name = local || imported;
      if (!new RegExp("\\b" + name.replace(/\$/g, "\\$") + "\\b").test(lifted)) return;
      const mod = lib && LIB[lib[1]];
      if (!mod) throw new Error("lifted code uses `" + name + "` from " + m[2] + ", which the harness does not provide");
      if (!(imported in mod)) throw new Error(m[2] + " has no export " + imported);
      scope[name] = mod[imported];
    });
  }
  return scope;
}

// Every free name in the lifted text, by ESLint's own `no-undef` (a direct
// devDependency, so this is the linter's scope analysis rather than a regex).
const freeNamesCache = new Map();
function freeNames(text) {
  if (freeNamesCache.has(text)) return freeNamesCache.get(text);
  const msgs = new Linter().verify(text, {
    languageOptions: { ecmaVersion: 2024, sourceType: "script", globals: { ...globals.builtin } },
    rules: { "no-undef": "error" },
  });
  const fatal = msgs.filter((m) => m.ruleId !== "no-undef");
  if (fatal.length) throw new Error("lifted code does not parse: " + fatal[0].message);
  const names = Array.from(new Set(msgs.map((m) => /'([^']+)'/.exec(m.message)[1]))).sort();
  freeNamesCache.set(text, names);
  return names;
}

// Compile the lifted functions together, so they call each other as they do in
// the file, inside one scope: the file's lib imports plus `env`.
function compile(fileSrc, lifted, env) {
  const text = lifted.join("\n");
  const imports = importScope(fileSrc, text);
  Object.keys(env).forEach((k) => {
    if (k in imports) throw new Error("env shadows the import " + k);
  });
  const unbound = freeNames(text).filter((n) => !(n in imports) && !(n in env));
  if (unbound.length) throw new Error("lifted code uses names the harness does not bind: " + unbound.join(", "));
  const names = Object.keys(imports).concat(Object.keys(env));
  const exported = lifted.map((src) => /^function ([\w$]+)\(/.exec(src)[1]);
  const body = '"use strict";\n' + text + "\nreturn {" + exported.join(",") + "};";
  return new Function(...names, body)(...names.map((n) => (n in env ? env[n] : imports[n])));
}

// ── App's save path, lifted ─────────────────────────────────────────────────
// `doSave` is the door both kinds of save go through (validation, the prompts,
// then one of the two paths); the helpers it and they call are App code too.
const APP_SAVE_NAMES = [
  "memoByPrev", "cleanPhoneOf", "withClearedSeats", "seatClashSnap", "undoDelta",
  "doSaveEdit", "doSaveNew", "doSave", "openEdit",
];
const APP_SAVE = APP_SAVE_NAMES.map((n) => liftFunction(APP, n));
const APP_GENERATOR = [liftEffect(APP, "dueOccurrences(recurring.rules", "generate")];
const WALKIN_SAVE = ["getNextWalkinNum", "closedNow", "doSaveWalkin"].map((n) => liftFunction(WALKIN, n));

// ── The clock ───────────────────────────────────────────────────────────────
const TODAY = "2026-10-07";   // a Wednesday
const T = "2026-10-14";       // the Wednesday after: the optimiser always owns it
const NEXT = "2026-10-15";    // the Thursday after T
const PAST = "2026-09-30";    // the Wednesday before TODAY
const REAL_TZ = process.env.TZ;
beforeAll(() => { process.env.TZ = "Atlantic/Canary"; });
afterAll(() => { if (REAL_TZ === undefined) delete process.env.TZ; else process.env.TZ = REAL_TZ; });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

function freeze(at) {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(at));
  let seq = 0;
  vi.spyOn(Math, "random").mockImplementation(() => ((++seq * 0.137) % 1));
  const d = new Date();
  return { today: day.todayStr(d), nowMins: d.getHours() * 60 + d.getMinutes() };
}

// ── Fixtures ────────────────────────────────────────────────────────────────
// A stored booking, field for field as v18.3.3's `sanitize` returns it — built
// by hand rather than BY `sanitize`, because `sanitize` is one of the things
// this version rewrites and the inputs must not move with it.
function bk(id, o) {
  const b = Object.assign({
    id, name: "Guest " + id, phone: "", date: T, time: "20:00", scheduledTime: null,
    size: 2, duration: 90, originalDuration: null, preference: "auto", notes: "",
    status: "confirmed", tables: [], customDur: null, _manual: false, _locked: false,
    _conflict: false, preferredTables: [], returnOf: null, history: [], noShow: false,
    deposit: 0, voucherCode: "", recurringId: null, recurringDate: null,
    anonymized: false, guestId: null, stayedMin: 0, updatedAt: 1,
  }, o);
  if (b.scheduledTime === null) b.scheduledTime = b.time;
  if (b.originalDuration === null) b.originalDuration = b.duration;
  return b;
}
// The edit form's draft for `b`, exactly as `openEdit` builds it (the harness
// proves that below), with `o` on top — what a person changed before Save.
function draftOf(b, o) {
  return Object.assign({
    name: b.name, phone: b.phone || "", date: b.date, time: b.time, size: b.size,
    preference: b.preference, notes: b.notes || "", status: b.status,
    customDur: (b.originalDuration || b.duration) !== bookingLogic.getDur(b.size) ? (b.originalDuration || b.duration) : null,
    deposit: b.deposit ? String(b.deposit) : "", voucherCode: b.voucherCode || "",
    manualTables: [], preferredTables: Array.isArray(b.preferredTables) ? b.preferredTables.slice() : [], returnOf: null,
    guestId: b.guestId || null, guestSeed: null,
  }, o);
}
// A new booking's draft, as `openNew` seeds it (`EMPTY_FORM`, phone "+").
function newDraft(o) {
  return Object.assign({}, constants.EMPTY_FORM, { date: T, time: "20:00" }, o);
}
const tableIds = () => constants.ALL_TABLES.map((t) => t.id);
// Every table on `date` held at `time` by its own two-top, f01…f13.
function fullDay(date, time, locked) {
  return tableIds().map((t, i) => bk("f" + String(i + 1).padStart(2, "0"), {
    date, time, tables: [t], _locked: !!locked, _manual: !!locked,
  }));
}
// The four indoor tables held at `time` by parties nobody can move.
function indoorFull(date, time) {
  return ["i1", "i2", "i3", "i4"].map((t) => bk("in" + t.slice(1), { date, time, tables: [t], _locked: true, _manual: true }));
}

// ── What a run is reduced to ────────────────────────────────────────────────
// Absent and `undefined` are different things to Firebase (`set()` THROWS on an
// undefined property), so neither is allowed to collapse into the other here.
const J = (v) => JSON.stringify(v, (k, x) => (x === undefined ? "<undefined>" : x));
const show = (o, k) => (Object.prototype.hasOwnProperty.call(o, k) ? J(o[k]) : "<absent>");
// The children a write would touch — the same question `buildPatch` asks: a
// created row in full (in its own key order), a changed row field by field, a
// deleted row by id. A row whose key ORDER moved counts as changed: the
// diff-write's `contentKey` is an order-sensitive JSON compare.
function written(before, next) {
  const byId = new Map(before.map((b) => [b.id, b]));
  const rows = {};
  next.forEach((b) => {
    const was = byId.get(b.id);
    if (!was) { rows[b.id] = "created " + J(b); return; }
    const ch = {};
    Array.from(new Set(Object.keys(was).concat(Object.keys(b)))).sort().forEach((k) => {
      const a = show(was, k), z = show(b, k);
      if (a !== z) ch[k] = a + " → " + z;
    });
    if (Object.keys(was).join() !== Object.keys(b).join()) ch["(key order)"] = Object.keys(b).join(",");
    if (Object.keys(ch).length) rows[b.id] = ch;
  });
  before.forEach((b) => { if (!next.some((n) => n.id === b.id)) rows[b.id] = "deleted"; });
  return rows;
}
function render(c) {
  return c[0] + "(" + c.slice(1).map((a) => (typeof a === "function" ? "<fn>" : J(a))).join(", ") + ")";
}
function reduce(h) {
  const out = { calls: h.calls.map(render) };
  if (h.writes.length) out.writes = h.writes.map((w) => ({ rows: written(w.prev, w.next), replay: w.replay }));
  if (h.guardRef) out.guard = h.guardRef.current;
  return out;
}
// A `saveBookings` that does what the real one does with the transform —
// applies it to the mirror (`bookingsRef.current`) — and records the result.
function saver(h, mirror, dispatchOk) {
  return (...args) => {
    const fn = args[0];
    let next, replay;
    if (typeof fn === "function") {
      next = fn(mirror);
      replay = (fn(mirror) === next ? "same prev → same object" : "same prev → recomputed")
        + "; fresh prev → " + (J(fn(mirror.map((b) => Object.assign({}, b)))) === J(next) ? "equal" : "DIFFERENT");
    } else { next = fn; replay = "value form"; }
    h.writes.push({ prev: mirror, next, replay });
    h.calls.push(["saveBookings", typeof fn === "function" ? "<fn>" : "<value>"].concat(args.slice(1)));
    return dispatchOk;
  };
}

// ── Runners ─────────────────────────────────────────────────────────────────
// BookingApp's half of the booking form's save: everything `doSave`,
// `doSaveEdit`, `doSaveNew` and `openEdit` read that is not a lib import —
// state as values, refs as `{current}`, setters and side-effects as recorders.
// `opts`: bookings, mirror (bookings), form, editId, blocks, autoOptimizer
//   (false), swapAffected, at (TODAY 19:30), statusOverride, pendingWaitlist,
//   guard (READY), dispatchOk (true), env (overrides).
function appEnv(opts) {
  const clock = freeze(opts.at || TODAY + "T19:30:00");
  const bookings = opts.bookings || [];
  const h = { calls: [], writes: [], guardRef: { current: opts.guard || submitGuard.READY } };
  const rec = (name) => (...args) => { h.calls.push([name].concat(args)); };
  h.pendingWaitlistRef = { current: opts.pendingWaitlist || null };
  h.env = Object.assign({
    bookings,
    liveBookings: bookingLogic.syncLiveDurations(bookings, clock.today, clock.nowMins),
    editId: opts.editId || null,
    tableBlocks: opts.blocks || [],
    autoOptimizer: opts.autoOptimizer === true,
    swapAffected: opts.swapAffected || null,
    nowMins: clock.nowMins,
    today: clock.today,
    generalSettings: { phonePrefix: "+34", pinnedCountries: ["ES", "GB"], undoSecs: 10, defaultBookingSize: 2 },
    saveGuardRef: h.guardRef,
    statusOverrideRef: { current: opts.statusOverride || null },
    formRef: { current: opts.form || null },
    redeemAskedRef: { current: false },
    seatAskedRef: { current: false },
    clearedSeatsRef: { current: null },
    pendingWaitlistRef: h.pendingWaitlistRef,
    getUser: () => "staff@mgt.test",
    setError: rec("setError"),
    setErrorField: rec("setErrorField"),
    saveBookings: saver(h, opts.mirror || bookings, opts.dispatchOk !== false),
    flash: rec("flash"),
    armUndo: (snaps, ...rest) => { h.calls.push(["armUndo", (snaps || []).map((x) => x.id)].concat(rest)); },
    setShowForm: rec("setShowForm"),
    setViewDate: rec("setViewDate"),
    setSeatNote: rec("setSeatNote"),
    addRule: (...args) => { h.calls.push(["addRule"].concat(args)); return args[0]; },
    removeFromWaitlist: rec("removeFromWaitlist"),
    wa: {
      completeModifyApply: rec("wa.completeModifyApply"),
      completeDraftAccept: rec("wa.completeDraftAccept"),
      linkBookingByPhone: rec("wa.linkBookingByPhone"),
    },
    voucherToAsk: () => false,
    voucherToRestore: () => false,
    setVoucherAsk: rec("setVoucherAsk"),
    setVoucherBack: rec("setVoucherBack"),
    setSeatClash: rec("setSeatClash"),
    refused: () => false,
    openForm: rec("openForm"),
    setEditId: rec("setEditId"),
    setSwapAffected: rec("setSwapAffected"),
    setShowHistory: rec("setShowHistory"),
  }, opts.env);
  return h;
}
// One Save of the booking form, through `doSave`.
function runSave(opts) {
  const h = appEnv(opts);
  compile(APP, APP_SAVE, h.env).doSave();
  const out = reduce(h);
  if (opts.pendingWaitlist) out.pendingWaitlistAfter = h.pendingWaitlistRef.current;
  return out;
}
// `openEdit(b)`: what the edit form opens with.
function runOpenEdit(b, env) {
  const h = appEnv({ bookings: [b], pendingWaitlist: "w1", env });
  compile(APP, APP_SAVE, h.env).openEdit(b);
  return { calls: h.calls.map(render), pendingWaitlistAfter: h.pendingWaitlistRef.current };
}
// The draft object `openEdit` hands to `openForm`.
function openEditDraft(b) {
  const h = appEnv({ bookings: [b] });
  compile(APP, APP_SAVE, h.env).openEdit(b);
  return h.calls.find((c) => c[0] === "openForm")[1];
}
// `useWalkin`'s half of the walk-in form's Seat.
function walkinEnv(opts) {
  freeze(opts.at || TODAY + "T19:30:00");
  const bookings = opts.bookings || [];
  const h = { calls: [], writes: [], guardRef: { current: opts.guard || submitGuard.READY } };
  const rec = (name) => (...args) => { h.calls.push([name].concat(args)); };
  h.env = {
    bookings,
    walkinForm: opts.form || null,
    walkinGuardRef: h.guardRef,
    setWalkinError: rec("setWalkinError"),
    saveBookings: saver(h, bookings, true),
    getUser: () => "staff@mgt.test",
    setShowWalkin: rec("setShowWalkin"),
    setViewDate: rec("setViewDate"),
  };
  return h;
}
// One Seat of the walk-in form, through `doSaveWalkin`.
function runWalkin(opts) {
  const h = walkinEnv(opts);
  compile(WALKIN, WALKIN_SAVE, h.env).doSaveWalkin();
  return reduce(h);
}
// The standing-booking generator effect's closure.
function generatorEnv(opts) {
  freeze(opts.at || TODAY + "T19:30:00");
  const bookings = opts.bookings || [];
  const h = { calls: [], writes: [], guardRef: null };
  h.env = Object.assign({
    resyncing: false,
    firstLoadCount: { current: bookings.length },
    recurring: { v: 1, enabled: true, horizonWeeks: opts.horizonWeeks || 2, rules: opts.rules || [] },
    bookings,
    tableBlocks: opts.blocks || [],
    autoOptimizer: false,
    saveBookings: saver(h, bookings, true),
  }, opts.env);
  return h;
}
// One pass of the generator effect.
function runGenerator(opts) {
  const h = generatorEnv(opts);
  compile(APP, APP_GENERATOR, h.env).generate();
  return reduce(h);
}
const weekly = (o) => Object.assign({
  id: "wk", name: "Weekly", phone: "+34 600 000 001", size: 2, weekday: 3, time: "20:00",
  preference: "auto", notes: "", active: true, skipDates: [], createdAt: 1, startDate: TODAY,
}, o);

// ═════════════════════════════════════════════════════════════════════════════
describe("the harness runs the code it claims to", () => {
  it("every lifted function compiles with every free name bound", () => {
    expect(Object.keys(compile(APP, APP_SAVE, appEnv({}).env))).toEqual(APP_SAVE_NAMES);
    expect(Object.keys(compile(WALKIN, WALKIN_SAVE, walkinEnv({}).env))).toEqual(["getNextWalkinNum", "closedNow", "doSaveWalkin"]);
    expect(Object.keys(compile(APP, APP_GENERATOR, generatorEnv({}).env))).toEqual(["generate"]);
  });
  it("binds no stub the lifted code does not use", () => {
    // A stub nobody reads is a wiring that has gone and a harness that has not
    // noticed. (Run per group: the two halves of App share one env.)
    const unused = (src, lifted, env) => {
      const text = lifted.join("\n"), imports = importScope(src, text);
      const used = new Set(freeNames(text).filter((n) => !(n in imports)));
      return Object.keys(env).filter((k) => !used.has(k));
    };
    expect(unused(APP, APP_SAVE, appEnv({}).env)).toEqual([]);
    expect(unused(WALKIN, WALKIN_SAVE, walkinEnv({}).env)).toEqual([]);
    expect(unused(APP, APP_GENERATOR, generatorEnv({}).env)).toEqual([]);
  });
  it("refuses to run with a name it cannot bind", () => {
    const env = appEnv({}).env;
    delete env.armUndo;
    expect(() => compile(APP, APP_SAVE, env)).toThrow(/does not bind: armUndo/);
    expect(() => importScope('import { Overlay } from "./components/atoms";', "Overlay(")).toThrow(/does not provide/);
  });
  it("binds the very module objects the app imports", () => {
    const scope = importScope(APP, APP_SAVE.join("\n"));
    expect(scope.bookingsAfterAction).toBe(bookingLogic.bookingsAfterAction);
    expect(scope.normalizeCode).toBe(vouchers.normalizeCode);
    expect(scope.todayStr).toBe(day.todayStr);
  });
  it("draftOf builds exactly the draft openEdit opens with", () => {
    [
      bk("b1", { tables: ["3"], deposit: 20, voucherCode: "ABCD2345", preferredTables: ["3"], guestId: "gx", notes: "n", phone: "+34 600 000 001" }),
      bk("b2", { time: "19:30", scheduledTime: "19:00", duration: 60, originalDuration: 60, customDur: 60 }),
      bk("b3", { size: 6, duration: 120, phone: null, notes: undefined, preferredTables: "x", guestId: undefined }),
    ].forEach((b) => expect(J(draftOf(b))).toBe(J(openEditDraft(b))));
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe("Save — doSave's own refusals, before either path", () => {
  it("no name", () => {
    expect(runSave({ form: newDraft({ name: " " }) })).toMatchInlineSnapshot(`
      {
        "calls": [
          "setErrorField(null)",
          "setErrorField("name")",
          "setError("Customer name is required.")",
        ],
        "guard": "ready",
      }
    `);
  });
  it("a number typed without its country code", () => {
    expect(runSave({ form: newDraft({ name: "Ana", phone: "600 111 222" }) })).toMatchInlineSnapshot(`
      {
        "calls": [
          "setErrorField(null)",
          "setErrorField("phone")",
          "setError("Choose the country code for this phone number.")",
        ],
        "guard": "ready",
      }
    `);
  });
  it("no date", () => {
    expect(runSave({ form: newDraft({ name: "Ana", date: "" }) })).toMatchInlineSnapshot(`
      {
        "calls": [
          "setErrorField(null)",
          "setErrorField("date")",
          "setError("Please set a date.")",
        ],
        "guard": "ready",
      }
    `);
  });
  it("no time", () => {
    expect(runSave({ form: newDraft({ name: "Ana", time: "" }) })).toMatchInlineSnapshot(`
      {
        "calls": [
          "setErrorField(null)",
          "setErrorField("time")",
          "setError("Please set a time.")",
        ],
        "guard": "ready",
      }
    `);
  });
  it("a time the app cannot read", () => {
    expect(runSave({ form: newDraft({ name: "Ana", time: "8pm" }) })).toMatchInlineSnapshot(`
      {
        "calls": [
          "setErrorField(null)",
          "setErrorField("time")",
          "setError("That time could not be read — please set it again.")",
        ],
        "guard": "ready",
      }
    `);
  });
  it("before the day opens", () => {
    expect(runSave({ form: newDraft({ name: "Ana", time: "12:00" }) })).toMatchInlineSnapshot(`
      {
        "calls": [
          "setErrorField(null)",
          "setErrorField("time")",
          "setError("Bookings on this day are accepted between 13:00 and 22:00.")",
        ],
        "guard": "ready",
      }
    `);
  });
  it("after the last start", () => {
    expect(runSave({ form: newDraft({ name: "Ana", time: "21:50" }) })).toMatchInlineSnapshot(`
      {
        "calls": [
          "setErrorField(null)",
          "setErrorField("time")",
          "setError("The last start on Wednesdays is 21:45.")",
        ],
        "guard": "ready",
      }
    `);
  });
  it("hand-picked tables somebody else holds", () => {
    const b2 = bk("b2", { tables: ["4"] });
    expect(runSave({ bookings: [b2], form: newDraft({ name: "Ana", time: "20:30", manualTables: ["4"] }) })).toMatchInlineSnapshot(`
      {
        "calls": [
          "setErrorField(null)",
          "setError("Selected tables are not available at this time.")",
        ],
        "guard": "ready",
      }
    `);
  });
  it("a second tap after the save went out does nothing at all", () => {
    expect(runSave({ guard: submitGuard.DISPATCHED, form: newDraft({ name: "Ana" }) })).toMatchInlineSnapshot(`
      {
        "calls": [],
        "guard": "dispatched",
      }
    `);
  });
  it("asks about the voucher before completing", () => {
    const b1 = bk("b1", { tables: ["1A"], voucherCode: "ABCD2345" });
    expect(runSave({ bookings: [b1], editId: "b1", form: draftOf(b1, { status: "completed" }), env: { voucherToAsk: () => true } })).toMatchInlineSnapshot(`
      {
        "calls": [
          "setErrorField(null)",
          "setVoucherAsk({"id":"b1","status":"completed","from":"form"})",
        ],
        "guard": "ready",
      }
    `);
  });
  it("asks about the redemption before walking a completed booking back", () => {
    const b1 = bk("b1", { tables: ["1A"], status: "completed", voucherCode: "ABCD2345" });
    expect(runSave({ bookings: [b1], editId: "b1", form: draftOf(b1, { status: "confirmed" }), env: { voucherToRestore: () => true } })).toMatchInlineSnapshot(`
      {
        "calls": [
          "setErrorField(null)",
          "setVoucherBack({"id":"b1","status":"confirmed","from":"form"})",
        ],
        "guard": "ready",
      }
    `);
  });
  it("asks before seating a party on a seated party's table", () => {
    const b1 = bk("b1", { date: TODAY, time: "19:00", tables: ["3"] });
    const b2 = bk("b2", { date: TODAY, time: "18:30", tables: ["3"], status: "seated" });
    expect(runSave({ bookings: [b1, b2], editId: "b1", form: draftOf(b1, { status: "seated" }) })).toMatchInlineSnapshot(`
      {
        "calls": [
          "setErrorField(null)",
          "setSeatClash({"id":"b1","status":"seated","from":"form","others":[{"id":"b2","name":"Guest b2","time":"18:30","tables":["3"]}]})",
        ],
        "guard": "ready",
      }
    `);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe("Save — an edit on a day the optimiser owns", () => {
  it("notes only", () => {
    const b1 = bk("b1", { tables: ["1A"] });
    expect(runSave({ bookings: [b1], editId: "b1", form: draftOf(b1, { notes: "window seat" }) })).toMatchInlineSnapshot(`
      {
        "calls": [
          "setErrorField(null)",
          "saveBookings("<fn>")",
          "wa.completeModifyApply("b1", true)",
          "armUndo(["b1"], "b1", "edit", false)",
          "setShowForm(false)",
          "setViewDate("2026-10-14")",
        ],
        "guard": "dispatched",
        "writes": [
          {
            "replay": "same prev → same object; fresh prev → equal",
            "rows": {
              "b1": {
                "history": "[] → [{"at":"2026-10-07T18:30:00.000Z","by":"staff@mgt.test","action":"edited: notes updated"}]",
                "notes": """ → "window seat"",
              },
            },
          },
        ],
      }
    `);
  });
  it("notes only, on a table the optimiser would not choose: any save re-places it", () => {
    const b1 = bk("b1", { tables: ["3"] });
    expect(runSave({ bookings: [b1], editId: "b1", form: draftOf(b1, { notes: "window seat" }) })).toMatchInlineSnapshot(`
      {
        "calls": [
          "setErrorField(null)",
          "saveBookings("<fn>")",
          "wa.completeModifyApply("b1", true)",
          "armUndo(["b1"], "b1", "edit", false)",
          "setShowForm(false)",
          "setViewDate("2026-10-14")",
        ],
        "guard": "dispatched",
        "writes": [
          {
            "replay": "same prev → same object; fresh prev → equal",
            "rows": {
              "b1": {
                "history": "[] → [{"at":"2026-10-07T18:30:00.000Z","by":"staff@mgt.test","action":"edited: notes updated"}]",
                "notes": """ → "window seat"",
                "tables": "["3"] → ["1A"]",
              },
            },
          },
        ],
      }
    `);
  });
  it("nothing changed: a history line, and no undo", () => {
    const b1 = bk("b1", { tables: ["1A"] });
    expect(runSave({ bookings: [b1], editId: "b1", form: draftOf(b1) })).toMatchInlineSnapshot(`
      {
        "calls": [
          "setErrorField(null)",
          "saveBookings("<fn>")",
          "wa.completeModifyApply("b1", true)",
          "setShowForm(false)",
          "setViewDate("2026-10-14")",
        ],
        "guard": "dispatched",
        "writes": [
          {
            "replay": "same prev → same object; fresh prev → equal",
            "rows": {
              "b1": {
                "history": "[] → [{"at":"2026-10-07T18:30:00.000Z","by":"staff@mgt.test","action":"edited: saved (no field changes)"}]",
              },
            },
          },
        ],
      }
    `);
  });
  it("a time change into another party's window", () => {
    const b1 = bk("b1", { tables: ["1A"] });
    const b2 = bk("b2", { time: "18:30", tables: ["1A"] });
    expect(runSave({ bookings: [b1, b2], editId: "b1", form: draftOf(b1, { time: "19:00" }) })).toMatchInlineSnapshot(`
      {
        "calls": [
          "setErrorField(null)",
          "saveBookings("<fn>")",
          "wa.completeModifyApply("b1", true)",
          "flash(null, "")",
          "armUndo(["b1"], "b1", "edit", false)",
          "setShowForm(false)",
          "setViewDate("2026-10-14")",
        ],
        "guard": "dispatched",
        "writes": [
          {
            "replay": "same prev → same object; fresh prev → equal",
            "rows": {
              "b1": {
                "history": "[] → [{"at":"2026-10-07T18:30:00.000Z","by":"staff@mgt.test","action":"edited: time 20:00→19:00"}]",
                "scheduledTime": ""20:00" → "19:00"",
                "tables": "["1A"] → ["1B"]",
                "time": ""20:00" → "19:00"",
              },
            },
          },
        ],
      }
    `);
  });
  it("a date change", () => {
    const b1 = bk("b1", { tables: ["1A"] });
    expect(runSave({ bookings: [b1], editId: "b1", form: draftOf(b1, { date: NEXT }) })).toMatchInlineSnapshot(`
      {
        "calls": [
          "setErrorField(null)",
          "saveBookings("<fn>")",
          "wa.completeModifyApply("b1", true)",
          "flash(null, "")",
          "armUndo(["b1"], "b1", "edit", false)",
          "setShowForm(false)",
          "setViewDate("2026-10-15")",
        ],
        "guard": "dispatched",
        "writes": [
          {
            "replay": "same prev → same object; fresh prev → equal",
            "rows": {
              "b1": {
                "date": ""2026-10-14" → "2026-10-15"",
                "history": "[] → [{"at":"2026-10-07T18:30:00.000Z","by":"staff@mgt.test","action":"edited: date 2026-10-14→2026-10-15"}]",
              },
            },
          },
        ],
      }
    `);
  });
  it("a preference change", () => {
    const b1 = bk("b1", { tables: ["1A"] });
    expect(runSave({ bookings: [b1], editId: "b1", form: draftOf(b1, { preference: "indoor" }) })).toMatchInlineSnapshot(`
      {
        "calls": [
          "setErrorField(null)",
          "saveBookings("<fn>")",
          "wa.completeModifyApply("b1", true)",
          "flash(null, "")",
          "armUndo(["b1"], "b1", "edit", false)",
          "setShowForm(false)",
          "setViewDate("2026-10-14")",
        ],
        "guard": "dispatched",
        "writes": [
          {
            "replay": "same prev → same object; fresh prev → equal",
            "rows": {
              "b1": {
                "history": "[] → [{"at":"2026-10-07T18:30:00.000Z","by":"staff@mgt.test","action":"edited: pref auto→indoor"}]",
                "preference": ""auto" → "indoor"",
                "tables": "["1A"] → ["i1"]",
              },
            },
          },
        ],
      }
    `);
  });
  it("preferred tables", () => {
    const b1 = bk("b1", { tables: ["1A"] });
    expect(runSave({ bookings: [b1], editId: "b1", form: draftOf(b1, { preferredTables: ["4"] }) })).toMatchInlineSnapshot(`
      {
        "calls": [
          "setErrorField(null)",
          "saveBookings("<fn>")",
          "wa.completeModifyApply("b1", true)",
          "flash(null, "")",
          "armUndo(["b1"], "b1", "edit", false)",
          "setShowForm(false)",
          "setViewDate("2026-10-14")",
        ],
        "guard": "dispatched",
        "writes": [
          {
            "replay": "same prev → same object; fresh prev → equal",
            "rows": {
              "b1": {
                "history": "[] → [{"at":"2026-10-07T18:30:00.000Z","by":"staff@mgt.test","action":"edited: preferred tables: 4"}]",
                "preferredTables": "[] → ["4"]",
                "tables": "["1A"] → ["4"]",
              },
            },
          },
        ],
      }
    `);
  });
  it("a bigger party on a full evening: everyone after it moves along a table", () => {
    const day = fullDay(T, "20:00", false);
    expect(runSave({ bookings: day, editId: "f01", form: draftOf(day[0], { size: 3 }) })).toMatchInlineSnapshot(`
      {
        "calls": [
          "setErrorField(null)",
          "saveBookings("<fn>")",
          "wa.completeModifyApply("f01", true)",
          "flash(null, "")",
          "armUndo(["f01","f02","f03","f04","f05","f06","f07","f08","f09"], "f01", "edit", false)",
          "setShowForm(false)",
          "setViewDate("2026-10-14")",
        ],
        "guard": "dispatched",
        "writes": [
          {
            "replay": "same prev → same object; fresh prev → equal",
            "rows": {
              "f01": {
                "history": "[] → [{"at":"2026-10-07T18:30:00.000Z","by":"staff@mgt.test","action":"edited: size 2→3"}]",
                "size": "2 → 3",
                "tables": "["1A"] → ["7"]",
              },
              "f02": {
                "tables": "["1B"] → ["1A"]",
              },
              "f03": {
                "tables": "["2"] → ["1B"]",
              },
              "f04": {
                "tables": "["3"] → ["2"]",
              },
              "f05": {
                "tables": "["4"] → ["3"]",
              },
              "f06": {
                "tables": "["5A"] → ["4"]",
              },
              "f07": {
                "tables": "["5B"] → ["5A"]",
              },
              "f08": {
                "tables": "["6"] → ["5B"]",
              },
              "f09": {
                "tables": "["7"] → ["6"]",
              },
            },
          },
        ],
      }
    `);
  });
  it("seated outside its zone, and this save put it there", () => {
    const b1 = bk("b1", { preference: "indoor", _conflict: true });
    expect(runSave({ bookings: indoorFull(T, "20:00").concat([b1]), editId: "b1", form: draftOf(b1, { notes: "anniversary" }) })).toMatchInlineSnapshot(`
      {
        "calls": [
          "setErrorField(null)",
          "saveBookings("<fn>")",
          "wa.completeModifyApply("b1", true)",
          "flash(null, "Seated outdoor: indoor was full.")",
          "armUndo(["b1"], "b1", "edit", false)",
          "setShowForm(false)",
          "setViewDate("2026-10-14")",
        ],
        "guard": "dispatched",
        "writes": [
          {
            "replay": "same prev → same object; fresh prev → equal",
            "rows": {
              "b1": {
                "_conflict": "true → false",
                "history": "[] → [{"at":"2026-10-07T18:30:00.000Z","by":"staff@mgt.test","action":"edited: notes updated"}]",
                "notes": """ → "anniversary"",
                "tables": "[] → ["1A"]",
              },
            },
          },
        ],
      }
    `);
  });
  it("a cancelled booking revived", () => {
    const b1 = bk("b1", { tables: ["3"], status: "cancelled" });
    expect(runSave({ bookings: [b1], editId: "b1", form: draftOf(b1, { status: "confirmed" }) })).toMatchInlineSnapshot(`
      {
        "calls": [
          "setErrorField(null)",
          "saveBookings("<fn>")",
          "wa.completeModifyApply("b1", true)",
          "armUndo(["b1"], "b1", "edit", false)",
          "setShowForm(false)",
          "setViewDate("2026-10-14")",
        ],
        "guard": "dispatched",
        "writes": [
          {
            "replay": "same prev → same object; fresh prev → equal",
            "rows": {
              "b1": {
                "history": "[] → [{"at":"2026-10-07T18:30:00.000Z","by":"staff@mgt.test","action":"edited: status cancelled→confirmed"}]",
                "status": ""cancelled" → "confirmed"",
                "tables": "["3"] → ["1A"]",
              },
            },
          },
        ],
      }
    `);
  });
  it("a cancelled booking with no table: its size can still be corrected", () => {
    const b1 = bk("b1", { status: "cancelled", _conflict: true });
    expect(runSave({ bookings: [b1], editId: "b1", form: draftOf(b1, { size: 3 }) })).toMatchInlineSnapshot(`
      {
        "calls": [
          "setErrorField(null)",
          "saveBookings("<fn>")",
          "wa.completeModifyApply("b1", true)",
          "flash(null, "")",
          "armUndo(["b1"], "b1", "edit", false)",
          "setShowForm(false)",
          "setViewDate("2026-10-14")",
        ],
        "guard": "dispatched",
        "writes": [
          {
            "replay": "same prev → same object; fresh prev → equal",
            "rows": {
              "b1": {
                "history": "[] → [{"at":"2026-10-07T18:30:00.000Z","by":"staff@mgt.test","action":"edited: size 2→3"}]",
                "size": "2 → 3",
              },
            },
          },
        ],
      }
    `);
  });
  it("confirmed → pending", () => {
    const b1 = bk("b1", { tables: ["1A"] });
    expect(runSave({ bookings: [b1], editId: "b1", form: draftOf(b1, { status: "pending" }) })).toMatchInlineSnapshot(`
      {
        "calls": [
          "setErrorField(null)",
          "saveBookings("<fn>")",
          "wa.completeModifyApply("b1", true)",
          "armUndo(["b1"], "b1", "edit", false)",
          "setShowForm(false)",
          "setViewDate("2026-10-14")",
        ],
        "guard": "dispatched",
        "writes": [
          {
            "replay": "same prev → same object; fresh prev → equal",
            "rows": {
              "b1": {
                "history": "[] → [{"at":"2026-10-07T18:30:00.000Z","by":"staff@mgt.test","action":"edited: status confirmed→pending"}]",
                "status": ""confirmed" → "pending"",
              },
            },
          },
        ],
      }
    `);
  });
  it("pending → confirmed through Save & confirm", () => {
    const b1 = bk("b1", { tables: ["1A"], status: "pending" });
    expect(runSave({ bookings: [b1], editId: "b1", statusOverride: "confirmed", form: draftOf(b1) })).toMatchInlineSnapshot(`
      {
        "calls": [
          "setErrorField(null)",
          "saveBookings("<fn>")",
          "wa.completeModifyApply("b1", true)",
          "armUndo(["b1"], "b1", "edit", false)",
          "setShowForm(false)",
          "setViewDate("2026-10-14")",
        ],
        "guard": "dispatched",
        "writes": [
          {
            "replay": "same prev → same object; fresh prev → equal",
            "rows": {
              "b1": {
                "history": "[] → [{"at":"2026-10-07T18:30:00.000Z","by":"staff@mgt.test","action":"edited: status pending→confirmed"}]",
                "status": ""pending" → "confirmed"",
              },
            },
          },
        ],
      }
    `);
  });
  it("a guest join and nothing else: the seed is stamped, and there is no undo", () => {
    const b1 = bk("b1", { tables: ["1A"], name: "Lola" });
    const b2 = bk("b2", { date: PAST, name: "Lola", tables: ["3"], status: "completed" });
    expect(runSave({ bookings: [b1, b2], editId: "b1", form: draftOf(b1, { guestId: "gb2", guestSeed: "b2" }) })).toMatchInlineSnapshot(`
      {
        "calls": [
          "setErrorField(null)",
          "saveBookings("<fn>")",
          "wa.completeModifyApply("b1", true)",
          "setShowForm(false)",
          "setViewDate("2026-10-14")",
        ],
        "guard": "dispatched",
        "writes": [
          {
            "replay": "same prev → same object; fresh prev → equal",
            "rows": {
              "b1": {
                "guestId": "null → "gb2"",
                "history": "[] → [{"at":"2026-10-07T18:30:00.000Z","by":"staff@mgt.test","action":"edited: saved (no field changes)"}]",
              },
              "b2": {
                "guestId": "null → "gb2"",
              },
            },
          },
        ],
      }
    `);
  });
  it("moved into a full evening it would push somebody off", () => {
    const b1 = bk("b1", { time: "18:00", tables: ["1A"] });
    expect(runSave({ bookings: fullDay(T, "20:00", false).concat([b1]), editId: "b1", form: draftOf(b1, { time: "20:00" }) })).toMatchInlineSnapshot(`
      {
        "calls": [
          "setErrorField(null)",
          "setError("Not enough capacity — this change would displace 1 existing booking: Guest f13.")",
        ],
        "guard": "ready",
      }
    `);
  });
  it("moved into an evening nobody can be moved from: no table", () => {
    const b1 = bk("b1", { time: "18:00", tables: ["1A"] });
    expect(runSave({ bookings: fullDay(T, "20:00", true).concat([b1]), editId: "b1", form: draftOf(b1, { time: "20:00" }) })).toMatchInlineSnapshot(`
      {
        "calls": [
          "setErrorField(null)",
          "setError("No tables available at this time — see suggestions below.")",
        ],
        "guard": "ready",
      }
    `);
  });
  it("the booking was deleted elsewhere while the form was open", () => {
    const b1 = bk("b1", { tables: ["1A"] });
    const b2 = bk("b2", { tables: ["3"] });
    expect(runSave({ bookings: [b2], editId: "b1", form: draftOf(b1, { notes: "late edit" }) })).toMatchInlineSnapshot(`
      {
        "calls": [
          "setErrorField(null)",
          "saveBookings("<fn>")",
          "wa.completeModifyApply("b1", true)",
          "flash(null, "")",
          "setShowForm(false)",
          "setViewDate("2026-10-14")",
        ],
        "guard": "dispatched",
        "writes": [
          {
            "replay": "same prev → same object; fresh prev → equal",
            "rows": {
              "b2": {
                "tables": "["3"] → ["1A"]",
              },
            },
          },
        ],
      }
    `);
  });
  it("a no-show walked back to confirmed keeps its no-show flag", () => {
    const b1 = bk("b1", { tables: ["1A"], status: "cancelled", noShow: true });
    expect(runSave({ bookings: [b1], editId: "b1", form: draftOf(b1, { status: "confirmed" }) })).toMatchInlineSnapshot(`
      {
        "calls": [
          "setErrorField(null)",
          "saveBookings("<fn>")",
          "wa.completeModifyApply("b1", true)",
          "armUndo(["b1"], "b1", "edit", false)",
          "setShowForm(false)",
          "setViewDate("2026-10-14")",
        ],
        "guard": "dispatched",
        "writes": [
          {
            "replay": "same prev → same object; fresh prev → equal",
            "rows": {
              "b1": {
                "history": "[] → [{"at":"2026-10-07T18:30:00.000Z","by":"staff@mgt.test","action":"edited: status cancelled→confirmed"}]",
                "status": ""cancelled" → "confirmed"",
              },
            },
          },
        ],
      }
    `);
  });
  it("a save the write path holds: no flash and no undo, the form still closes", () => {
    const b1 = bk("b1", { tables: ["1A"] });
    expect(runSave({ bookings: [b1], editId: "b1", dispatchOk: false, form: draftOf(b1, { time: "20:30" }) })).toMatchInlineSnapshot(`
      {
        "calls": [
          "setErrorField(null)",
          "saveBookings("<fn>")",
          "wa.completeModifyApply("b1", false)",
          "setShowForm(false)",
          "setViewDate("2026-10-14")",
        ],
        "guard": "dispatched",
        "writes": [
          {
            "replay": "same prev → same object; fresh prev → equal",
            "rows": {
              "b1": {
                "history": "[] → [{"at":"2026-10-07T18:30:00.000Z","by":"staff@mgt.test","action":"edited: time 20:00→20:30"}]",
                "scheduledTime": ""20:00" → "20:30"",
                "time": ""20:00" → "20:30"",
              },
            },
          },
        ],
      }
    `);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe("Save — what an edit normalises", () => {
  it("name, phone, notes, deposit and voucher together: one history line, in clause order", () => {
    const b1 = bk("b1", { tables: ["1A"], name: "Ana", phone: "+34 600 000 001" });
    expect(runSave({ bookings: [b1], editId: "b1", form: draftOf(b1, { name: "Ana María", phone: "+44 7700 900123", notes: "x", deposit: "25.5", voucherCode: "abcd-2345" }) })).toMatchInlineSnapshot(`
      {
        "calls": [
          "setErrorField(null)",
          "saveBookings("<fn>")",
          "wa.completeModifyApply("b1", true)",
          "armUndo(["b1"], "b1", "edit", false)",
          "setShowForm(false)",
          "setViewDate("2026-10-14")",
        ],
        "guard": "dispatched",
        "writes": [
          {
            "replay": "same prev → same object; fresh prev → equal",
            "rows": {
              "b1": {
                "deposit": "0 → 25.5",
                "history": "[] → [{"at":"2026-10-07T18:30:00.000Z","by":"staff@mgt.test","action":"edited: name Ana→Ana María, phone +34 600 000 001→+44 7700 900123, notes updated, deposit 0→25.5 €, voucher none→ABCD-2345"}]",
                "name": ""Ana" → "Ana María"",
                "notes": """ → "x"",
                "phone": ""+34 600 000 001" → "+44 7700 900123"",
                "voucherCode": """ → "ABCD2345"",
              },
            },
          },
        ],
      }
    `);
  });
  it("a negative deposit and a cleared voucher", () => {
    const b1 = bk("b1", { tables: ["1A"], deposit: 20, voucherCode: "ABCD2345" });
    expect(runSave({ bookings: [b1], editId: "b1", form: draftOf(b1, { deposit: "-5", voucherCode: "" }) })).toMatchInlineSnapshot(`
      {
        "calls": [
          "setErrorField(null)",
          "saveBookings("<fn>")",
          "wa.completeModifyApply("b1", true)",
          "armUndo(["b1"], "b1", "edit", false)",
          "setShowForm(false)",
          "setViewDate("2026-10-14")",
        ],
        "guard": "dispatched",
        "writes": [
          {
            "replay": "same prev → same object; fresh prev → equal",
            "rows": {
              "b1": {
                "deposit": "20 → 0",
                "history": "[] → [{"at":"2026-10-07T18:30:00.000Z","by":"staff@mgt.test","action":"edited: deposit 20→0 €, voucher ABCD-2345→none"}]",
                "voucherCode": ""ABCD2345" → """,
              },
            },
          },
        ],
      }
    `);
  });
  it("a stored number without a code, left untouched, still saves", () => {
    const b1 = bk("b1", { tables: ["1A"], phone: "600111222" });
    expect(runSave({ bookings: [b1], editId: "b1", form: draftOf(b1, { notes: "regular" }) })).toMatchInlineSnapshot(`
      {
        "calls": [
          "setErrorField(null)",
          "saveBookings("<fn>")",
          "wa.completeModifyApply("b1", true)",
          "armUndo(["b1"], "b1", "edit", false)",
          "setShowForm(false)",
          "setViewDate("2026-10-14")",
        ],
        "guard": "dispatched",
        "writes": [
          {
            "replay": "same prev → same object; fresh prev → equal",
            "rows": {
              "b1": {
                "history": "[] → [{"at":"2026-10-07T18:30:00.000Z","by":"staff@mgt.test","action":"edited: notes updated"}]",
                "notes": """ → "regular"",
              },
            },
          },
        ],
      }
    `);
  });
  it("a number typed with its code but no plus gets the plus", () => {
    const b1 = bk("b1", { tables: ["1A"] });
    expect(runSave({ bookings: [b1], editId: "b1", form: draftOf(b1, { phone: "34 600 111 222" }) })).toMatchInlineSnapshot(`
      {
        "calls": [
          "setErrorField(null)",
          "saveBookings("<fn>")",
          "wa.completeModifyApply("b1", true)",
          "armUndo(["b1"], "b1", "edit", false)",
          "setShowForm(false)",
          "setViewDate("2026-10-14")",
        ],
        "guard": "dispatched",
        "writes": [
          {
            "replay": "same prev → same object; fresh prev → equal",
            "rows": {
              "b1": {
                "history": "[] → [{"at":"2026-10-07T18:30:00.000Z","by":"staff@mgt.test","action":"edited: phone none→+34 600 111 222"}]",
                "phone": """ → "+34 600 111 222"",
              },
            },
          },
        ],
      }
    `);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe("Save — an edit today, after the cutoff (optimiser off)", () => {
  it("a time change moves an unlocked booking to the best free table", () => {
    const b1 = bk("b1", { date: TODAY, time: "20:30", tables: ["3"] });
    expect(runSave({ bookings: [b1], editId: "b1", form: draftOf(b1, { time: "21:00" }) })).toMatchInlineSnapshot(`
      {
        "calls": [
          "setErrorField(null)",
          "saveBookings("<fn>")",
          "wa.completeModifyApply("b1", true)",
          "flash(null, "")",
          "armUndo(["b1"], "b1", "edit", false)",
          "setShowForm(false)",
          "setViewDate("2026-10-07")",
        ],
        "guard": "dispatched",
        "writes": [
          {
            "replay": "same prev → same object; fresh prev → equal",
            "rows": {
              "b1": {
                "history": "[] → [{"at":"2026-10-07T18:30:00.000Z","by":"staff@mgt.test","action":"edited: time 20:30→21:00"}]",
                "scheduledTime": ""20:30" → "21:00"",
                "tables": "["3"] → ["1A"]",
                "time": ""20:30" → "21:00"",
              },
            },
          },
        ],
      }
    `);
  });
  it("…and before the cutoff, with the optimiser on, the whole day is re-placed", () => {
    const b1 = bk("b1", { date: TODAY, time: "20:30", tables: ["3"] });
    const b2 = bk("b2", { date: TODAY, time: "20:30", tables: ["4"] });
    expect(runSave({ at: TODAY + "T12:00:00", autoOptimizer: true, bookings: [b1, b2], editId: "b1", form: draftOf(b1, { time: "21:00" }) })).toMatchInlineSnapshot(`
      {
        "calls": [
          "setErrorField(null)",
          "saveBookings("<fn>")",
          "wa.completeModifyApply("b1", true)",
          "flash(null, "")",
          "armUndo(["b1","b2"], "b1", "edit", false)",
          "setShowForm(false)",
          "setViewDate("2026-10-07")",
        ],
        "guard": "dispatched",
        "writes": [
          {
            "replay": "same prev → same object; fresh prev → equal",
            "rows": {
              "b1": {
                "history": "[] → [{"at":"2026-10-07T11:00:00.000Z","by":"staff@mgt.test","action":"edited: time 20:30→21:00"}]",
                "scheduledTime": ""20:30" → "21:00"",
                "tables": "["3"] → ["1B"]",
                "time": ""20:30" → "21:00"",
              },
              "b2": {
                "tables": "["4"] → ["1A"]",
              },
            },
          },
        ],
      }
    `);
  });
  it("a longer stay whose tables are still free keeps them", () => {
    const b1 = bk("b1", { date: TODAY, tables: ["3"] });
    expect(runSave({ bookings: [b1], editId: "b1", form: draftOf(b1, { customDur: 120 }) })).toMatchInlineSnapshot(`
      {
        "calls": [
          "setErrorField(null)",
          "saveBookings("<fn>")",
          "wa.completeModifyApply("b1", true)",
          "armUndo(["b1"], "b1", "edit", false)",
          "setShowForm(false)",
          "setViewDate("2026-10-07")",
        ],
        "guard": "dispatched",
        "writes": [
          {
            "replay": "same prev → same object; fresh prev → equal",
            "rows": {
              "b1": {
                "customDur": "null → 120",
                "duration": "90 → 120",
                "history": "[] → [{"at":"2026-10-07T18:30:00.000Z","by":"staff@mgt.test","action":"edited: duration 90→120min"}]",
                "originalDuration": "90 → 120",
              },
            },
          },
        ],
      }
    `);
  });
  it("a longer stay that runs into the next party is re-placed", () => {
    const b1 = bk("b1", { date: TODAY, tables: ["3"] });
    const b2 = bk("b2", { date: TODAY, time: "21:15", tables: ["3"] });
    expect(runSave({ bookings: [b1, b2], editId: "b1", form: draftOf(b1, { customDur: 120 }) })).toMatchInlineSnapshot(`
      {
        "calls": [
          "setErrorField(null)",
          "saveBookings("<fn>")",
          "wa.completeModifyApply("b1", true)",
          "armUndo(["b1"], "b1", "edit", false)",
          "setShowForm(false)",
          "setViewDate("2026-10-07")",
        ],
        "guard": "dispatched",
        "writes": [
          {
            "replay": "same prev → same object; fresh prev → equal",
            "rows": {
              "b1": {
                "customDur": "null → 120",
                "duration": "90 → 120",
                "history": "[] → [{"at":"2026-10-07T18:30:00.000Z","by":"staff@mgt.test","action":"edited: duration 90→120min"}]",
                "originalDuration": "90 → 120",
                "tables": "["3"] → ["1A"]",
              },
            },
          },
        ],
      }
    `);
  });
  it("revived with its table still free: it keeps it", () => {
    const b1 = bk("b1", { date: TODAY, time: "20:30", tables: ["3"], status: "cancelled" });
    expect(runSave({ bookings: [b1], editId: "b1", form: draftOf(b1, { status: "confirmed" }) })).toMatchInlineSnapshot(`
      {
        "calls": [
          "setErrorField(null)",
          "saveBookings("<fn>")",
          "wa.completeModifyApply("b1", true)",
          "armUndo(["b1"], "b1", "edit", false)",
          "setShowForm(false)",
          "setViewDate("2026-10-07")",
        ],
        "guard": "dispatched",
        "writes": [
          {
            "replay": "same prev → same object; fresh prev → equal",
            "rows": {
              "b1": {
                "history": "[] → [{"at":"2026-10-07T18:30:00.000Z","by":"staff@mgt.test","action":"edited: status cancelled→confirmed"}]",
                "status": ""cancelled" → "confirmed"",
              },
            },
          },
        ],
      }
    `);
  });
  it("revived with its table given away: it is re-placed", () => {
    const b1 = bk("b1", { date: TODAY, time: "20:30", tables: ["3"], status: "cancelled" });
    const b2 = bk("b2", { date: TODAY, time: "20:30", tables: ["3"] });
    expect(runSave({ bookings: [b1, b2], editId: "b1", form: draftOf(b1, { status: "confirmed" }) })).toMatchInlineSnapshot(`
      {
        "calls": [
          "setErrorField(null)",
          "saveBookings("<fn>")",
          "wa.completeModifyApply("b1", true)",
          "armUndo(["b1"], "b1", "edit", false)",
          "setShowForm(false)",
          "setViewDate("2026-10-07")",
        ],
        "guard": "dispatched",
        "writes": [
          {
            "replay": "same prev → same object; fresh prev → equal",
            "rows": {
              "b1": {
                "history": "[] → [{"at":"2026-10-07T18:30:00.000Z","by":"staff@mgt.test","action":"edited: status cancelled→confirmed"}]",
                "status": ""cancelled" → "confirmed"",
                "tables": "["3"] → ["1A"]",
              },
            },
          },
        ],
      }
    `);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe("Save — seating, completing and walking back (today)", () => {
  it("seat a party that arrived late: the start moves, the end stays, the seat note shows", () => {
    const b1 = bk("b1", { date: TODAY, time: "19:00", tables: ["3"], notes: "nut allergy" });
    expect(runSave({ bookings: [b1], editId: "b1", form: draftOf(b1, { status: "seated" }) })).toMatchInlineSnapshot(`
      {
        "calls": [
          "setErrorField(null)",
          "saveBookings("<fn>")",
          "wa.completeModifyApply("b1", true)",
          "flash("saved", "")",
          "armUndo(["b1"], "b1", "edit", false)",
          "setShowForm(false)",
          "setViewDate("2026-10-07")",
          "setSeatNote({"id":"b1","name":"Guest b1","size":2,"time":"19:00","tables":["3"],"notes":"nut allergy"})",
        ],
        "guard": "dispatched",
        "writes": [
          {
            "replay": "same prev → same object; fresh prev → equal",
            "rows": {
              "b1": {
                "customDur": "null → 60",
                "duration": "90 → 60",
                "history": "[] → [{"at":"2026-10-07T18:30:00.000Z","by":"staff@mgt.test","action":"edited: status confirmed→seated"},{"at":"2026-10-07T18:30:00.000Z","by":"staff@mgt.test","action":"seated late: time adjusted 19:00 → 19:30"}]",
                "originalDuration": "90 → 60",
                "status": ""confirmed" → "seated"",
                "time": ""19:00" → "19:30"",
              },
            },
          },
        ],
      }
    `);
  });
  it("seat a party that arrived early", () => {
    const b1 = bk("b1", { date: TODAY, time: "20:00", tables: ["3"] });
    expect(runSave({ bookings: [b1], editId: "b1", form: draftOf(b1, { status: "seated" }) })).toMatchInlineSnapshot(`
      {
        "calls": [
          "setErrorField(null)",
          "saveBookings("<fn>")",
          "wa.completeModifyApply("b1", true)",
          "flash("saved", "")",
          "armUndo(["b1"], "b1", "edit", false)",
          "setShowForm(false)",
          "setViewDate("2026-10-07")",
        ],
        "guard": "dispatched",
        "writes": [
          {
            "replay": "same prev → same object; fresh prev → equal",
            "rows": {
              "b1": {
                "customDur": "null → 120",
                "duration": "90 → 120",
                "history": "[] → [{"at":"2026-10-07T18:30:00.000Z","by":"staff@mgt.test","action":"edited: status confirmed→seated"},{"at":"2026-10-07T18:30:00.000Z","by":"staff@mgt.test","action":"seated early: time adjusted 20:00 → 19:30"}]",
                "originalDuration": "90 → 120",
                "status": ""confirmed" → "seated"",
                "time": ""20:00" → "19:30"",
              },
            },
          },
        ],
      }
    `);
  });
  it("seat with the time edited in the same save: the typed time wins", () => {
    const b1 = bk("b1", { date: TODAY, time: "19:00", tables: ["3"] });
    expect(runSave({ bookings: [b1], editId: "b1", form: draftOf(b1, { status: "seated", time: "19:15" }) })).toMatchInlineSnapshot(`
      {
        "calls": [
          "setErrorField(null)",
          "saveBookings("<fn>")",
          "wa.completeModifyApply("b1", true)",
          "flash("saved", "")",
          "armUndo(["b1"], "b1", "edit", false)",
          "setShowForm(false)",
          "setViewDate("2026-10-07")",
        ],
        "guard": "dispatched",
        "writes": [
          {
            "replay": "same prev → same object; fresh prev → equal",
            "rows": {
              "b1": {
                "history": "[] → [{"at":"2026-10-07T18:30:00.000Z","by":"staff@mgt.test","action":"edited: time 19:00→19:15, status confirmed→seated"}]",
                "scheduledTime": ""19:00" → "19:15"",
                "status": ""confirmed" → "seated"",
                "time": ""19:00" → "19:15"",
              },
            },
          },
        ],
      }
    `);
  });
  it("seat a booking that has no table", () => {
    const b1 = bk("b1", { date: TODAY, time: "19:00", _conflict: true });
    expect(runSave({ bookings: [b1], editId: "b1", form: draftOf(b1, { status: "seated" }) })).toMatchInlineSnapshot(`
      {
        "calls": [
          "setErrorField(null)",
          "setError("Assign a table before seating this booking.")",
        ],
        "guard": "ready",
      }
    `);
  });
  it("seat after completing the party at the table (the prompt's answer)", () => {
    const b1 = bk("b1", { date: TODAY, time: "19:00", tables: ["3"] });
    const b2 = bk("b2", { date: TODAY, time: "17:30", tables: ["3"], status: "seated" });
    const cleared = { ids: ["b2"], today: TODAY, nowM: 19 * 60 + 30 };
    const mirror = [b1, Object.assign({}, b2, bookingLogic.completedSeatedPatch(b2, TODAY, cleared.nowM))];
    expect(runSave({ bookings: [b1, b2], mirror, editId: "b1", form: draftOf(b1, { status: "seated" }), env: { seatAskedRef: { current: true }, clearedSeatsRef: { current: cleared } } })).toMatchInlineSnapshot(`
      {
        "calls": [
          "setErrorField(null)",
          "saveBookings("<fn>")",
          "wa.completeModifyApply("b1", true)",
          "flash("saved", "")",
          "armUndo(["b1"], "b1", "edit", false)",
          "setShowForm(false)",
          "setViewDate("2026-10-07")",
        ],
        "guard": "dispatched",
        "writes": [
          {
            "replay": "same prev → same object; fresh prev → equal",
            "rows": {
              "b1": {
                "customDur": "null → 60",
                "duration": "90 → 60",
                "history": "[] → [{"at":"2026-10-07T18:30:00.000Z","by":"staff@mgt.test","action":"edited: status confirmed→seated"},{"at":"2026-10-07T18:30:00.000Z","by":"staff@mgt.test","action":"seated late: time adjusted 19:00 → 19:30"}]",
                "originalDuration": "90 → 60",
                "status": ""confirmed" → "seated"",
                "time": ""19:00" → "19:30"",
              },
            },
          },
        ],
      }
    `);
  });
  it("a seated booking cannot move to another date", () => {
    const b1 = bk("b1", { date: TODAY, time: "19:00", tables: ["3"], status: "seated" });
    expect(runSave({ bookings: [b1], editId: "b1", form: draftOf(b1, { date: NEXT }) })).toMatchInlineSnapshot(`
      {
        "calls": [
          "setErrorField(null)",
          "setErrorField("date")",
          "setError("A seated booking can't be moved to another date — change the status first.")",
        ],
        "guard": "ready",
      }
    `);
  });
  it("a seated party that grows past its table", () => {
    const b1 = bk("b1", { date: TODAY, time: "19:00", tables: ["3"], status: "seated" });
    expect(runSave({ bookings: [b1], editId: "b1", form: draftOf(b1, { size: 4 }) })).toMatchInlineSnapshot(`
      {
        "calls": [
          "setErrorField(null)",
          "setError("Party of 4 doesn't fit table 3 (seats 2). Assign tables that seat 4.")",
        ],
        "guard": "ready",
      }
    `);
  });
  it("a seated stay extended onto a party locked to the table", () => {
    const b1 = bk("b1", { date: TODAY, time: "19:00", tables: ["3"], status: "seated" });
    const b2 = bk("b2", { date: TODAY, time: "20:45", tables: ["3"], _locked: true, _manual: true });
    expect(runSave({ bookings: [b1, b2], editId: "b1", form: draftOf(b1, { customDur: 150 }) })).toMatchInlineSnapshot(`
      {
        "calls": [
          "setErrorField(null)",
          "setError("Table 3 is also held by Guest b2 at 20:45, who is locked to it. Assign different tables.")",
        ],
        "guard": "ready",
      }
    `);
  });
  it("seated → completed: the length becomes the stay", () => {
    const b1 = bk("b1", { date: TODAY, time: "19:00", tables: ["3"], status: "seated" });
    expect(runSave({ bookings: [b1], editId: "b1", form: draftOf(b1, { status: "completed" }) })).toMatchInlineSnapshot(`
      {
        "calls": [
          "setErrorField(null)",
          "saveBookings("<fn>")",
          "wa.completeModifyApply("b1", true)",
          "flash(null, "")",
          "armUndo(["b1"], "b1", "edit", false)",
          "setShowForm(false)",
          "setViewDate("2026-10-07")",
        ],
        "guard": "dispatched",
        "writes": [
          {
            "replay": "same prev → same object; fresh prev → equal",
            "rows": {
              "b1": {
                "customDur": "null → 30",
                "duration": "90 → 30",
                "history": "[] → [{"at":"2026-10-07T18:30:00.000Z","by":"staff@mgt.test","action":"edited: status seated→completed"}]",
                "status": ""seated" → "completed"",
                "stayedMin": "0 → 30",
              },
            },
          },
        ],
      }
    `);
  });
  it("confirmed → completed: the length is left alone", () => {
    const b1 = bk("b1", { date: TODAY, time: "18:00", tables: ["3"] });
    expect(runSave({ bookings: [b1], editId: "b1", form: draftOf(b1, { status: "completed" }) })).toMatchInlineSnapshot(`
      {
        "calls": [
          "setErrorField(null)",
          "saveBookings("<fn>")",
          "wa.completeModifyApply("b1", true)",
          "flash(null, "")",
          "armUndo(["b1"], "b1", "edit", false)",
          "setShowForm(false)",
          "setViewDate("2026-10-07")",
        ],
        "guard": "dispatched",
        "writes": [
          {
            "replay": "same prev → same object; fresh prev → equal",
            "rows": {
              "b1": {
                "history": "[] → [{"at":"2026-10-07T18:30:00.000Z","by":"staff@mgt.test","action":"edited: status confirmed→completed"}]",
                "status": ""confirmed" → "completed"",
              },
            },
          },
        ],
      }
    `);
  });
  it("un-seat: the booked start and length come back", () => {
    const b1 = bk("b1", { date: TODAY, time: "19:30", scheduledTime: "19:00", duration: 60, originalDuration: 60, customDur: 60, tables: ["3"], status: "seated" });
    expect(runSave({ bookings: [b1], editId: "b1", form: draftOf(b1, { status: "confirmed" }) })).toMatchInlineSnapshot(`
      {
        "calls": [
          "setErrorField(null)",
          "saveBookings("<fn>")",
          "wa.completeModifyApply("b1", true)",
          "armUndo(["b1"], "b1", "edit", false)",
          "setShowForm(false)",
          "setViewDate("2026-10-07")",
        ],
        "guard": "dispatched",
        "writes": [
          {
            "replay": "same prev → same object; fresh prev → equal",
            "rows": {
              "b1": {
                "customDur": "60 → null",
                "duration": "60 → 90",
                "history": "[] → [{"at":"2026-10-07T18:30:00.000Z","by":"staff@mgt.test","action":"edited: status seated→confirmed"},{"at":"2026-10-07T18:30:00.000Z","by":"staff@mgt.test","action":"un-seated: time restored 19:30 → 19:00, length 60 → 90 min"}]",
                "originalDuration": "60 → 90",
                "status": ""seated" → "confirmed"",
                "time": ""19:30" → "19:00"",
              },
            },
          },
        ],
      }
    `);
  });
  it("a seated booking's start corrected: its table stays", () => {
    const b1 = bk("b1", { date: TODAY, time: "19:00", tables: ["3"], status: "seated" });
    expect(runSave({ bookings: [b1], editId: "b1", form: draftOf(b1, { time: "18:45" }) })).toMatchInlineSnapshot(`
      {
        "calls": [
          "setErrorField(null)",
          "saveBookings("<fn>")",
          "wa.completeModifyApply("b1", true)",
          "flash(null, "")",
          "armUndo(["b1"], "b1", "edit", false)",
          "setShowForm(false)",
          "setViewDate("2026-10-07")",
        ],
        "guard": "dispatched",
        "writes": [
          {
            "replay": "same prev → same object; fresh prev → equal",
            "rows": {
              "b1": {
                "history": "[] → [{"at":"2026-10-07T18:30:00.000Z","by":"staff@mgt.test","action":"edited: time 19:00→18:45"}]",
                "scheduledTime": ""19:00" → "18:45"",
                "time": ""19:00" → "18:45"",
              },
            },
          },
        ],
      }
    `);
  });
  it("un-seat with the time typed in the same save: the typed time wins, nothing is restored", () => {
    const b1 = bk("b1", { date: TODAY, time: "19:30", scheduledTime: "19:00", duration: 60, originalDuration: 60, customDur: 60, tables: ["3"], status: "seated" });
    expect(runSave({ bookings: [b1], editId: "b1", form: draftOf(b1, { status: "confirmed", time: "20:00" }) })).toMatchInlineSnapshot(`
      {
        "calls": [
          "setErrorField(null)",
          "saveBookings("<fn>")",
          "wa.completeModifyApply("b1", true)",
          "flash(null, "")",
          "armUndo(["b1"], "b1", "edit", false)",
          "setShowForm(false)",
          "setViewDate("2026-10-07")",
        ],
        "guard": "dispatched",
        "writes": [
          {
            "replay": "same prev → same object; fresh prev → equal",
            "rows": {
              "b1": {
                "history": "[] → [{"at":"2026-10-07T18:30:00.000Z","by":"staff@mgt.test","action":"edited: time 19:30→20:00, status seated→confirmed"}]",
                "scheduledTime": ""19:00" → "20:00"",
                "status": ""seated" → "confirmed"",
                "tables": "["3"] → ["1A"]",
                "time": ""19:30" → "20:00"",
              },
            },
          },
        ],
      }
    `);
  });
  it("un-seat with a length typed in the same save: the start comes back, the typed length stays", () => {
    const b1 = bk("b1", { date: TODAY, time: "19:30", scheduledTime: "19:00", duration: 60, originalDuration: 60, customDur: 60, tables: ["3"], status: "seated" });
    expect(runSave({ bookings: [b1], editId: "b1", form: draftOf(b1, { status: "confirmed", customDur: 120 }) })).toMatchInlineSnapshot(`
      {
        "calls": [
          "setErrorField(null)",
          "saveBookings("<fn>")",
          "wa.completeModifyApply("b1", true)",
          "armUndo(["b1"], "b1", "edit", false)",
          "setShowForm(false)",
          "setViewDate("2026-10-07")",
        ],
        "guard": "dispatched",
        "writes": [
          {
            "replay": "same prev → same object; fresh prev → equal",
            "rows": {
              "b1": {
                "customDur": "60 → 120",
                "duration": "60 → 120",
                "history": "[] → [{"at":"2026-10-07T18:30:00.000Z","by":"staff@mgt.test","action":"edited: duration 60→120min, status seated→confirmed"},{"at":"2026-10-07T18:30:00.000Z","by":"staff@mgt.test","action":"un-seated: time restored 19:30 → 19:00"}]",
                "originalDuration": "60 → 120",
                "status": ""seated" → "confirmed"",
                "time": ""19:30" → "19:00"",
              },
            },
          },
        ],
      }
    `);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe("Save — tables somebody chose by hand", () => {
  it("a hand-placed booking's time change keeps its table; the unlocked party in the way moves", () => {
    const b1 = bk("b1", { tables: ["3"], _locked: true, _manual: true });
    const b2 = bk("b2", { time: "21:00", tables: ["3"] });
    expect(runSave({ bookings: [b1, b2], editId: "b1", form: draftOf(b1, { time: "20:30" }) })).toMatchInlineSnapshot(`
      {
        "calls": [
          "setErrorField(null)",
          "saveBookings("<fn>")",
          "wa.completeModifyApply("b1", true)",
          "flash(null, "")",
          "armUndo(["b1","b2"], "b1", "edit", false)",
          "setShowForm(false)",
          "setViewDate("2026-10-14")",
        ],
        "guard": "dispatched",
        "writes": [
          {
            "replay": "same prev → same object; fresh prev → equal",
            "rows": {
              "b1": {
                "history": "[] → [{"at":"2026-10-07T18:30:00.000Z","by":"staff@mgt.test","action":"edited: time 20:00→20:30"}]",
                "scheduledTime": ""20:00" → "20:30"",
                "time": ""20:00" → "20:30"",
              },
              "b2": {
                "tables": "["3"] → ["1A"]",
              },
            },
          },
        ],
      }
    `);
  });
  it("…into a party locked to the same table", () => {
    const b1 = bk("b1", { tables: ["3"], _locked: true, _manual: true });
    const b2 = bk("b2", { time: "21:00", tables: ["3"], _locked: true, _manual: true });
    expect(runSave({ bookings: [b1, b2], editId: "b1", form: draftOf(b1, { time: "20:30" }) })).toMatchInlineSnapshot(`
      {
        "calls": [
          "setErrorField(null)",
          "setError("Table 3 is also held by Guest b2 at 21:00, who is locked to it. Assign different tables.")",
        ],
        "guard": "ready",
      }
    `);
  });
  it("…into a table block", () => {
    const b1 = bk("b1", { tables: ["3"], _locked: true, _manual: true });
    const blocks = [{ id: "k1", tableId: "3", date: T, from: "21:00", to: "22:00" }];
    expect(runSave({ bookings: [b1], blocks, editId: "b1", form: draftOf(b1, { time: "20:30" }) })).toMatchInlineSnapshot(`
      {
        "calls": [
          "setErrorField(null)",
          "setError("Table 3 is blocked at that time. Assign different tables.")",
        ],
        "guard": "ready",
      }
    `);
  });
  it("…today with the optimiser off: the party in the way is re-placed before the save", () => {
    const b1 = bk("b1", { date: TODAY, tables: ["3"], _locked: true, _manual: true });
    const b2 = bk("b2", { date: TODAY, time: "21:30", tables: ["3"] });
    expect(runSave({ bookings: [b1, b2], editId: "b1", form: draftOf(b1, { time: "20:30" }) })).toMatchInlineSnapshot(`
      {
        "calls": [
          "setErrorField(null)",
          "saveBookings("<fn>")",
          "wa.completeModifyApply("b1", true)",
          "flash(null, "")",
          "armUndo(["b1","b2"], "b1", "edit", false)",
          "setShowForm(false)",
          "setViewDate("2026-10-07")",
        ],
        "guard": "dispatched",
        "writes": [
          {
            "replay": "same prev → same object; fresh prev → equal",
            "rows": {
              "b1": {
                "history": "[] → [{"at":"2026-10-07T18:30:00.000Z","by":"staff@mgt.test","action":"edited: time 20:00→20:30"}]",
                "scheduledTime": ""20:00" → "20:30"",
                "time": ""20:00" → "20:30"",
              },
              "b2": {
                "tables": "["3"] → ["1A"]",
              },
            },
          },
        ],
      }
    `);
  });
  it("tables picked in the form", () => {
    const b1 = bk("b1", { tables: ["1A"] });
    expect(runSave({ bookings: [b1], editId: "b1", form: draftOf(b1, { manualTables: ["4"] }) })).toMatchInlineSnapshot(`
      {
        "calls": [
          "setErrorField(null)",
          "saveBookings("<fn>")",
          "wa.completeModifyApply("b1", true)",
          "armUndo(["b1"], "b1", "edit", false)",
          "setShowForm(false)",
          "setViewDate("2026-10-14")",
        ],
        "guard": "dispatched",
        "writes": [
          {
            "replay": "same prev → same object; fresh prev → equal",
            "rows": {
              "b1": {
                "_locked": "false → true",
                "_manual": "false → true",
                "history": "[] → [{"at":"2026-10-07T18:30:00.000Z","by":"staff@mgt.test","action":"edited: tables manually set: 4"}]",
                "tables": "["1A"] → ["4"]",
              },
            },
          },
        ],
      }
    `);
  });
  it("Clear on a hand-placed booking hands it back to the optimiser", () => {
    const b1 = bk("b1", { tables: ["3"], _locked: true, _manual: true });
    expect(runSave({ bookings: [b1], editId: "b1", form: draftOf(b1, { _clearManual: true }) })).toMatchInlineSnapshot(`
      {
        "calls": [
          "setErrorField(null)",
          "saveBookings("<fn>")",
          "wa.completeModifyApply("b1", true)",
          "flash(null, "")",
          "armUndo(["b1"], "b1", "edit", false)",
          "setShowForm(false)",
          "setViewDate("2026-10-14")",
        ],
        "guard": "dispatched",
        "writes": [
          {
            "replay": "same prev → same object; fresh prev → equal",
            "rows": {
              "b1": {
                "_locked": "true → false",
                "_manual": "true → false",
                "history": "[] → [{"at":"2026-10-07T18:30:00.000Z","by":"staff@mgt.test","action":"edited: manual assignment cleared"}]",
                "tables": "["3"] → ["1A"]",
              },
            },
          },
        ],
      }
    `);
  });
  it("a finished visit's size: its table is a record and stays", () => {
    const b1 = bk("b1", { date: TODAY, time: "17:00", size: 4, tables: ["7"], status: "completed", _locked: true, _manual: true });
    expect(runSave({ bookings: [b1], editId: "b1", form: draftOf(b1, { size: 5 }) })).toMatchInlineSnapshot(`
      {
        "calls": [
          "setErrorField(null)",
          "saveBookings("<fn>")",
          "wa.completeModifyApply("b1", true)",
          "flash(null, "")",
          "armUndo(["b1"], "b1", "edit", false)",
          "setShowForm(false)",
          "setViewDate("2026-10-07")",
        ],
        "guard": "dispatched",
        "writes": [
          {
            "replay": "same prev → same object; fresh prev → equal",
            "rows": {
              "b1": {
                "duration": "90 → 120",
                "history": "[] → [{"at":"2026-10-07T18:30:00.000Z","by":"staff@mgt.test","action":"edited: size 4→5, duration 90→120min"}]",
                "originalDuration": "90 → 120",
                "size": "4 → 5",
              },
            },
          },
        ],
      }
    `);
  });
  it("a swap: the table is taken from the party holding it, who is re-placed", () => {
    const b1 = bk("b1", { tables: ["1A"] });
    const b2 = bk("b2", { tables: ["3"], _locked: true, _manual: true });
    expect(runSave({ bookings: [b1, b2], editId: "b1", swapAffected: [{ id: "b2", tables: ["3"] }], form: draftOf(b1, { manualTables: ["3"] }) })).toMatchInlineSnapshot(`
      {
        "calls": [
          "setErrorField(null)",
          "saveBookings("<fn>")",
          "wa.completeModifyApply("b1", true)",
          "flash(null, "")",
          "armUndo(["b1","b2"], "b1", "edit", false)",
          "setShowForm(false)",
          "setViewDate("2026-10-14")",
        ],
        "guard": "dispatched",
        "writes": [
          {
            "replay": "same prev → same object; fresh prev → equal",
            "rows": {
              "b1": {
                "_locked": "false → true",
                "_manual": "false → true",
                "history": "[] → [{"at":"2026-10-07T18:30:00.000Z","by":"staff@mgt.test","action":"edited: tables manually set: 3"}]",
                "tables": "["1A"] → ["3"]",
              },
              "b2": {
                "_locked": "true → false",
                "_manual": "true → false",
                "tables": "["3"] → ["1A"]",
              },
            },
          },
        ],
      }
    `);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe("Save — a new booking", () => {
  it("a plain booking on a free evening", () => {
    expect(runSave({ form: newDraft({ name: "Ana" }) })).toMatchInlineSnapshot(`
      {
        "calls": [
          "setErrorField(null)",
          "saveBookings("<fn>")",
          "wa.completeDraftAccept("muyfzww04xjv")",
          "wa.linkBookingByPhone("muyfzww04xjv", "+")",
          "flash(null, "")",
          "setShowForm(false)",
          "setViewDate("2026-10-14")",
        ],
        "guard": "dispatched",
        "writes": [
          {
            "replay": "same prev → same object; fresh prev → equal",
            "rows": {
              "muyfzww04xjv": "created {"id":"muyfzww04xjv","name":"Ana","phone":"","date":"2026-10-14","time":"20:00","scheduledTime":"20:00","size":2,"duration":90,"originalDuration":90,"preference":"auto","notes":"","deposit":0,"voucherCode":"","status":"confirmed","tables":["1A"],"customDur":null,"_manual":false,"_locked":false,"preferredTables":[],"returnOf":null,"recurringId":null,"recurringDate":null,"guestId":null,"history":[{"at":"2026-10-07T18:30:00.000Z","by":"staff@mgt.test","action":"created"}],"_conflict":false}",
            },
          },
        ],
      }
    `);
  });
  it("Save pending", () => {
    expect(runSave({ statusOverride: "pending", form: newDraft({ name: "Ana" }) })).toMatchInlineSnapshot(`
      {
        "calls": [
          "setErrorField(null)",
          "saveBookings("<fn>")",
          "wa.completeDraftAccept("muyfzww04xjv")",
          "wa.linkBookingByPhone("muyfzww04xjv", "+")",
          "flash(null, "")",
          "setShowForm(false)",
          "setViewDate("2026-10-14")",
        ],
        "guard": "dispatched",
        "writes": [
          {
            "replay": "same prev → same object; fresh prev → equal",
            "rows": {
              "muyfzww04xjv": "created {"id":"muyfzww04xjv","name":"Ana","phone":"","date":"2026-10-14","time":"20:00","scheduledTime":"20:00","size":2,"duration":90,"originalDuration":90,"preference":"auto","notes":"","deposit":0,"voucherCode":"","status":"pending","tables":["1A"],"customDur":null,"_manual":false,"_locked":false,"preferredTables":[],"returnOf":null,"recurringId":null,"recurringDate":null,"guestId":null,"history":[{"at":"2026-10-07T18:30:00.000Z","by":"staff@mgt.test","action":"created"}],"_conflict":false}",
            },
          },
        ],
      }
    `);
  });
  it("tables picked in the form", () => {
    expect(runSave({ form: newDraft({ name: "Ana", manualTables: ["4"] }) })).toMatchInlineSnapshot(`
      {
        "calls": [
          "setErrorField(null)",
          "saveBookings("<fn>")",
          "wa.completeDraftAccept("muyfzww04xjv")",
          "wa.linkBookingByPhone("muyfzww04xjv", "+")",
          "flash(null, "")",
          "setShowForm(false)",
          "setViewDate("2026-10-14")",
        ],
        "guard": "dispatched",
        "writes": [
          {
            "replay": "same prev → same object; fresh prev → equal",
            "rows": {
              "muyfzww04xjv": "created {"id":"muyfzww04xjv","name":"Ana","phone":"","date":"2026-10-14","time":"20:00","scheduledTime":"20:00","size":2,"duration":90,"originalDuration":90,"preference":"auto","notes":"","deposit":0,"voucherCode":"","status":"confirmed","tables":["4"],"customDur":null,"_manual":true,"_locked":true,"preferredTables":[],"returnOf":null,"recurringId":null,"recurringDate":null,"guestId":null,"history":[{"at":"2026-10-07T18:30:00.000Z","by":"staff@mgt.test","action":"created"}],"_conflict":false}",
            },
          },
        ],
      }
    `);
  });
  it("nowhere to put it", () => {
    expect(runSave({ bookings: fullDay(T, "20:00", true), form: newDraft({ name: "Ana" }) })).toMatchInlineSnapshot(`
      {
        "calls": [
          "setErrorField(null)",
          "setError("Could not assign a table — try manual assignment.")",
        ],
        "guard": "ready",
      }
    `);
  });
  it("a party that would push somebody else off", () => {
    expect(runSave({ bookings: fullDay(T, "20:00", false), form: newDraft({ name: "Ana", size: 3 }) })).toMatchInlineSnapshot(`
      {
        "calls": [
          "setErrorField(null)",
          "setError("Not enough capacity — adding this booking would displace 1 existing booking: Guest f13.")",
        ],
        "guard": "ready",
      }
    `);
  });
  it("Book Again", () => {
    const b1 = bk("b1", { date: PAST, time: "19:15", scheduledTime: "19:00", tables: ["3"], status: "completed" });
    expect(runSave({ bookings: [b1], form: newDraft({ name: b1.name, returnOf: "b1" }) })).toMatchInlineSnapshot(`
      {
        "calls": [
          "setErrorField(null)",
          "saveBookings("<fn>")",
          "wa.completeDraftAccept("muyfzww04xjv")",
          "wa.linkBookingByPhone("muyfzww04xjv", "+")",
          "flash(null, "")",
          "setShowForm(false)",
          "setViewDate("2026-10-14")",
        ],
        "guard": "dispatched",
        "writes": [
          {
            "replay": "same prev → same object; fresh prev → equal",
            "rows": {
              "b1": {
                "history": "[] → [{"at":"2026-10-07T18:30:00.000Z","by":"staff@mgt.test","action":"Book Again → new booking on 2026-10-14 at 20:00"}]",
              },
              "muyfzww04xjv": "created {"id":"muyfzww04xjv","name":"Guest b1","phone":"","date":"2026-10-14","time":"20:00","scheduledTime":"20:00","size":2,"duration":90,"originalDuration":90,"preference":"auto","notes":"","deposit":0,"voucherCode":"","status":"confirmed","tables":["1A"],"customDur":null,"_manual":false,"_locked":false,"preferredTables":[],"returnOf":"b1","recurringId":null,"recurringDate":null,"guestId":null,"history":[{"at":"2026-10-07T18:30:00.000Z","by":"staff@mgt.test","action":"created via Book Again (from Guest b1 on 2026-09-30 at 19:00)"}],"_conflict":false}",
            },
          },
        ],
      }
    `);
  });
  it("Book Again from a booking deleted meanwhile", () => {
    expect(runSave({ form: newDraft({ name: "Guest b1", returnOf: "b1" }) })).toMatchInlineSnapshot(`
      {
        "calls": [
          "setErrorField(null)",
          "saveBookings("<fn>")",
          "wa.completeDraftAccept("muyfzww04xjv")",
          "wa.linkBookingByPhone("muyfzww04xjv", "+")",
          "flash(null, "")",
          "setShowForm(false)",
          "setViewDate("2026-10-14")",
        ],
        "guard": "dispatched",
        "writes": [
          {
            "replay": "same prev → same object; fresh prev → equal",
            "rows": {
              "muyfzww04xjv": "created {"id":"muyfzww04xjv","name":"Guest b1","phone":"","date":"2026-10-14","time":"20:00","scheduledTime":"20:00","size":2,"duration":90,"originalDuration":90,"preference":"auto","notes":"","deposit":0,"voucherCode":"","status":"confirmed","tables":["1A"],"customDur":null,"_manual":false,"_locked":false,"preferredTables":[],"returnOf":"b1","recurringId":null,"recurringDate":null,"guestId":null,"history":[{"at":"2026-10-07T18:30:00.000Z","by":"staff@mgt.test","action":"created"}],"_conflict":false}",
            },
          },
        ],
      }
    `);
  });
  it("Repeat weekly: the rule is written after the refusals and before the booking", () => {
    expect(runSave({ form: newDraft({ name: "Weekly", phone: "+34 600 000 001", notes: "usual table", repeatWeekly: true }) })).toMatchInlineSnapshot(`
      {
        "calls": [
          "setErrorField(null)",
          "addRule({"id":"muyfzww09v3q","startDate":"2026-10-14","name":"Weekly","phone":"+34 600 000 001","size":2,"weekday":3,"time":"20:00","preference":"auto","notes":"usual table"})",
          "saveBookings("<fn>")",
          "wa.completeDraftAccept("muyfzww04xjv")",
          "wa.linkBookingByPhone("muyfzww04xjv", "+34 600 000 001")",
          "flash(null, "")",
          "setShowForm(false)",
          "setViewDate("2026-10-14")",
        ],
        "guard": "dispatched",
        "writes": [
          {
            "replay": "same prev → same object; fresh prev → equal",
            "rows": {
              "muyfzww04xjv": "created {"id":"muyfzww04xjv","name":"Weekly","phone":"+34 600 000 001","date":"2026-10-14","time":"20:00","scheduledTime":"20:00","size":2,"duration":90,"originalDuration":90,"preference":"auto","notes":"usual table","deposit":0,"voucherCode":"","status":"confirmed","tables":["1A"],"customDur":null,"_manual":false,"_locked":false,"preferredTables":[],"returnOf":null,"recurringId":"muyfzww09v3q","recurringDate":"2026-10-14","guestId":null,"history":[{"at":"2026-10-07T18:30:00.000Z","by":"staff@mgt.test","action":"created"}],"_conflict":false}",
            },
          },
        ],
      }
    `);
  });
  it("Repeat weekly, refused: no rule", () => {
    expect(runSave({ bookings: fullDay(T, "20:00", true), form: newDraft({ name: "Weekly", repeatWeekly: true }) })).toMatchInlineSnapshot(`
      {
        "calls": [
          "setErrorField(null)",
          "setError("Could not assign a table — try manual assignment.")",
        ],
        "guard": "ready",
      }
    `);
  });
  it("a phone-less guest picked from the name list: the seed is stamped too", () => {
    const b2 = bk("b2", { date: PAST, name: "Lola", tables: ["3"], status: "completed" });
    expect(runSave({ bookings: [b2], form: newDraft({ name: "Lola", guestId: "gb2", guestSeed: "b2" }) })).toMatchInlineSnapshot(`
      {
        "calls": [
          "setErrorField(null)",
          "saveBookings("<fn>")",
          "wa.completeDraftAccept("muyfzww04xjv")",
          "wa.linkBookingByPhone("muyfzww04xjv", "+")",
          "flash(null, "")",
          "setShowForm(false)",
          "setViewDate("2026-10-14")",
        ],
        "guard": "dispatched",
        "writes": [
          {
            "replay": "same prev → same object; fresh prev → equal",
            "rows": {
              "b2": {
                "guestId": "null → "gb2"",
              },
              "muyfzww04xjv": "created {"id":"muyfzww04xjv","name":"Lola","phone":"","date":"2026-10-14","time":"20:00","scheduledTime":"20:00","size":2,"duration":90,"originalDuration":90,"preference":"auto","notes":"","deposit":0,"voucherCode":"","status":"confirmed","tables":["1A"],"customDur":null,"_manual":false,"_locked":false,"preferredTables":[],"returnOf":null,"recurringId":null,"recurringDate":null,"guestId":"gb2","history":[{"at":"2026-10-07T18:30:00.000Z","by":"staff@mgt.test","action":"created"}],"_conflict":false}",
            },
          },
        ],
      }
    `);
  });
  it("…whose seed was joined elsewhere in the meantime: the seed's group wins", () => {
    const b2 = bk("b2", { date: PAST, name: "Lola", tables: ["3"], status: "completed", guestId: "gzz" });
    expect(runSave({ bookings: [b2], form: newDraft({ name: "Lola", guestId: "gb2", guestSeed: "b2" }) })).toMatchInlineSnapshot(`
      {
        "calls": [
          "setErrorField(null)",
          "saveBookings("<fn>")",
          "wa.completeDraftAccept("muyfzww04xjv")",
          "wa.linkBookingByPhone("muyfzww04xjv", "+")",
          "flash(null, "")",
          "setShowForm(false)",
          "setViewDate("2026-10-14")",
        ],
        "guard": "dispatched",
        "writes": [
          {
            "replay": "same prev → same object; fresh prev → equal",
            "rows": {
              "muyfzww04xjv": "created {"id":"muyfzww04xjv","name":"Lola","phone":"","date":"2026-10-14","time":"20:00","scheduledTime":"20:00","size":2,"duration":90,"originalDuration":90,"preference":"auto","notes":"","deposit":0,"voucherCode":"","status":"confirmed","tables":["1A"],"customDur":null,"_manual":false,"_locked":false,"preferredTables":[],"returnOf":null,"recurringId":null,"recurringDate":null,"guestId":"gzz","history":[{"at":"2026-10-07T18:30:00.000Z","by":"staff@mgt.test","action":"created"}],"_conflict":false}",
            },
          },
        ],
      }
    `);
  });
  it("a swap", () => {
    const b2 = bk("b2", { tables: ["3"], _locked: true, _manual: true });
    expect(runSave({ bookings: [b2], swapAffected: [{ id: "b2", tables: ["3"] }], form: newDraft({ name: "Ana", manualTables: ["3"] }) })).toMatchInlineSnapshot(`
      {
        "calls": [
          "setErrorField(null)",
          "saveBookings("<fn>")",
          "wa.completeDraftAccept("muyfzww04xjv")",
          "wa.linkBookingByPhone("muyfzww04xjv", "+")",
          "flash(null, "")",
          "setShowForm(false)",
          "setViewDate("2026-10-14")",
        ],
        "guard": "dispatched",
        "writes": [
          {
            "replay": "same prev → same object; fresh prev → equal",
            "rows": {
              "b2": {
                "_locked": "true → false",
                "_manual": "true → false",
                "tables": "["3"] → ["1A"]",
              },
              "muyfzww04xjv": "created {"id":"muyfzww04xjv","name":"Ana","phone":"","date":"2026-10-14","time":"20:00","scheduledTime":"20:00","size":2,"duration":90,"originalDuration":90,"preference":"auto","notes":"","deposit":0,"voucherCode":"","status":"confirmed","tables":["3"],"customDur":null,"_manual":true,"_locked":true,"preferredTables":[],"returnOf":null,"recurringId":null,"recurringDate":null,"guestId":null,"history":[{"at":"2026-10-07T18:30:00.000Z","by":"staff@mgt.test","action":"created"}],"_conflict":false}",
            },
          },
        ],
      }
    `);
  });
  it("seated outside its zone", () => {
    expect(runSave({ bookings: indoorFull(T, "20:00"), form: newDraft({ name: "Ana", preference: "indoor" }) })).toMatchInlineSnapshot(`
      {
        "calls": [
          "setErrorField(null)",
          "saveBookings("<fn>")",
          "wa.completeDraftAccept("muyfzww04xjv")",
          "wa.linkBookingByPhone("muyfzww04xjv", "+")",
          "flash(null, "Seated outdoor: indoor was full.")",
          "setShowForm(false)",
          "setViewDate("2026-10-14")",
        ],
        "guard": "dispatched",
        "writes": [
          {
            "replay": "same prev → same object; fresh prev → equal",
            "rows": {
              "muyfzww04xjv": "created {"id":"muyfzww04xjv","name":"Ana","phone":"","date":"2026-10-14","time":"20:00","scheduledTime":"20:00","size":2,"duration":90,"originalDuration":90,"preference":"indoor","notes":"","deposit":0,"voucherCode":"","status":"confirmed","tables":["1A"],"customDur":null,"_manual":false,"_locked":false,"preferredTables":[],"returnOf":null,"recurringId":null,"recurringDate":null,"guestId":null,"history":[{"at":"2026-10-07T18:30:00.000Z","by":"staff@mgt.test","action":"created"}],"_conflict":false}",
            },
          },
        ],
      }
    `);
  });
  it("from the waitlist: the entry is removed", () => {
    expect(runSave({ pendingWaitlist: "w9", form: newDraft({ name: "Ana" }) })).toMatchInlineSnapshot(`
      {
        "calls": [
          "setErrorField(null)",
          "saveBookings("<fn>")",
          "wa.completeDraftAccept("muyfzww04xjv")",
          "wa.linkBookingByPhone("muyfzww04xjv", "+")",
          "flash(null, "")",
          "removeFromWaitlist("w9")",
          "setShowForm(false)",
          "setViewDate("2026-10-14")",
        ],
        "guard": "dispatched",
        "pendingWaitlistAfter": null,
        "writes": [
          {
            "replay": "same prev → same object; fresh prev → equal",
            "rows": {
              "muyfzww04xjv": "created {"id":"muyfzww04xjv","name":"Ana","phone":"","date":"2026-10-14","time":"20:00","scheduledTime":"20:00","size":2,"duration":90,"originalDuration":90,"preference":"auto","notes":"","deposit":0,"voucherCode":"","status":"confirmed","tables":["1A"],"customDur":null,"_manual":false,"_locked":false,"preferredTables":[],"returnOf":null,"recurringId":null,"recurringDate":null,"guestId":null,"history":[{"at":"2026-10-07T18:30:00.000Z","by":"staff@mgt.test","action":"created"}],"_conflict":false}",
            },
          },
        ],
      }
    `);
  });
  it("a save the write path holds: no flash, the waitlist entry still goes", () => {
    expect(runSave({ pendingWaitlist: "w9", dispatchOk: false, form: newDraft({ name: "Ana" }) })).toMatchInlineSnapshot(`
      {
        "calls": [
          "setErrorField(null)",
          "saveBookings("<fn>")",
          "wa.completeDraftAccept("muyfzww04xjv")",
          "wa.linkBookingByPhone("muyfzww04xjv", "+")",
          "removeFromWaitlist("w9")",
          "setShowForm(false)",
          "setViewDate("2026-10-14")",
        ],
        "guard": "dispatched",
        "pendingWaitlistAfter": null,
        "writes": [
          {
            "replay": "same prev → same object; fresh prev → equal",
            "rows": {
              "muyfzww04xjv": "created {"id":"muyfzww04xjv","name":"Ana","phone":"","date":"2026-10-14","time":"20:00","scheduledTime":"20:00","size":2,"duration":90,"originalDuration":90,"preference":"auto","notes":"","deposit":0,"voucherCode":"","status":"confirmed","tables":["1A"],"customDur":null,"_manual":false,"_locked":false,"preferredTables":[],"returnOf":null,"recurringId":null,"recurringDate":null,"guestId":null,"history":[{"at":"2026-10-07T18:30:00.000Z","by":"staff@mgt.test","action":"created"}],"_conflict":false}",
            },
          },
        ],
      }
    `);
  });
  it("what a new booking normalises", () => {
    expect(runSave({ form: newDraft({ name: "Big table", phone: "34 600 111 222", size: "5", customDur: 150, deposit: "-5", voucherCode: "abcd-2345", notes: "cake" }) })).toMatchInlineSnapshot(`
      {
        "calls": [
          "setErrorField(null)",
          "saveBookings("<fn>")",
          "wa.completeDraftAccept("muyfzww04xjv")",
          "wa.linkBookingByPhone("muyfzww04xjv", "+34 600 111 222")",
          "flash(null, "")",
          "setShowForm(false)",
          "setViewDate("2026-10-14")",
        ],
        "guard": "dispatched",
        "writes": [
          {
            "replay": "same prev → same object; fresh prev → equal",
            "rows": {
              "muyfzww04xjv": "created {"id":"muyfzww04xjv","name":"Big table","phone":"+34 600 111 222","date":"2026-10-14","time":"20:00","scheduledTime":"20:00","size":5,"duration":150,"originalDuration":150,"preference":"auto","notes":"cake","deposit":0,"voucherCode":"ABCD2345","status":"confirmed","tables":["1A","1B"],"customDur":150,"_manual":false,"_locked":false,"preferredTables":[],"returnOf":null,"recurringId":null,"recurringDate":null,"guestId":null,"history":[{"at":"2026-10-07T18:30:00.000Z","by":"staff@mgt.test","action":"created"}],"_conflict":false}",
            },
          },
        ],
      }
    `);
  });
  it("today after the cutoff: the best free table, no reshuffle", () => {
    const b2 = bk("b2", { date: TODAY, time: "20:30", tables: ["3"] });
    expect(runSave({ bookings: [b2], form: newDraft({ name: "Ana", date: TODAY, time: "21:00" }) })).toMatchInlineSnapshot(`
      {
        "calls": [
          "setErrorField(null)",
          "saveBookings("<fn>")",
          "wa.completeDraftAccept("muyfzww04xjv")",
          "wa.linkBookingByPhone("muyfzww04xjv", "+")",
          "flash(null, "")",
          "setShowForm(false)",
          "setViewDate("2026-10-07")",
        ],
        "guard": "dispatched",
        "writes": [
          {
            "replay": "same prev → same object; fresh prev → equal",
            "rows": {
              "muyfzww04xjv": "created {"id":"muyfzww04xjv","name":"Ana","phone":"","date":"2026-10-07","time":"21:00","scheduledTime":"21:00","size":2,"duration":90,"originalDuration":90,"preference":"auto","notes":"","deposit":0,"voucherCode":"","status":"confirmed","tables":["1A"],"customDur":null,"_manual":false,"_locked":false,"preferredTables":[],"returnOf":null,"recurringId":null,"recurringDate":null,"guestId":null,"history":[{"at":"2026-10-07T18:30:00.000Z","by":"staff@mgt.test","action":"created"}],"_conflict":false}",
            },
          },
        ],
      }
    `);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe("openEdit — the draft the form opens with", () => {
  it("a default-length booking", () => {
    expect(runOpenEdit(bk("b1", { tables: ["3"], deposit: 20, voucherCode: "ABCD2345", preferredTables: ["3"], guestId: "gx", phone: "+34 600 000 001", notes: "n" }))).toMatchInlineSnapshot(`
      {
        "calls": [
          "openForm({"name":"Guest b1","phone":"+34 600 000 001","date":"2026-10-14","time":"20:00","size":2,"preference":"auto","notes":"n","status":"confirmed","customDur":null,"deposit":"20","voucherCode":"ABCD2345","manualTables":[],"preferredTables":["3"],"returnOf":null,"guestId":"gx","guestSeed":null})",
          "setEditId("b1")",
          "setError("")",
          "setSwapAffected(null)",
          "setShowHistory(false)",
          "setShowForm(true)",
        ],
        "pendingWaitlistAfter": null,
      }
    `);
  });
  it("a seated-shifted booking: its stored length is the custom one", () => {
    expect(runOpenEdit(bk("b1", { time: "19:30", scheduledTime: "19:00", duration: 60, originalDuration: 60, customDur: 60, status: "seated", tables: ["3"] }))).toMatchInlineSnapshot(`
      {
        "calls": [
          "openForm({"name":"Guest b1","phone":"","date":"2026-10-14","time":"19:30","size":2,"preference":"auto","notes":"","status":"seated","customDur":60,"deposit":"","voucherCode":"","manualTables":[],"preferredTables":[],"returnOf":null,"guestId":null,"guestSeed":null})",
          "setEditId("b1")",
          "setError("")",
          "setSwapAffected(null)",
          "setShowHistory(false)",
          "setShowForm(true)",
        ],
        "pendingWaitlistAfter": null,
      }
    `);
  });
  it("sparse legacy fields", () => {
    expect(runOpenEdit(bk("b1", { size: 6, duration: 120, phone: null, notes: undefined, deposit: 0, voucherCode: undefined, preferredTables: "x", guestId: undefined }))).toMatchInlineSnapshot(`
      {
        "calls": [
          "openForm({"name":"Guest b1","phone":"","date":"2026-10-14","time":"20:00","size":6,"preference":"auto","notes":"","status":"confirmed","customDur":null,"deposit":"","voucherCode":"","manualTables":[],"preferredTables":[],"returnOf":null,"guestId":null,"guestSeed":null})",
          "setEditId("b1")",
          "setError("")",
          "setSwapAffected(null)",
          "setShowHistory(false)",
          "setShowForm(true)",
        ],
        "pendingWaitlistAfter": null,
      }
    `);
  });
  it("without the permission to edit: nothing opens", () => {
    expect(runOpenEdit(bk("b1"), { refused: (cap) => cap === "bookingEdit" })).toMatchInlineSnapshot(`
      {
        "calls": [],
        "pendingWaitlistAfter": "w1",
      }
    `);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe("Seat — a walk-in", () => {
  it("two guests on table 3", () => {
    expect(runWalkin({ form: { size: 2, notes: "", tables: ["3"], time: "19:30", customDur: null } })).toMatchInlineSnapshot(`
      {
        "calls": [
          "saveBookings("<fn>")",
          "setShowWalkin(false)",
          "setViewDate("2026-10-07")",
        ],
        "guard": "dispatched",
        "writes": [
          {
            "replay": "same prev → recomputed; fresh prev → equal",
            "rows": {
              "muyfzww04xjv": "created {"id":"muyfzww04xjv","name":"Walk-in 1","phone":"","date":"2026-10-07","time":"19:30","scheduledTime":"19:30","size":2,"duration":90,"originalDuration":90,"preference":"auto","notes":"","status":"seated","tables":["3"],"customDur":null,"_manual":true,"_locked":true,"history":[{"at":"2026-10-07T18:30:00.000Z","by":"staff@mgt.test","action":"walk-in created"}]}",
            },
          },
        ],
      }
    `);
  });
  it("numbered after today's walk-ins, at the current time, with a typed length", () => {
    const bookings = [
      bk("w1", { date: TODAY, name: "Walk-in 1", tables: ["1A"], status: "completed" }),
      bk("w3", { date: TODAY, name: "Walk-in 3", tables: ["1B"], status: "completed" }),
      bk("w7", { date: PAST, name: "Walk-in 7", tables: ["2"], status: "completed" }),
    ];
    expect(runWalkin({ bookings, form: { size: "5", notes: "high chair", tables: ["7"], time: "", customDur: 100 } })).toMatchInlineSnapshot(`
      {
        "calls": [
          "saveBookings("<fn>")",
          "setShowWalkin(false)",
          "setViewDate("2026-10-07")",
        ],
        "guard": "dispatched",
        "writes": [
          {
            "replay": "same prev → recomputed; fresh prev → equal",
            "rows": {
              "muyfzww04xjv": "created {"id":"muyfzww04xjv","name":"Walk-in 4","phone":"","date":"2026-10-07","time":"19:30","scheduledTime":"19:30","size":5,"duration":100,"originalDuration":100,"preference":"auto","notes":"high chair","status":"seated","tables":["7"],"customDur":100,"_manual":true,"_locked":true,"history":[{"at":"2026-10-07T18:30:00.000Z","by":"staff@mgt.test","action":"walk-in created"}]}",
            },
          },
        ],
      }
    `);
  });
  it("no table chosen", () => {
    expect(runWalkin({ form: { size: 2, notes: "", tables: [], time: "19:30", customDur: null } })).toMatchInlineSnapshot(`
      {
        "calls": [
          "setWalkinError("Please assign tables first.")",
        ],
        "guard": "ready",
      }
    `);
  });
  it("after closing", () => {
    expect(runWalkin({ at: TODAY + "T22:30:00", form: { size: 2, notes: "", tables: ["3"], time: "", customDur: null } })).toMatchInlineSnapshot(`
      {
        "calls": [
          "setWalkinError("It's past closing — walk-ins can't be seated now.")",
        ],
        "guard": "ready",
      }
    `);
  });
  it("a second tap after the walk-in went out", () => {
    expect(runWalkin({ guard: submitGuard.DISPATCHED, form: { size: 2, notes: "", tables: ["3"], time: "19:30", customDur: null } })).toMatchInlineSnapshot(`
      {
        "calls": [],
        "guard": "dispatched",
      }
    `);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe("the weekly generator", () => {
  it("books the weeks after a rule's start", () => {
    expect(runGenerator({ rules: [weekly()] })).toMatchInlineSnapshot(`
      {
        "calls": [
          "saveBookings("<fn>", true)",
        ],
        "writes": [
          {
            "replay": "same prev → recomputed; fresh prev → equal",
            "rows": {
              "rwk_2026-10-14": "created {"id":"rwk_2026-10-14","name":"Weekly","phone":"+34 600 000 001","date":"2026-10-14","time":"20:00","scheduledTime":"20:00","size":2,"duration":90,"originalDuration":90,"preference":"auto","notes":"","status":"confirmed","tables":["1A"],"customDur":null,"deposit":0,"voucherCode":"","_manual":false,"_locked":false,"_conflict":false,"preferredTables":[],"returnOf":null,"recurringId":"wk","recurringDate":"2026-10-14","history":[{"at":"2026-10-07T18:30:00.000Z","by":"auto","action":"auto-created from weekly rule"}]}",
              "rwk_2026-10-21": "created {"id":"rwk_2026-10-21","name":"Weekly","phone":"+34 600 000 001","date":"2026-10-21","time":"20:00","scheduledTime":"20:00","size":2,"duration":90,"originalDuration":90,"preference":"auto","notes":"","status":"confirmed","tables":["1A"],"customDur":null,"deposit":0,"voucherCode":"","_manual":false,"_locked":false,"_conflict":false,"preferredTables":[],"returnOf":null,"recurringId":"wk","recurringDate":"2026-10-21","history":[{"at":"2026-10-07T18:30:00.000Z","by":"auto","action":"auto-created from weekly rule"}]}",
            },
          },
        ],
      }
    `);
  });
  it("skips a week that already has its booking, by id or by stamp", () => {
    const bookings = [
      bk("rwk_" + T, { recurringId: "wk", recurringDate: T, tables: ["1A"] }),
      bk("form1", { date: "2026-10-21", recurringId: "wk", recurringDate: "2026-10-21", tables: ["1A"] }),
    ];
    expect(runGenerator({ bookings, rules: [weekly({ startDate: PAST })] })).toMatchInlineSnapshot(`
      {
        "calls": [
          "saveBookings("<fn>", true)",
        ],
        "writes": [
          {
            "replay": "same prev → recomputed; fresh prev → equal",
            "rows": {
              "rwk_2026-10-07": "created {"id":"rwk_2026-10-07","name":"Weekly","phone":"+34 600 000 001","date":"2026-10-07","time":"20:00","scheduledTime":"20:00","size":2,"duration":90,"originalDuration":90,"preference":"auto","notes":"","status":"confirmed","tables":[],"customDur":null,"deposit":0,"voucherCode":"","_manual":false,"_locked":false,"_conflict":false,"preferredTables":[],"returnOf":null,"recurringId":"wk","recurringDate":"2026-10-07","history":[{"at":"2026-10-07T18:30:00.000Z","by":"auto","action":"auto-created from weekly rule"}]}",
            },
          },
        ],
      }
    `);
  });
  it("a big party with a zone and notes, on a full evening: written without a table", () => {
    expect(runGenerator({ bookings: fullDay(T, "20:00", true), horizonWeeks: 1, rules: [weekly({ size: 5, preference: "indoor", notes: "birthday", phone: "" })] })).toMatchInlineSnapshot(`
      {
        "calls": [
          "saveBookings("<fn>", true)",
        ],
        "writes": [
          {
            "replay": "same prev → recomputed; fresh prev → equal",
            "rows": {
              "rwk_2026-10-14": "created {"id":"rwk_2026-10-14","name":"Weekly","phone":"","date":"2026-10-14","time":"20:00","scheduledTime":"20:00","size":5,"duration":120,"originalDuration":120,"preference":"indoor","notes":"birthday","status":"confirmed","tables":[],"customDur":null,"deposit":0,"voucherCode":"","_manual":false,"_locked":false,"_conflict":true,"preferredTables":[],"returnOf":null,"recurringId":"wk","recurringDate":"2026-10-14","history":[{"at":"2026-10-07T18:30:00.000Z","by":"auto","action":"auto-created from weekly rule"}]}",
            },
          },
        ],
      }
    `);
  });
  it("writes nothing while disabled, resyncing or before the first load", () => {
    const rules = [weekly()];
    expect([
      runGenerator({ rules, env: { recurring: { v: 1, enabled: false, horizonWeeks: 2, rules } } }),
      runGenerator({ rules, env: { resyncing: true } }),
      runGenerator({ rules, env: { firstLoadCount: { current: null } } }),
    ]).toMatchInlineSnapshot(`
      [
        {
          "calls": [],
        },
        {
          "calls": [],
        },
        {
          "calls": [],
        },
      ]
    `);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// The three field lists in booking-logic.js, pinned by BEHAVIOUR: what a read
// keeps and in what order, which fields undo and the reconciliation compare,
// and the exact history sentence for each kind of change.
describe("the field lists", () => {
  it("sanitize: the shape of an empty row, in key order", () => {
    freeze(TODAY + "T19:30:00");
    expect(J(bookingLogic.sanitize({}, "k1"))).toMatchInlineSnapshot(`"{"id":"k1","name":"","phone":"","date":"","time":"13:00","scheduledTime":"13:00","size":2,"duration":90,"originalDuration":90,"preference":"auto","notes":"","status":"confirmed","tables":[],"customDur":null,"_manual":false,"_locked":false,"_conflict":false,"preferredTables":[],"returnOf":null,"history":[],"noShow":false,"deposit":0,"voucherCode":"","recurringId":null,"recurringDate":null,"anonymized":false,"guestId":null,"stayedMin":0,"updatedAt":0}"`);
  });
  it("sanitize: what it does to each field it is handed badly", () => {
    freeze(TODAY + "T19:30:00");
    expect(J(bookingLogic.sanitize({
      id: "b9", name: null, phone: undefined, date: null, time: "8pm", scheduledTime: "later",
      size: "abc", duration: "0", originalDuration: "x", preference: "", notes: null, status: "",
      tables: "3", customDur: 0, _manual: 1, _locked: "", _conflict: "yes", preferredTables: null,
      returnOf: "", history: "h", noShow: 1, deposit: "-12", voucherCode: "abcd-2345",
      recurringId: "", recurringDate: 0, anonymized: 1, guestId: "", stayedMin: "33", updatedAt: "7",
      baseUpdatedAt: 5, foo: "dropped",
    }))).toMatchInlineSnapshot(`"{"id":"b9","name":"","phone":"","date":"","time":"13:00","scheduledTime":"13:00","size":2,"duration":90,"originalDuration":90,"preference":"auto","notes":"","status":"confirmed","tables":[],"customDur":null,"_manual":true,"_locked":false,"_conflict":true,"preferredTables":[],"returnOf":null,"history":[],"noShow":true,"deposit":0,"voucherCode":"ABCD2345","recurringId":null,"recurringDate":null,"anonymized":true,"guestId":null,"stayedMin":33,"updatedAt":7}"`);
  });
  it("sanitize: a full row survives unchanged", () => {
    const b = bk("b1", { phone: "+34 600 000 001", tables: ["3"], deposit: 5, voucherCode: "ABCD2345", guestId: "g1", stayedMin: 40, history: [{ at: "x", by: "y", action: "z" }] });
    expect(J(bookingLogic.sanitize(b))).toBe(J(b));
  });
  it("which fields undo and the reconciliation compare", () => {
    const b = bk("b1", { tables: ["3"], preferredTables: ["3"] });
    const bump = (v) => (Array.isArray(v) ? v.concat(["X"]) : typeof v === "number" ? v + 1 : typeof v === "boolean" ? !v : v === null ? "X" : v + "X");
    const out = {};
    Object.keys(b).filter((k) => k !== "id").forEach((k) => {
      const after = Object.assign({}, b, { [k]: bump(b[k]) });
      const undo = bookingLogic.undoSnapshots([b], [after]).length > 0;
      const sig = bookingLogic.dayBookingsSig([b], T) !== bookingLogic.dayBookingsSig([after], T);
      out[k] = (undo ? "undo" : "-") + " " + (sig ? "sig" : "-");
    });
    expect(out).toMatchInlineSnapshot(`
      {
        "_conflict": "undo sig",
        "_locked": "undo sig",
        "_manual": "undo sig",
        "anonymized": "undo sig",
        "customDur": "undo sig",
        "date": "undo sig",
        "deposit": "undo sig",
        "duration": "undo sig",
        "guestId": "- -",
        "history": "- -",
        "name": "undo sig",
        "noShow": "undo sig",
        "notes": "undo sig",
        "originalDuration": "undo sig",
        "phone": "undo sig",
        "preference": "undo sig",
        "preferredTables": "undo sig",
        "recurringDate": "undo sig",
        "recurringId": "undo sig",
        "returnOf": "undo sig",
        "scheduledTime": "undo sig",
        "size": "undo sig",
        "status": "undo sig",
        "stayedMin": "- -",
        "tables": "undo sig",
        "time": "undo sig",
        "updatedAt": "- -",
        "voucherCode": "undo sig",
      }
    `);
  });
  it("diffBooking: each change alone, all of them together, and none", () => {
    const orig = bk("b1", { name: "Ana", phone: "+34 600 000 001", tables: ["3"], deposit: 10, voucherCode: "ABCD2345", preferredTables: ["3"], notes: "a" });
    const f = draftOf(orig);
    const one = {
      name: { name: "Ana María" }, size: { size: 3 }, time: { time: "20:30" }, date: { date: NEXT },
      preference: { preference: "indoor" }, phone: { phone: "+44 7700 900123" }, phoneCleared: { phone: "+34" },
      duration: { customDur: 120 }, status: { status: "seated" }, notes: { notes: "b" },
      deposit: { deposit: "12" }, voucher: { voucherCode: "WXYZ7890" }, voucherCleared: { voucherCode: "" },
      manual: { manualTables: ["4", "5A"] }, cleared: { _clearManual: true },
      preferred: { preferredTables: ["4"] }, preferredCleared: { preferredTables: [] },
    };
    const out = {};
    Object.keys(one).forEach((k) => {
      const d = Object.assign({}, f, one[k]);
      out[k] = bookingLogic.diffBooking(orig, d, Number(d.size) || 2, "+34");
    });
    const all = Object.assign({}, f, ...Object.keys(one).filter((k) => !/Cleared$/.test(k)).map((k) => one[k]));
    out.all = bookingLogic.diffBooking(orig, all, 3, "+34");
    out.none = bookingLogic.diffBooking(orig, f, 2, "+34");
    expect(out).toMatchInlineSnapshot(`
      {
        "all": "name Ana→Ana María, size 2→3, time 20:00→20:30, date 2026-10-14→2026-10-15, pref auto→indoor, phone +34 600 000 001→+44 7700 900123, duration 90→120min, status confirmed→seated, notes updated, deposit 10→12 €, voucher ABCD-2345→WXYZ-7890, tables manually set: 4, 5A, manual assignment cleared, preferred tables: 4",
        "cleared": "manual assignment cleared",
        "date": "date 2026-10-14→2026-10-15",
        "deposit": "deposit 10→12 €",
        "duration": "duration 90→120min",
        "manual": "tables manually set: 4, 5A",
        "name": "name Ana→Ana María",
        "none": "saved (no field changes)",
        "notes": "notes updated",
        "phone": "phone +34 600 000 001→+44 7700 900123",
        "phoneCleared": "phone +34 600 000 001→none",
        "preference": "pref auto→indoor",
        "preferred": "preferred tables: 4",
        "preferredCleared": "preferred tables: cleared",
        "size": "size 2→3",
        "status": "status confirmed→seated",
        "time": "time 20:00→20:30",
        "voucher": "voucher ABCD-2345→WXYZ-7890",
        "voucherCleared": "voucher ABCD-2345→none",
      }
    `);
  });
});
