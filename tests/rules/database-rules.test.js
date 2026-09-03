// tests/rules/database-rules.test.js
//
// The FIRST test in this repo that exercises `database.rules.json` itself.
//
// Until now the rules were protected by reading them. Everything else the app
// asserts about write safety — the per-booking CAS that closed the 2026-07-05
// overwrite incident, the twelve revision pairs, the `auth != null` boundary —
// was verified by argument, in prose, in CLAUDE.md and database.rules.README.md.
// This file runs the real rules file, unmodified, inside a local emulator.
//
// THE ENVIRONMENT. There are three, and this is the third:
//
//   npm run dev        → DEV Firebase    → manual app testing
//   production build   → PROD Firebase   → never reached from a dev machine
//   npm run test:rules → LOCAL EMULATOR  → here
//
// Nothing in this file names a real project. The project id is
// `demo-mgt-bookings`, and Firebase treats a `demo-` prefix as emulator-only —
// it can never resolve to a real backend, so a misconfigured run fails rather
// than quietly reaching production. The beforeAll below additionally REFUSES to
// start unless FIREBASE_DATABASE_EMULATOR_HOST is set, which only
// `firebase emulators:exec` sets. Both belts are deliberate: the failure mode
// this guards against is silent, and would be catastrophic exactly once.
//
// SOME TESTS HERE ASSERT THAT SOMETHING IS *ALLOWED* THAT YOU MIGHT WISH WERE
// NOT. They are marked `PROBE:` and they are findings, not approvals — the rules
// record what the server actually permits so the crash-test report can rank it.
// Do not "fix" a PROBE by weakening the assertion; fix the rules, then the
// assertion, and say so in REFACTOR_LOG.
import { readFileSync } from "node:fs";
// Explicitly imported rather than taken off the global: eslint.config.js
// declares only browser globals, and every other test here reaches for
// node builtins the same way (see tests/csp.test.js).
import process from "node:process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  describe, it, expect, beforeAll, afterAll, beforeEach,
} from "vitest";
import {
  initializeTestEnvironment, assertSucceeds, assertFails,
} from "@firebase/rules-unit-testing";
// v17.16.1: the app's OWN sanitiser, so the shape-validation tests below can
// assert against what the app really writes rather than against a fixture that
// merely looks like it. A rules file is deployed BY HAND to the production
// console; a rule that is too strict is not a failing test, it is staff unable
// to save a booking, and a fixture cannot find that.
import { sanitize } from "../../src/lib/booking-logic.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const RULES_PATH = resolve(HERE, "../../database.rules.json");
const PROJECT_ID = "demo-mgt-bookings";   // `demo-` = emulator-only, by Firebase contract

let testEnv;

beforeAll(async () => {
  // Fail LOUDLY rather than falling through to a real project. Without the
  // emulator host the SDK would resolve the databaseURL from the project id and
  // attempt a network connection; `demo-` makes that fail too, but relying on
  // the second guard to cover the first is how one of them quietly rots.
  const host = process.env.FIREBASE_DATABASE_EMULATOR_HOST;
  if (!host) {
    throw new Error(
      "FIREBASE_DATABASE_EMULATOR_HOST is not set.\n" +
      "These tests must run against the local Firebase emulator and will not " +
      "run anywhere else. Use:  npm run test:rules\n" +
      "(that wraps them in `firebase emulators:exec --only database " +
      "--project " + PROJECT_ID + "`, which sets this variable.)"
    );
  }
  // Written straight to stdout, NOT console.log — vitest's reporter intercepts
  // console output from a beforeAll and drops it, so the first version of this
  // line printed nothing at all. Evidence that can be silently swallowed is not
  // evidence; the real proof is the assertion in the first test below.
  process.stdout.write(
    "[rules] emulator host: " + host + " · project: " + PROJECT_ID + "\n"
  );

  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    // The REAL rules file, read off disk. Not a copy, not a subset — if this
    // file and production disagree, the tests are worthless.
    database: { rules: readFileSync(RULES_PATH, "utf8") },
  });
});

afterAll(async () => { if (testEnv) await testEnv.cleanup(); });
beforeEach(async () => { await testEnv.clearDatabase(); });

// ── helpers ─────────────────────────────────────────────────────────────────

const anon   = () => testEnv.unauthenticatedContext().database();
const staff  = (uid = "staff-a") => testEnv.authenticatedContext(uid).database();
const seed   = (fn) => testEnv.withSecurityRulesDisabled((c) => fn(c.database()));

// Shaped like what `sanitize` in booking-logic.js produces, plus the two write
// stamps usePersistence's `stampForWrite` adds (`updatedAt` / `baseUpdatedAt`).
const booking = (o = {}) => Object.assign({
  id: "b1", name: "Pau Estévez", phone: "+34600111222",
  date: "2026-09-01", time: "20:00", size: 4, duration: 90,
  preference: "auto", notes: "", status: "confirmed", tables: ["3"],
  updatedAt: 1000, baseUpdatedAt: 0,
}, o);

// The app never writes a booking any other way: a multi-path update under
// /bookings, one child per changed booking (usePersistence's diff-write).
const writeBooking = (db, id, value) => db.ref("bookings").update({ [id]: value });

// And it never writes a whole-node collection any other way either:
// revGuard.writeWithRev's atomic { node, nodeRev: base+1 } at the ROOT.
const writeWithRev = (db, path, value, rev) =>
  db.ref().update({ [path]: value, [path + "Rev"]: rev });

// ── 0. Where am I actually running? ─────────────────────────────────────────
// An assertion rather than a log, because this is the one fact the whole file
// depends on and a log line can be dropped by a reporter without anyone
// noticing. If this ever fails, stop and find out what it connected to.

