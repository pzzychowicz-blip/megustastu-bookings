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
    // Spot-check the two structures the rest of this file is about, so a
    // truncated or reshaped rules file fails here rather than as 60 confusing
    // downstream failures.
    expect(parsed.rules[".read"]).toBe("auth != null");
    expect(parsed.rules.bookings.$bid[".validate"]).toContain("baseUpdatedAt");
    expect(parsed.rules.tableBlocksRev[".validate"]).toContain("data.val() + 1");
  });
});

// ── 1–3. The auth boundary ──────────────────────────────────────────────────
// `.read`/`.write`: "auth != null" at the root, and nothing below re-grants or
// re-denies. So this is the entire access-control model, and it is worth
// proving rather than assuming.

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

// ── PROBE — resurrection (crash-test spec §5, Scenario D) ───────────────────
// "Client A deletes X. Client B edits X from stale state. Expected: deletion
// must not unexpectedly resurrect X." It does.
//
// The rule reads
//   !newData.exists() || (hasChild('updatedAt') && isNumber(...) &&
//                         (!data.exists() || <the CAS>))
// and the `!data.exists()` disjunct is the hole: once the booking is gone,
// the CAS branch is never reached, so ANY write carrying a numeric updatedAt
// recreates the node — including one whose `baseUpdatedAt` names a version that
// was deleted, which is precisely what an offline device's queued edit carries.
//
// These tests PIN the current behaviour rather than assert the desired one, so
// the day the rules are tightened they fail loudly and are updated deliberately.
// See ROADMAP.md.

describe("PROBE — a deleted booking can be resurrected", () => {
  it("PROBE: a stale queued write recreates a booking another device deleted", async () => {
    await seed((db) => db.ref("bookings/b1").set(booking({ updatedAt: 5000 })));

    // Device A cancels the booking. Deletes are unconditional by design.
    await assertSucceeds(staff("device-a").ref("bookings").update({ b1: null }));
    expect(await seedRead("bookings/b1")).toBeNull();

    // Device B was offline and never saw the delete. Its queued edit names the
    // base it last saw — a version that no longer exists.
    await assertSucceeds(staff("device-b").ref("bookings").update({
      b1: booking({ size: 8, updatedAt: 6000, baseUpdatedAt: 5000 }),
    }));

    const back = await seedRead("bookings/b1");
    expect(back).not.toBeNull();
    expect(back.size).toBe(8);   // and with the STALE device's contents
  });

  it("PROBE: even a write naming a base that never existed resurrects it", async () => {
    await seed((db) => db.ref("bookings/b1").set(booking({ updatedAt: 5000 })));
    await assertSucceeds(staff().ref("bookings/b1").remove());
    // baseUpdatedAt is not checked at all on the create branch.
    await assertSucceeds(writeBooking(staff(), "b1",
      booking({ updatedAt: 1, baseUpdatedAt: 999999 })));
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

describe("PROBE — whole-node deletion", () => {
  it("PROBE: an authenticated client can delete the ENTIRE bookings node in one call", async () => {
    // `.validate` is not evaluated when newData does not exist, and /bookings
    // itself carries no rule — only /bookings/$bid does. So every booking in
    // the restaurant is one `set(null)` away, with no CAS, no rev, no guard.
    // The app's own client-side empty-array write guard lives in
    // usePersistence.js and is not on this path.
    await seed((db) => db.ref("bookings").set({
      b1: booking(), b2: booking({ id: "b2" }), b3: booking({ id: "b3" }),
    }));
    await assertSucceeds(staff().ref("bookings").remove());
    expect(await seedRead("bookings")).toBeNull();
  });

  it("PROBE: tableBlocks can be deleted WITHOUT touching its rev", async () => {
    // revGuard.js's header says: "RTDB stores that as a node DELETE, which
    // skips the node's own .validate, but the rev child's rule still enforces
    // +1, so the CAS holds even for wipes." That is true of the APP's write
    // path, which always sends both keys. It is not a property of the RULES:
    // a client that simply omits the rev is not constrained by it.
    await seed((db) => db.ref().update({ tableBlocks: [{ id: "k1" }], tableBlocksRev: 5 }));
    await assertSucceeds(staff().ref("tableBlocks").remove());
    expect(await seedRead("tableBlocks")).toBeNull();
    expect(await seedRead("tableBlocksRev")).toBe(5);   // rev left behind, node gone
  });

  it("the app's own wipe (node + rev, atomically) is accepted", async () => {
    await seed((db) => db.ref().update({ tableBlocks: [{ id: "k1" }], tableBlocksRev: 5 }));
    await assertSucceeds(writeWithRev(staff(), "tableBlocks", null, 6));
  });
});

describe("PROBE — no field-shape validation on bookings", () => {
  // The rules validate `updatedAt` and nothing else. Every other field is
  // whatever the client says it is. This is the SERVER-SIDE half of the
  // client-side crash class: `toMins(t)` is `t.split(":")` with no guard
  // (booking-logic.js), fed from `b.time || "13:00"` — and a NUMBER survives
  // that `||`. So each of these is a stored booking that can throw in the
  // renderer of every device that loads the day.
  const cases = {
    "a numeric time":        { time: 1300 },
    "a string size":         { size: "many" },
    "a negative duration":   { duration: -90 },
    "an unknown status":     { status: "teleported" },
    "an unknown table id":   { tables: ["Z9"] },
    "tables as a string":    { tables: "3" },
    "a numeric name":        { name: 42 },
    // `date: null` is NOT a separate case: RTDB deletes a key written as null,
    // so it stores byte-identically to this one. Listing both would report two
    // findings where there is one behaviour.
    "no date at all":        { date: undefined },
  };

  for (const [label, patch] of Object.entries(cases)) {
    it(`PROBE: the rules ACCEPT ${label}`, async () => {
      const b = booking(patch);
      for (const k of Object.keys(b)) if (b[k] === undefined) delete b[k];
      await assertSucceeds(writeBooking(staff(), "bad", b));
    });
  }

  it("PROBE: a booking may be stored with NOTHING but updatedAt", async () => {
    await assertSucceeds(writeBooking(staff(), "hollow", { updatedAt: 1 }));
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

  it("PROBE: any signed-in user can create arbitrary top-level nodes", async () => {
    await assertSucceeds(staff().ref("junk").set({ anything: true }));
    await assertSucceeds(staff().ref("bookingz").set({ typo: true }));
    await assertSucceeds(staff().ref("settings/unknownNode").set({ x: 1 }));
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
