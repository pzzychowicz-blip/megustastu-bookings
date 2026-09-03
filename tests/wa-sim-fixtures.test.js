// tests/wa-sim-fixtures.test.js
//
// The simulator's sample bookings are DATA, and data seeded into a live app has
// to satisfy the app's own invariants. One of them is not obvious and cost a day
// of "the app keeps failing its writes":
//
//   TWO `_locked` BOOKINGS MAY NEVER SHARE A TABLE AT AN OVERLAPPING TIME.
//
// CLAUDE.md records this as the one conflict the v15.6.1 reconciliation effect
// CANNOT fix: `applyOpt` copies a locked booking's tables through verbatim, so
// no reshuffle can separate them. The effect therefore never reaches a fixed
// point — it re-runs, changes something else on the day, writes, and the
// back-to-back writes race the per-booking CAS until the server refuses them.
// Measured live on 2026-09-03: a "Resolved a table conflict after syncing."
// banner on a loop and >1000 PERMISSION_DENIED writes in under a minute.
//
// The fixtures broke it ONCE A WEEK, which is why it survived so long:
// `wasimT2` is `isoPlus(2)` and `wasimK1` is `nextDow(6)`, and those are the
// SAME DATE exactly when today is a Thursday. Both are `_locked`, and both
// included table "2".
//
// So the check runs on ALL SEVEN WEEKDAYS by faking the clock, rather than on
// whatever day the suite happens to run — a fixture bug that only appears on
// Thursdays is one a Tuesday test run reports as fine.
import { describe, it, expect, afterEach, vi } from "vitest";
import { sampleBookings } from "../src/lib/wa-sim-scenarios.js";

const toMins = (t) => { const p = String(t).split(":"); return Number(p[0]) * 60 + Number(p[1] || 0); };
// The fixtures' own duration rule (makeBooking): size >= 3 → 120, else 90.
const endOf = (b) => toMins(b.time) + (b.duration || (b.size >= 3 ? 120 : 90));

function conflicts(list) {
  const out = [];
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i], b = list[j];
      if (a.date !== b.date) continue;
      if (a.status === "cancelled" || b.status === "cancelled") continue;
      const shared = (a.tables || []).filter((t) => (b.tables || []).includes(t));
      if (!shared.length) continue;
      if (toMins(a.time) < endOf(b) && toMins(b.time) < endOf(a)) {
        out.push({ a: a.id, b: b.id, date: a.date, tables: shared, locked: !!a._locked && !!b._locked });
      }
    }
  }
  return out;
}

afterEach(() => { vi.useRealTimers(); });

describe("WA-SIM sample bookings are seedable without breaking the app", () => {
  // Every weekday, because the collision is a function of WHICH DAY it is.
  const DAYS = ["2026-09-06", "2026-09-07", "2026-09-08", "2026-09-09",
                "2026-09-10", "2026-09-11", "2026-09-12"]; // Sun..Sat

  it("no two LOCKED samples ever share a table at an overlapping time, on any weekday", () => {
    const bad = [];
    for (const day of DAYS) {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(day + "T12:00:00Z"));
      const found = conflicts(sampleBookings()).filter((c) => c.locked);
      vi.useRealTimers();
      if (found.length) bad.push({ today: day, weekday: new Date(day + "T12:00:00Z").getUTCDay(), found });
    }
    expect(bad, "two _locked bookings on one table is the conflict the " +
      "reconciliation effect CANNOT resolve — applyOpt copies a locked " +
      "booking's tables through verbatim, so the effect retries forever and " +
      "the writes are refused by the CAS. Seeding one is a landmine: " +
      JSON.stringify(bad)).toEqual([]);
  });

  it("the fixture ids are unique and the tautology guard holds", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-10T12:00:00Z"));
    const s = sampleBookings();
    vi.useRealTimers();
    expect(s.length, "if the fixtures shrink to nothing the check above passes " +
      "by looking at nothing").toBeGreaterThanOrEqual(10);
    expect(new Set(s.map((b) => b.id)).size).toBe(s.length);
  });
});