describe("the rig itself", () => {
  it("is pointed at a LOOPBACK emulator and a demo project", () => {
    const host = process.env.FIREBASE_DATABASE_EMULATOR_HOST;
    expect(host).toMatch(/^(127\.0\.0\.1|localhost|\[::1\]):\d+$/);
    expect(testEnv.projectId).toBe(PROJECT_ID);
    expect(testEnv.projectId.startsWith("demo-")).toBe(true);
    // Neither real project may appear anywhere in the connection.
    expect(host).not.toMatch(/firebasedatabase\.app|megustastu/);
  });

  it("loaded the REAL rules file, not a copy", () => {
    const raw = readFileSync(RULES_PATH, "utf8");
    const parsed = JSON.parse(raw);
    // Spot-check the structures the rest of this file is about, so a truncated
    // or reshaped rules file fails here rather than as 60 confusing downstream
    // failures.
    expect(parsed.rules[".read"]).toBe("auth != null");
    expect(parsed.rules.bookings.$bid[".validate"]).toContain("baseUpdatedAt");
    // v17.16.7: the root `.write` grant is GONE, and that single absence is
    // what makes every per-path grant below reachable at all — RTDB write
    // permission cascades from the root and cannot be revoked lower down, so
    // while this key exists no child rule can deny anything (CT-2A-04/06).
    // Asserted as an absence because that is the whole of the change; a
    // re-added root grant would leave every other test in this file green.
    expect(parsed.rules[".write"]).toBeUndefined();
    expect(parsed.rules.bookings[".write"]).toBeUndefined();
    expect(parsed.rules.bookings.$bid[".write"]).toBe("auth != null");
    // The rev CAS moved from `.validate` to `.write`, which is what extends it
    // over DELETES: `.validate` is not evaluated when newData does not exist.
    expect(parsed.rules.tableBlocksRev[".validate"]).toBeUndefined();
    expect(parsed.rules.tableBlocksRev[".write"]).toContain("data.val() + 1");
  });
});

// ── 1–3. The auth boundary ──────────────────────────────────────────────────
// `.read` is "auth != null" at the root and nothing below re-grants it, so one
// signed-in account can read the whole database — the single-restaurant trust
// model, unchanged.
//
// WRITE is no longer symmetrical with it (v17.16.7). The root grant is gone and
// each writable path carries its own, because RTDB write permission CASCADES
// from wherever it is granted and cannot be revoked lower down — so a root
// grant made `/bookings` deletable in one call (CT-2A-04) and made every
// whole-node `remove()` bypass its rev CAS (CT-2A-06), and no rule added below
// could have denied either. `auth != null` is still the only identity test
// anywhere; what changed is WHERE it is asked, not what it asks.

describe("the auth boundary", () => {
  beforeEach(async () => {
    await seed(async (db) => {
      await db.ref("bookings/b1").set(booking());
      await db.ref("settings/general").set({ v: 1, restaurantName: "Me Gustas Tú" });
    });
  });

  it("denies an unauthenticated READ of bookings", async () => {
    await assertFails(anon().ref("bookings").once("value"));
  });

  it("denies an unauthenticated READ of one booking", async () => {
    await assertFails(anon().ref("bookings/b1").once("value"));
  });

  it("denies an unauthenticated READ of settings", async () => {
    await assertFails(anon().ref("settings/general").once("value"));
  });

  it("denies an unauthenticated WRITE anywhere", async () => {
    await assertFails(anon().ref("bookings/b2").set(booking({ id: "b2" })));
    await assertFails(anon().ref("settings/general").set({ v: 2 }));
    await assertFails(anon().ref("anything/at/all").set(1));
  });

  it("denies an unauthenticated DELETE", async () => {
    await assertFails(anon().ref("bookings/b1").remove());
  });

  it("allows an authenticated READ of every collection", async () => {
    const db = staff();
    await assertSucceeds(db.ref("bookings").once("value"));
    await assertSucceeds(db.ref("settings").once("value"));
    await assertSucceeds(db.ref("waitlist").once("value"));
    await assertSucceeds(db.ref("/").once("value"));
  });
});

// ── 4–6. The per-booking compare-and-swap ───────────────────────────────────
// The rule that closed the 2026-07-05 incident: a sleeping laptop woke and its
// stale snapshot overwrote a night of tablet work, because the v15.5.0 rule
// only required `updatedAt` to be GREATER than stored — which a stale device
// always satisfies, since it stamps with its current wall clock.
//
// v16.0.0 added `baseUpdatedAt`: prove you were looking at the version you are
// overwriting. That is the difference between last-writer-wins and a real CAS,
// and these are the cases that tell them apart.

describe("bookings — the per-$id CAS", () => {
  it("accepts a create carrying a numeric updatedAt", async () => {
    await assertSucceeds(writeBooking(staff(), "b1", booking()));
  });

  it("rejects a create with NO updatedAt", async () => {
    const b = booking(); delete b.updatedAt;
    await assertFails(writeBooking(staff(), "b1", b));
  });

  it("rejects a create whose updatedAt is a STRING", async () => {
    await assertFails(writeBooking(staff(), "b1", booking({ updatedAt: "1000" })));
  });

  it("rejects a create whose updatedAt is a boolean", async () => {
    await assertFails(writeBooking(staff(), "b1", booking({ updatedAt: true })));
  });

  describe("against a stored booking at updatedAt = 5000", () => {
    beforeEach(async () => {
      await seed((db) => db.ref("bookings/b1").set(booking({ updatedAt: 5000 })));
    });

    it("accepts a newer write that names the correct base", async () => {
      await assertSucceeds(writeBooking(staff(), "b1",
        booking({ size: 6, updatedAt: 6000, baseUpdatedAt: 5000 })));
    });

    it("REJECTS a newer write naming the WRONG base — the stale-writer case", async () => {
      // This is the whole point. The clock is newer; the device is not.
      await assertFails(writeBooking(staff(), "b1",
        booking({ size: 2, updatedAt: 9999, baseUpdatedAt: 1000 })));
    });

    it("rejects a newer write with NO base at all", async () => {
      const b = booking({ updatedAt: 9999 }); delete b.baseUpdatedAt;
      await assertFails(writeBooking(staff(), "b1", b));
    });

    it("rejects a write whose updatedAt EQUALS the stored one", async () => {
      await assertFails(writeBooking(staff(), "b1",
        booking({ updatedAt: 5000, baseUpdatedAt: 5000 })));
    });

    it("rejects a write whose updatedAt is OLDER", async () => {
      await assertFails(writeBooking(staff(), "b1",
        booking({ updatedAt: 4000, baseUpdatedAt: 5000 })));
    });

    it("allows a DELETE unconditionally — a multi-path null carries no base", async () => {
      await assertSucceeds(writeBooking(staff(), "b1", null));
    });

    it("allows a delete even from a device holding a stale snapshot", async () => {
      // Documented and deliberate (`deletes stay unconditional`), but it means
      // delete is the one booking operation with no staleness protection.
      await assertSucceeds(staff().ref("bookings/b1").remove());
    });

    it("rejects a whole multi-path patch when ONE child is stale", async () => {
      // Two devices, disjoint paths, one multi-path update: RTDB applies an
      // update() atomically, so ONE bad child rejects the WHOLE patch.
      const db = staff();
      await assertFails(db.ref("bookings").update({
        b1: booking({ updatedAt: 9999, baseUpdatedAt: 1 }),   // stale
        b2: booking({ id: "b2", updatedAt: 9999, baseUpdatedAt: 0 }), // fine alone
      }));
      const after = await seedRead("bookings/b2");
      expect(after).toBeNull();   // the good half did NOT land
    });
  });
});

// Read a path with rules disabled — for asserting on server state after a
// rejection, which is the half a `assertFails` alone does not prove.
async function seedRead(path) {
  let out;
  await testEnv.withSecurityRulesDisabled(async (c) => {
    out = (await c.database().ref(path).once("value")).val();
  });
  return out === undefined ? null : out;
}

// ── The whole-node revision CAS ─────────────────────────────────────────────
// Twelve collections share one pattern: a sibling `<name>Rev` integer, written
// atomically with the node, that the rules require to be EXACTLY stored + 1.

describe("tableBlocks — the representative rev pair", () => {
  const BLOCK = [{ id: "k1", table: "3", date: "2026-09-01", from: "20:00", to: "21:00", reason: "" }];

  it("accepts the first write at rev 1", async () => {
    await assertSucceeds(writeWithRev(staff(), "tableBlocks", BLOCK, 1));
  });

  it("rejects a first write at rev 0", async () => {
    await assertFails(writeWithRev(staff(), "tableBlocks", BLOCK, 0));
  });

  it("rejects a first write at rev 2", async () => {
    await assertFails(writeWithRev(staff(), "tableBlocks", BLOCK, 2));
  });

  describe("against a stored rev of 5", () => {
    beforeEach(async () => {
      await seed((db) => db.ref().update({ tableBlocks: BLOCK, tableBlocksRev: 5 }));
    });

    it("accepts rev 6", async () => {
      await assertSucceeds(writeWithRev(staff(), "tableBlocks", BLOCK, 6));
    });

    it("rejects a REPEATED rev (5)", async () => {
      await assertFails(writeWithRev(staff(), "tableBlocks", BLOCK, 5));
    });

    it("rejects a SKIPPED rev (7)", async () => {
      await assertFails(writeWithRev(staff(), "tableBlocks", BLOCK, 7));
    });

    it("rejects a LOWER rev (2)", async () => {
      await assertFails(writeWithRev(staff(), "tableBlocks", BLOCK, 2));
    });

    it("rejects a non-numeric rev", async () => {
      await assertFails(writeWithRev(staff(), "tableBlocks", BLOCK, "6"));
    });

    it("rejects the node written ALONE, with no rev bump", async () => {
      // The stale-device case: rev still 5, so 5 !== 5+1 and the write dies.
      await assertFails(staff().ref("tableBlocks").set(BLOCK));
    });

    it("PROBE: the rev may be bumped ALONE, with no node write", async () => {
      // The rev's own rule only asks for stored + 1; it does not require the
      // node to move with it. Benign in practice — every client re-anchors its
      // rev ref from the `onValue` echo (revGuard.attachRev) — but it means a
      // revision can be consumed without any data changing, so the rev is a
      // sequence number, not a content hash. Recorded, not a defect on its own.
      await assertSucceeds(staff().ref("tableBlocksRev").set(6));
    });

    it("simultaneous writers: the second at the same base is rejected", async () => {
      // Two devices both saw rev 5. Both compute 6. RTDB serialises them.
      await assertSucceeds(writeWithRev(staff("device-a"), "tableBlocks", BLOCK, 6));
      await assertFails(writeWithRev(staff("device-b"), "tableBlocks", BLOCK, 6));
    });
  });
});

// Every `<name>Rev` in the rules file, found by walking it — NOT a list typed
// out here. A hand-written list is the defect CLAUDE.md's Gotchas table already
// names twice: the set of things and the record of the set drift, and the
// missing entry is invisible. The rules deploy is a MANUAL console step, so
// "the app writes a rev nobody enforces" is a live failure mode; this makes the
// sweep grow on its own when a pair is added.
function revPairsIn(rules) {
  const out = [];
  (function walk(node, path) {
    for (const k of Object.keys(node)) {
      if (k.startsWith(".")) continue;
      const p = path ? path + "/" + k : k;
      if (k.endsWith("Rev")) out.push(p.slice(0, -3));
      else if (node[k] && typeof node[k] === "object") walk(node[k], p);
    }
  })(rules, "");
  return out;
}

describe("every rev pair in the rules is enforced", () => {
  const RULES = JSON.parse(readFileSync(RULES_PATH, "utf8")).rules;
  // `$uid` is a wildcard in the rules; any uid exercises the same rule.
  const PAIRS = revPairsIn(RULES).map((p) => p.replace("$uid", "staff-a"));

  it("found every pair — a drop to zero would silently pass the loop below", () => {
    // Without this, a walker that returns [] makes the whole sweep vacuous and
    // still reports green. Twelve as of v17.15.7; the assertion is a floor, so
    // adding a pair does not need this number edited.
    expect(PAIRS.length).toBeGreaterThanOrEqual(12);
    // `bookings` must NOT appear: it is guarded per-child by the updatedAt /
    // baseUpdatedAt CAS, not by a whole-node rev. If it ever shows up here the
    // walker has started matching something it should not.
    expect(PAIRS).not.toContain("bookings");
  });

  for (const path of PAIRS) {
    it(`${path} — accepts rev 1, rejects rev 2 on an empty node`, async () => {
      await assertFails(writeWithRev(staff(), path, { v: 1 }, 2));
      await assertSucceeds(writeWithRev(staff(), path, { v: 1 }, 1));
    });

    it(`${path} — rejects a write that does not bump its rev`, async () => {
      await seed((db) => db.ref().update({ [path]: { v: 1 }, [path + "Rev"]: 1 }));
      await assertFails(staff().ref(path).set({ v: 2 }));
    });
  }
});

// ── FIXED v17.16.1 — resurrection (crash-test spec §5, Scenario D) ──────────
// "Client A deletes X. Client B edits X from stale state. Expected: deletion
// must not unexpectedly resurrect X." It DID, until v17.16.1 (CT-2A-01).
//
// The rule reads
//   !newData.exists() || (hasChild('updatedAt') && isNumber(...) &&
//                         (!data.exists() || <the CAS>))
// and the `!data.exists()` disjunct is the hole: once the booking is gone,
// the CAS branch is never reached, so ANY write carrying a numeric updatedAt
// recreates the node — including one whose `baseUpdatedAt` names a version that
// was deleted, which is precisely what an offline device's queued edit carries.
//
// THE FIX: the create branch now requires `baseUpdatedAt === 0`, which is
// exactly what `stampForWrite` writes when it has no `old` — i.e. a genuine
// create. A stale offline edit carries the DELETED version's stamp instead, so
// it no longer satisfies the create branch either.
//
// These tests were `PROBE:`s pinning the defect. They were updated DELIBERATELY
// when the rules changed — the assertions were inverted, never weakened — which
// is what the PROBE convention exists to force.

describe("a deleted booking STAYS deleted (v17.16.1)", () => {
  it("a stale queued write can NO LONGER recreate a booking another device deleted", async () => {
    await seed((db) => db.ref("bookings/b1").set(booking({ updatedAt: 5000 })));

    // Device A cancels the booking. Deletes are unconditional by design.
    await assertSucceeds(staff("device-a").ref("bookings").update({ b1: null }));
    expect(await seedRead("bookings/b1")).toBeNull();

    // Device B was offline and never saw the delete. Its queued edit names the
    // base it last saw — a version that no longer exists. Before v17.16.1 this
    // SUCCEEDED and the booking came back holding its old table.
    await assertFails(staff("device-b").ref("bookings").update({
      b1: booking({ size: 8, updatedAt: 6000, baseUpdatedAt: 5000 }),
    }));

    expect(await seedRead("bookings/b1")).toBeNull();   // it stays deleted
  });

  it("a write naming a base that never existed is refused too", async () => {
    await seed((db) => db.ref("bookings/b1").set(booking({ updatedAt: 5000 })));
    await assertSucceeds(staff().ref("bookings/b1").remove());
    // The create branch checks baseUpdatedAt now; only 0 means "a real create".
    await assertFails(writeBooking(staff(), "b1",
      booking({ updatedAt: 1, baseUpdatedAt: 999999 })));
    expect(await seedRead("bookings/b1")).toBeNull();
  });

  it("a GENUINE create of the same id still works — the fix must not block re-use", async () => {
    // Staff cancel a booking and then take a new one that happens to reuse the
    // id (or an offline device creates one fresh). `stampForWrite` writes
    // baseUpdatedAt 0 when it has no `old`, which is the create branch.
    await seed((db) => db.ref("bookings/b1").set(booking({ updatedAt: 5000 })));
    await assertSucceeds(staff().ref("bookings/b1").remove());
    await assertSucceeds(writeBooking(staff(), "b1",
      booking({ name: "A new party", updatedAt: 7000, baseUpdatedAt: 0 })));
    expect(await seedRead("bookings/b1")).not.toBeNull();
  });

  it("the same stale write is REJECTED while the booking still exists", async () => {
    // The contrast that isolates the cause: identical write, one difference —
    // whether the target was deleted first.
    await seed((db) => db.ref("bookings/b1").set(booking({ updatedAt: 5000 })));
    await assertFails(staff("device-b").ref("bookings").update({
      b1: booking({ size: 8, updatedAt: 6000, baseUpdatedAt: 4000 }),
    }));
  });
});

// ── PROBES ──────────────────────────────────────────────────────────────────
// Adversarial. Each records what the server ACTUALLY does. A green test here
// does not mean "safe" — read the comment.

// ── FIXED v17.16.7 — the root `.write` grant (CT-2A-04, CT-2A-06) ───────────
// Both of these were `PROBE:`s. Their assertions were INVERTED when the rules
// changed, never weakened — the same deliberate update the v17.16.1 group above
// records, and what the PROBE convention exists to force.
//
// One structural change closed both, and it is a DELETION: the root
// `".write": "auth != null"` is gone. Nothing could be added below it, because
// RTDB write permission cascades from wherever it is granted and cannot be
// revoked deeper — measured against this emulator before the fix, a child
// `".write": false` on `bookings` did not deny the delete.
//
// So `/bookings` now carries no `.write` and `/bookings/$bid` carries it
// instead (the app only ever writes children — the diff-write's multi-path
// update), and each rev-paired node carries the CAS in `.write` rather than in
// `.validate`, which is what extends it over deletes.

describe("whole-node deletion is refused (v17.16.7)", () => {
  it("the ENTIRE bookings node canNOT be deleted in one call", async () => {
    await seed((db) => db.ref("bookings").set({
      b1: booking(), b2: booking({ id: "b2" }), b3: booking({ id: "b3" }),
    }));
    await assertFails(staff().ref("bookings").remove());
    expect(Object.keys(await seedRead("bookings"))).toEqual(["b1", "b2", "b3"]);
  });

  it("the bookings node canNOT be REPLACED wholesale either", async () => {
    // Replacing is the same capability wearing a different verb: a `set` that
    // names one booking drops every other one, and each child it DOES name can
    // satisfy `$bid`'s CAS because read is granted. Denying the delete without
    // denying this would have closed the reproduction and not the finding.
    await seed((db) => db.ref("bookings").set({ b1: booking(), b2: booking({ id: "b2" }) }));
    await assertFails(staff().ref("bookings").set({ b1: booking({ updatedAt: 9000, baseUpdatedAt: 1000 }) }));
  });

  it("deleting ONE booking still works", async () => {
    // The capability that had to survive. `$bid` grants the write and
    // `.validate` is skipped for a delete, exactly as before.
    await seed((db) => db.ref("bookings").set({ b1: booking(), b2: booking({ id: "b2" }) }));
    await assertSucceeds(staff().ref("bookings").update({ b1: null }));
    expect(Object.keys(await seedRead("bookings"))).toEqual(["b2"]);
  });

  it("tableBlocks canNOT be deleted without touching its rev", async () => {
    // revGuard.js's header used to claim the rev child's rule enforced +1 even
    // for a wipe. True of the APP's write path, which always sends both keys;
    // false of the RULES, because `.validate` is not evaluated when newData
    // does not exist. Putting the same predicate in `.write` is what fixes it —
    // `.write` IS evaluated for a delete.
    await seed((db) => db.ref().update({ tableBlocks: [{ id: "k1" }], tableBlocksRev: 5 }));
    await assertFails(staff().ref("tableBlocks").remove());
    expect(await seedRead("tableBlocks")).not.toBeNull();
    expect(await seedRead("tableBlocksRev")).toBe(5);
  });

  it("a rev sibling canNOT be deleted on its own either", async () => {
    // The mirror image, and it needs the same mechanism: a bare `remove()` of
    // the rev would otherwise reset the sequence and let a stale writer back in
    // at rev 1.
    await seed((db) => db.ref().update({ tableBlocks: [{ id: "k1" }], tableBlocksRev: 5 }));
    await assertFails(staff().ref("tableBlocksRev").remove());
    expect(await seedRead("tableBlocksRev")).toBe(5);
  });

  it("the app's own wipe (node + rev, atomically) is STILL accepted", async () => {
    // The capability the fix must not cost: emptying every block is an ordinary
    // thing to do, and RTDB stores an empty collection as a node delete. It
    // passes because the rev moves in the SAME update, which is the one thing
    // that distinguishes it from the bare remove above.
    await seed((db) => db.ref().update({ tableBlocks: [{ id: "k1" }], tableBlocksRev: 5 }));
    await assertSucceeds(writeWithRev(staff(), "tableBlocks", null, 6));
  });

  it("every rev-paired node refuses a bare remove of the node AND of its rev", async () => {
    // The sweep, over the walker's own list rather than a typed one — the same
    // reason `revPairsIn` exists above. Fourteen pairs as of v17.16.8, two
    // assertions each: a pair added to the rules is covered here without this
    // test being edited, which is why the floor below is `>=` and not `===`.
    const PAIRS = revPairsIn(JSON.parse(readFileSync(RULES_PATH, "utf8")).rules)
      .map((p) => p.replace("$uid", "staff-a"));
    expect(PAIRS.length).toBeGreaterThanOrEqual(12);
    for (const path of PAIRS) {
      await seed((db) => db.ref().update({ [path]: { v: 1 }, [path + "Rev"]: 1 }));
      await assertFails(staff().ref(path).remove());
      await assertFails(staff().ref(path + "Rev").remove());
    }
  });

  it("a deep write that skips the rev is refused too", async () => {
    // Not in either finding, and closed by the same change. Ancestor `.validate`
    // rules are NOT re-evaluated for a write landing below them, so under the
    // root grant `tableBlocks/0/from` could be rewritten with the rev untouched.
    // `.write` at `tableBlocks` IS consulted for a descendant write, so the CAS
    // now covers it.
    await seed((db) => db.ref().update({
      tableBlocks: [{ id: "k1", from: "20:00", to: "21:00" }], tableBlocksRev: 5,
    }));
    await assertFails(staff().ref("tableBlocks/0/from").set("09:00"));
    expect(await seedRead("tableBlocks/0/from")).toBe("20:00");
  });
});

describe("the paths that still have to be writable (v17.16.7)", () => {
  // Removing the root grant makes every ungranted path unwritable, which is the
  // hazard the ROADMAP entry named and the reason this group exists: `presence`
  // failed immediately in the pre-fix probe, and it is the ONE node documented
  // as deliberately having no rules of its own (ephemeral, per-connection,
  // exempt from the CAS rule — CLAUDE.md). A missing grant here is not a
  // subtle bug; it is the connection popover silently never listing a device.

  it("presence: register, heartbeat, and prune another device's child", async () => {
    await assertSucceeds(staff().ref("presence/k1")
      .set({ email: "a@b.c", ua: "iPad", since: 1, lastSeen: 1 }));
    await assertSucceeds(staff().ref("presence/k1")
      .update({ email: "a@b.c", ua: "iPad", since: 1, lastSeen: 2 }));
    await seed((db) => db.ref("presence/k2").set({ email: "x@y.z", ua: "Mac", since: 1, lastSeen: 1 }));
    await assertSucceeds(staff().ref("presence/k2").remove());
  });

  it("the legacy array→keyed migration, in the shape the app now writes it", async () => {
    // usePersistence's one-time v15.5.0 conversion. It used to be a whole-node
    // `set`, which is the exact capability CT-2A-04 is about — so it could not
    // be excepted, and became a multi-path update of CHILDREN instead. Both
    // sides are pinned here, because "the new form works" is only half of it:
    // if the old form were still permitted the finding would still be open.
    await seed((db) => db.ref("bookings").set([booking({ id: "b1" })]));
    await assertFails(staff().ref("bookings")
      .set({ b1: booking({ updatedAt: 5000, baseUpdatedAt: 0 }) }));
    await assertSucceeds(staff().ref("bookings")
      .update({ 0: null, b1: booking({ updatedAt: 5000, baseUpdatedAt: 0 }) }));
    expect(Object.keys(await seedRead("bookings"))).toEqual(["b1"]);
  });

  it("every write shape the app actually performs still succeeds", async () => {
    // Enumerated from the source, not guessed: the four call sites that write
    // anything at all are usePersistence.js (the bookings diff-write and the
    // legacy migration), revGuard.js (all twelve rev pairs) and usePresence.js.
    // TWELVE is right here and FOURTEEN is right in the sweep above, and the
    // difference is the point: this group is about what THIS branch's app
    // writes, and the two v17.16.8 pairs (templatesRev, whatsappRev) are
    // written by the `wa-sandbox` branch. Do not "correct" one to match the
    // other — they are counting different things.
    await assertSucceeds(writeBooking(staff(), "b1", booking()));
    await assertSucceeds(writeWithRev(staff(), "tableBlocks", [{ id: "k1" }], 1));
    await assertSucceeds(writeWithRev(staff(), "settings/layout", { tables: [] }, 1));
    await assertSucceeds(writeWithRev(staff(), "settings/users/staff-a/prefs", { theme: "dark" }, 1));
  });
});

// ── The WhatsApp sandbox nodes (v17.16.8) ───────────────────────────────────
// Four paths the `wa-sandbox` branch writes and main does not. They had no
// rules of their own and relied entirely on the root `.write` grant, so
// v17.16.7 left every WhatsApp write denied wherever these rules are
// published. The grants below are shaped by TWO measurements, both in the
// sandbox source rather than inferred:
//
//   1. `api/_lib/rtdb.js` writes `conversations` and `messages` through
//      firebase-admin, which BYPASSES rules entirely. A CAS on those two would
//      therefore constrain the browser and not the backend doing most of the
//      writing — a pin that looks like a guarantee while guaranteeing nothing.
//      They get a per-child grant in the `presence` shape and no CAS, which is
//      a deliberate, documented deviation from the Rule of law.
//   2. `templates` and `settings/whatsapp` have exactly one writer each, the
//      client, so both get a real rev pair. `settings/whatsapp` already used
//      `writeWithRev`; `templates` was a bare whole-node `set()` and the
//      sandbox client is hardened onto `writeWithRev` alongside this.
//
// The grant is at `$phoneKey`, NOT at `$phoneKey/$mid`: write permission
// cascades down, so one grant covers the per-message writes and the "delete
// this conversation" call, while the whole-node wipe stays denied.
const PHONE = "+34600111222";

describe("the WhatsApp sandbox nodes (v17.16.8)", () => {
  it("conversations: one conversation can be created, patched and deleted", async () => {
    await assertSucceeds(staff().ref("conversations/" + PHONE)
      .set({ phone: PHONE, unread: true, archived: false }));
    await assertSucceeds(staff().ref("conversations/" + PHONE)
      .update({ unread: false }));
    await assertSucceeds(staff().ref("conversations/" + PHONE).remove());
  });

  it("messages: a message writes, patches, and a conversation's messages delete", async () => {
    // The $mid write is what pins the cascade: the grant is one level above it.
    await assertSucceeds(staff().ref("messages/" + PHONE + "/m1")
      .set({ id: "m1", dir: "in", text: "hola" }));
    await assertSucceeds(staff().ref("messages/" + PHONE + "/m1")
      .update({ status: "read" }));
    await assertSucceeds(staff().ref("messages/" + PHONE).remove());
  });

  it("the ENTIRE conversations node canNOT be wiped in one call", async () => {
    // `clearAllWaData()` did exactly this. It is the CT-2A-06 capability, so it
    // stays denied and the sandbox client deletes per conversation instead.
    await seed((db) => db.ref("conversations").set({ [PHONE]: { phone: PHONE } }));
    await assertFails(staff().ref("conversations").remove());
    expect(await seedRead("conversations")).not.toBeNull();
  });

  it("the ENTIRE messages node canNOT be wiped in one call", async () => {
    await seed((db) => db.ref("messages").set({ [PHONE]: { m1: { id: "m1" } } }));
    await assertFails(staff().ref("messages").remove());
    expect(await seedRead("messages")).not.toBeNull();
  });

  it("neither node can be REPLACED wholesale either", async () => {
    // The gap the bookings group already names: "replacing is the same
    // capability wearing a different verb". A `set()` naming one conversation
    // drops every other one, and each child it DOES name satisfies $phoneKey.
    // Denying the wipe without denying this would close the reproduction and
    // not the finding — so both verbs are pinned for these two nodes too.
    await seed((db) => db.ref("conversations").set({ [PHONE]: { phone: PHONE } }));
    await seed((db) => db.ref("messages").set({ [PHONE]: { m1: { id: "m1" } } }));
    await assertFails(staff().ref("conversations").set({ other: { phone: "x" } }));
    await assertFails(staff().ref("messages").set({ other: { m9: { id: "m9" } } }));
  });

  it("templates: a bare whole-node set is REFUSED, the rev'd write is accepted", async () => {
    // The un-CASed write the sandbox hardening removes. Both halves matter: if
    // the bare form still passed, the rev pair would be decoration.
    await assertFails(staff().ref("templates").set([{ id: "t1", body: "hi" }]));
    await assertSucceeds(writeWithRev(staff(), "templates", [{ id: "t1", body: "hi" }], 1));
  });

  it("settings/whatsapp: the rev pair is enforced", async () => {
    await assertFails(staff().ref("settings/whatsapp").set({ v: 1, enabled: true }));
    await assertSucceeds(writeWithRev(staff(), "settings/whatsapp", { v: 1, enabled: true }, 1));
  });

  it("an unauthenticated client can write none of them", async () => {
    await assertFails(anon().ref("conversations/" + PHONE).set({ phone: PHONE }));
    await assertFails(anon().ref("messages/" + PHONE + "/m1").set({ id: "m1" }));
    await assertFails(anon().ref("templates").set([]));
    await assertFails(anon().ref("settings/whatsapp").set({ v: 1 }));
  });
});

describe("field shapes are validated (v17.16.1)", () => {
  // WAS a PROBE group asserting the rules accepted all of these. CT-2A-03's
  // server half; the assertions were inverted deliberately, not weakened.
  //
  // The rules used to validate `updatedAt` and nothing else, so every other
  // field was whatever the client said it was. That is the SERVER-SIDE half of
  // the client-side crash class: `toMins(t)` is `t.split(":")` with no guard
  // (booking-logic.js), fed from `b.time || "13:00"` — and a NUMBER survives
  // that `||`. So each of these is a stored booking that can throw in the
  // renderer of every device that loads the day.
  // REFUSED now — each of these either threw in the renderer or was silently
  // mis-read (a party of 2, a 90-minute booking, no table).
  const refused = {
    "a numeric time":        { time: 1300 },
    "a string size":         { size: "many" },
    "a negative duration":   { duration: -90 },
    "tables as a string":    { tables: "3" },
    "a numeric name":        { name: 42 },
    "a numeric date":        { date: 20260901 },
  };
  for (const [label, patch] of Object.entries(refused)) {
    it(`rejects ${label}`, async () => {
      await assertSucceeds(writeBooking(staff(), "ok", booking()));   // control
      await assertFails(writeBooking(staff(), "bad", booking(patch)));
    });
  }

  // STILL ACCEPTED, and each is a deliberate limit rather than an oversight.
  const accepted = {
    // The layout is user-configurable in Settings → Layout, so the rules cannot
    // know which ids are real without duplicating it and going stale.
    "an unknown table id":   { tables: ["Z9"] },
    // `sanitize` writes `date: b.date || ""`, so an empty date is REACHABLE in
    // stored data AND is a shape the app itself emits. v17.16.11's pattern is
    // an OPTIONAL group for exactly that reason — it matches "" as well as
    // YYYY-MM-DD, so pinning the format did not make the app's own output
    // illegal.
    "an empty date":         { date: "" },
    "no date at all":        { date: undefined },
    // Unpadded legacy times parse correctly in toMins and must keep working.
    "an unpadded time":      { time: "9:00" },
    // FORMAT is still deliberately unchecked on `time`. v17.16.11 pinned `date`
    // and `status` and deliberately NOT this one: `isReadableTime` accepts
    // "9:30", "13:00:00" and ":" on purpose, so any pattern narrow enough to be
    // worth having would refuse the client's own output.
    "a non-time string":     { time: "banana" },
  };
  for (const [label, patch] of Object.entries(accepted)) {
    it(`still accepts ${label} — deliberate`, async () => {
      const b = booking(patch);
      for (const k of Object.keys(b)) if (b[k] === undefined) delete b[k];
      await assertSucceeds(writeBooking(staff(), "edge", b));
    });
  }

  it("rejects a NON-STRING status, which is what actually broke isActive", async () => {
    await assertFails(writeBooking(staff(), "bad", booking({ status: 7 })));
  });

  // WHY `date` AND `status` ARE NOW FORMAT-CHECKED, AND `time` IS NOT.
  //
  // v17.16.1 checked all three as strings and no further, and said so here: a
  // format rule would refuse a value like "31/08/2026" already in the database,
  // which `sanitize` reads through unchanged (`b.date || ""`) and writes back on
  // the next save. `persist` sends ONE multi-path update that RTDB applies
  // ATOMICALLY, so an optimiser reshuffle touching that booking would have had
  // the WHOLE day's write refused — a red banner and no way to save, on a day
  // that looks perfectly normal. That hazard was real and the reasoning stands.
  //
  // What v17.16.11 changed is that the rule no longer has to choose. Each of
  // the two predicates is `matches(...) || newData.val() === data.val()`: a
  // stored value CARRIED THROUGH UNCHANGED is always allowed, whatever it is,
  // so no existing record can make a day unsaveable — while a value being
  // INTRODUCED or CHANGED must be well-formed. On a create `data.val()` is null
  // and the pattern is the only way through, which is what closes the door.
  //
  // That is why this needed no audit of what PROD holds, which is what the
  // ROADMAP entry had been waiting on: the grandfather clause makes the rule
  // safe against data nobody has looked at. (DEV was audited anyway — 507
  // bookings, zero malformed dates, zero malformed times, four distinct
  // statuses all valid.)
  //
  // `time` is deliberately NOT pinned. `isReadableTime` (booking-logic.js)
  // accepts "9:30", "13:00:00" and ":" on purpose — the v17.16.5 rule that
  // nothing currently working may move — so the client's own output is wider
  // than any pattern worth writing, and a grandfather clause cannot help with
  // values the app is still free to produce.

  it("refuses a NEW booking whose date is malformed", async () => {
    await assertFails(writeBooking(staff(), "new1", booking({ date: "31/08/2026" })));
  });

  it("refuses a NEW booking whose status is not one of the five", async () => {
    await assertFails(writeBooking(staff(), "new2", booking({ status: "teleported" })));
  });

  it("accepts all five real statuses", async () => {
    // The set comes from STATUS_COLORS / BookingFormModal's statusTargets /
    // every updateStatus call site — checked, not remembered.
    let i = 0;
    for (const st of ["confirmed", "pending", "seated", "completed", "cancelled"]) {
      await assertSucceeds(writeBooking(staff(), "st" + i++, booking({ status: st })));
    }
  });

  // THE GRANDFATHER CLAUSE. This is the half that makes the pin safe, and each
  // of these fails if `|| newData.val() === data.val()` is dropped from either
  // predicate — which is the plausible "simplification" a later reader might
  // make, seeing a rule that looks needlessly doubled.
  describe("a booking already holding a malformed value stays saveable", () => {
    const stored = (patch) => booking(Object.assign({ updatedAt: 5000 }, patch));
    const edit   = (patch) => booking(Object.assign(
      { updatedAt: 6000, baseUpdatedAt: 5000 }, patch));

    it("carries a stored malformed DATE through an unrelated edit", async () => {
      await seed((db) => db.ref("bookings/legacy").set(stored({ date: "31/08/2026" })));
      // The optimiser moved its table. `sanitize` re-emits the date verbatim.
      await assertSucceeds(writeBooking(staff(), "legacy",
        edit({ date: "31/08/2026", tables: ["5A"] })));
    });

    it("carries a stored unknown STATUS through an unrelated edit", async () => {
      await seed((db) => db.ref("bookings/legacy").set(stored({ status: "teleported" })));
      await assertSucceeds(writeBooking(staff(), "legacy",
        edit({ status: "teleported", size: 6 })));
    });

    it("lets a malformed value be REPAIRED to a valid one", async () => {
      // The repair path has to work or the grandfather clause would be a trap.
      await seed((db) => db.ref("bookings/legacy").set(stored({ date: "31/08/2026" })));
      await assertSucceeds(writeBooking(staff(), "legacy", edit({ date: "2026-08-31" })));
    });

    it("refuses a malformed value being changed to a DIFFERENT malformed one", async () => {
      // Carrying a value through is not the same as being free to write junk.
      await seed((db) => db.ref("bookings/legacy").set(stored({ date: "31/08/2026" })));
      await assertFails(writeBooking(staff(), "legacy", edit({ date: "01/09/2026" })));
    });

    it("refuses a malformed value on a booking that had a valid one", async () => {
      await seed((db) => db.ref("bookings/ok").set(stored({ date: "2026-09-01" })));
      await assertFails(writeBooking(staff(), "ok", edit({ date: "31/08/2026" })));
    });
  });

  it("a delete is still unconditional — child validates do not run for it", async () => {
    await seed((db) => db.ref("bookings/b1").set(booking({ updatedAt: 5000 })));
    await assertSucceeds(staff().ref("bookings").update({ b1: null }));
  });

  it("PROBE: a booking may still be stored with nothing but the two stamps", async () => {
    // Field-shape validation (v17.16.1) constrains fields that ARE present; it
    // deliberately does not require any of them, because `sanitize` fills every
    // gap on read and requiring them would make a field the app later stops
    // writing a rejected write in production. Still a PROBE, still a finding.
    await assertSucceeds(writeBooking(staff(), "hollow", { updatedAt: 1, baseUpdatedAt: 0 }));
    // …but a create with no base at all is refused, per CT-2A-01's fix.
    await assertFails(writeBooking(staff(), "hollow2", { updatedAt: 1 }));
  });
});

// ── The shape the APP writes, not a fixture that resembles it ───────────────
// v17.16.1. Every case below is run through `sanitize` — the same function
// every read passes through and therefore the shape every subsequent write
// carries — and then stamped the way `stampForWrite` stamps it. If a rule is
// too strict for anything the app can legitimately produce, it fails HERE.

describe("every booking shape the app itself produces is accepted", () => {
  // stampForWrite's create form: no `old`, so baseUpdatedAt is 0.
  const stamped = (b, i) => Object.assign({}, sanitize(b), { updatedAt: 1000 + i, baseUpdatedAt: 0 });

  const shapes = {
    "an ordinary booking":       { id: "s1", name: "Pau Estévez", phone: "+34600111222", date: "2026-09-01", time: "20:00", size: 4, duration: 90, status: "confirmed", tables: ["3"] },
    "a walk-in":                 { id: "s2", name: "Walk-in 1", phone: "", date: "2026-09-01", time: "20:15", size: 2, status: "seated", tables: ["5A"], _manual: true, _locked: true },
    "an anonymized booking":     { id: "s3", name: "Data removed", phone: "", date: "2026-09-01", time: "13:00", size: 2, status: "completed", tables: ["2"], anonymized: true },
    "a pending booking":         { id: "s4", name: "Rita", date: "2026-09-02", time: "21:30", size: 6, status: "pending", tables: [] },
    "a booking with NO tables":  { id: "s5", name: "Unplaced", date: "2026-09-02", time: "19:00", size: 2, status: "confirmed", tables: [] },
    "a booking with no date":    { id: "s6", name: "Dateless", time: "19:00", size: 2, status: "confirmed", tables: ["4"] },
    "a booking with no time":    { id: "s7", name: "Timeless", date: "2026-09-02", size: 2, status: "confirmed", tables: ["4"] },
    "a completed visit":         { id: "s8", name: "Left", date: "2026-09-01", time: "13:00", size: 2, status: "completed", tables: ["6"], stayedMin: 74 },
    "a cancelled no-show":       { id: "s9", name: "Gone", date: "2026-09-01", time: "13:00", size: 2, status: "cancelled", tables: [], noShow: true },
    "a mega-combo booking":      { id: "s10", name: "Big party", date: "2026-09-03", time: "20:00", size: 8, duration: 120, status: "confirmed", tables: ["5A", "5B", "6"] },
    "a deposit + notes booking": { id: "s11", name: "Deposit", date: "2026-09-03", time: "20:00", size: 2, status: "confirmed", tables: ["1A"], deposit: 50, notes: "window seat" },
    "a recurring occurrence":    { id: "r1_2026-09-03", name: "Standing", date: "2026-09-03", time: "20:00", size: 2, status: "confirmed", tables: ["1B"], recurringId: "r1", recurringDate: "2026-09-03" },
    "a joined phone-less guest": { id: "s12", name: "Maria", phone: "", date: "2026-09-03", time: "20:00", size: 2, status: "confirmed", tables: ["7"], guestId: "gs12" },
  };

  let i = 0;
  for (const [label, raw] of Object.entries(shapes)) {
    const n = i++;
    it(`accepts ${label}`, async () => {
      await assertSucceeds(writeBooking(staff(), raw.id, stamped(raw, n)));
    });
  }

  it("accepts an EDIT of a sanitized booking (the CAS branch, real shape)", async () => {
    const first = Object.assign({}, sanitize(shapes["an ordinary booking"]), { updatedAt: 5000, baseUpdatedAt: 0 });
    await seed((db) => db.ref("bookings/s1").set(first));
    const edited = Object.assign({}, sanitize(Object.assign({}, shapes["an ordinary booking"], { size: 6 })),
      { updatedAt: 6000, baseUpdatedAt: 5000 });
    await assertSucceeds(writeBooking(staff(), "s1", edited));
  });
});

describe("PROBE — how far updatedAt can be pushed", () => {
  // WHAT THIS GROUP IS NOT. The obvious guess is that a huge `updatedAt` locks
  // a booking forever, because the rule demands a strictly greater value. The
  // first version of this file asserted exactly that at MAX_SAFE_INTEGER and
  // was WRONG in a way its own green tick hid: it only ever wrote back the SAME
  // value, which the equal-value test above already covers.
  //
  // MAX_SAFE_INTEGER + 1 is perfectly representable and strictly greater, and
  // `stampForWrite` (usePersistence.js) computes
  //   Math.max(Date.now(), (old.updatedAt || 0) + 1, lastStamp + 1)
  // whose middle term exists precisely so a device can always beat the stored
  // value whatever its clock says. CLAUDE.md calls that "clock-skew-proof" and
  // it is. So a far-future stamp is a nuisance, NOT a lockout.
  //
  // There IS a real threshold, and it is not where you would guess: 2**53,
  // where `old + 1 === old` in IEEE-754 and the app's own stamping stops
  // advancing. Both halves are pinned below, because it is the DIFFERENCE
  // between them that is worth knowing.

  it("a far-future stamp is accepted, and does NOT lock the booking", async () => {
    const YEAR_5000 = 95617584000000;
    await assertSucceeds(writeBooking(staff(), "future",
      booking({ id: "future", updatedAt: YEAR_5000 })));

    // What stampForWrite would issue next. It wins.
    await assertSucceeds(writeBooking(staff(), "future", booking({
      id: "future", size: 2,
      updatedAt: YEAR_5000 + 1, baseUpdatedAt: YEAR_5000,
    })));
  });

  it("MAX_SAFE_INTEGER does NOT freeze a booking — M+1 still wins", async () => {
    const M = Number.MAX_SAFE_INTEGER;
    expect(M + 1 > M).toBe(true);          // the premise, stated so it cannot rot
    await assertSucceeds(writeBooking(staff(), "big",
      booking({ id: "big", updatedAt: M })));
    await assertSucceeds(writeBooking(staff(), "big", booking({
      id: "big", size: 2, updatedAt: M + 1, baseUpdatedAt: M,
    })));
  });

  it("PROBE: 2**53 DOES freeze a booking — there, old + 1 === old", async () => {
    const F = 2 ** 53;
    expect(F + 1 === F).toBe(true);        // the actual mechanism
    await assertSucceeds(writeBooking(staff(), "frozen",
      booking({ id: "frozen", updatedAt: F })));

    // stampForWrite's middle term is F + 1, which IS F, which is not greater.
    await assertFails(writeBooking(staff(), "frozen", booking({
      id: "frozen", size: 2, updatedAt: F + 1, baseUpdatedAt: F,
    })));

    // Deleting it is the only way out — and see the resurrection group for
    // what that then permits.
    await assertSucceeds(staff().ref("bookings/frozen").remove());
  });
});

describe("PROBE — the trust model's edges", () => {
  it("PROBE: any signed-in user can write ANOTHER user's prefs", async () => {
    // database.rules.README.md states this outright: "$uid is a wildcard, not a
    // per-user access rule". Proving the README right, and pinning it so a
    // future tightening (`".write": "$uid === auth.uid"`) fails here loudly.
    await assertSucceeds(writeWithRev(
      staff("staff-a"), "settings/users/staff-b/prefs", { theme: "dark" }, 1));
  });

  it("arbitrary top-level nodes can no longer be created (v17.16.7)", async () => {
    // WAS a PROBE, closed as a side effect rather than as a target: once the
    // root grant is gone, a path with no rule of its own has no grant, so the
    // writable surface is now exactly the enumerated one. Worth pinning in its
    // own right — it is what turns "add a persisted node" into a change that
    // FAILS LOUDLY if its rule is forgotten, instead of one that works in DEV
    // and is unguarded in PROD.
    await assertFails(staff().ref("junk").set({ anything: true }));
    await assertFails(staff().ref("bookingz").set({ typo: true }));
    await assertFails(staff().ref("settings/unknownNode").set({ x: 1 }));
  });

  it("PROBE: a booking id may contain characters the app never mints", async () => {
    // genId() is [0-9a-z]. RTDB keys forbid . $ # [ ] / but allow the rest.
    await assertSucceeds(writeBooking(staff(), "  spaced  ", booking()));
    await assertSucceeds(writeBooking(staff(), "emoji-🍽", booking()));
  });

  it("an authenticated client canNOT bypass the CAS with a root-level write", async () => {
    // The obvious escape: write the parent instead of the child. Validate
    // cascades to each child present in the write, so it does not work.
    await seed((db) => db.ref("bookings/b1").set(booking({ updatedAt: 5000 })));
    await assertFails(staff().ref("/").update({
      bookings: { b1: booking({ updatedAt: 9999, baseUpdatedAt: 1 }) },
    }));
  });
});
