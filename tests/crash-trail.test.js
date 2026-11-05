// tests/crash-trail.test.js — v18.15.0
//
// The admin's crash trail. A crash was visible only to someone who went looking
// (Settings → Admin → Open the log → Crashes). The count of crashes this admin
// has not seen now shows on the gear, the Admin tab, "Open the log" and the
// Crashes chip, and turning the chip on clears it on every device they use.
//
// The decision is pure (`crashTrail`); the wiring is held on the source, since
// the suite mounts no components (tests/CLAUDE.md).

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { crashTrail } from "../src/lib/crash-report.js";
import { sanitizeUserPrefs, DEFAULT_USER_PREFS } from "../src/hooks/useUserPrefs.js";
import { stripComments } from "../scripts/strip-comments.mjs";
import { appCode } from "./app-source.js";

const read = (p) => stripComments(readFileSync(new URL("../" + p, import.meta.url), "utf8")).join("\n");
const crash = (at) => ({ kind: "crash", at, text: "TypeError" });

describe("crashTrail", () => {
  it("counts the crashes newer than the newest one seen, and finds the newest", () => {
    const list = [crash(100), crash(300), crash(200)];
    expect(crashTrail(list, 150)).toEqual({ count: 2, latest: 300 });
    expect(crashTrail(list, 300)).toEqual({ count: 0, latest: 300 });
    // RTDB's keyed shape reads the same.
    expect(crashTrail({ a: crash(100), b: crash(300) }, 100)).toEqual({ count: 1, latest: 300 });
  });
  it("never looked is every crash new", () => {
    for (const seen of [null, undefined, 0, -5, "300", NaN]) {
      expect(crashTrail([crash(100), crash(300)], seen), String(seen)).toEqual({ count: 2, latest: 300 });
    }
  });
  it("only crash entries with a real time count", () => {
    const junk = [null, 3, { kind: "booking", at: 900 }, { kind: "crash" }, { kind: "crash", at: "900" }, { kind: "crash", at: Infinity }];
    expect(crashTrail(junk.concat([crash(50)]), 0)).toEqual({ count: 1, latest: 50 });
    expect(crashTrail(null, 0)).toEqual({ count: 0, latest: 0 });
  });
});

describe("crashSeenAt in the person's prefs", () => {
  it("is a positive number or null, never anything else", () => {
    expect(DEFAULT_USER_PREFS.crashSeenAt).toBe(null);
    expect(sanitizeUserPrefs({ crashSeenAt: 1730800000000 }).crashSeenAt).toBe(1730800000000);
    for (const bad of [undefined, null, 0, -1, "1730800000000", NaN, Infinity, {}]) {
      expect(sanitizeUserPrefs({ crashSeenAt: bad }).crashSeenAt, String(bad)).toBe(null);
    }
  });
});

describe("the trail's wiring", () => {
  it("one listener, on the kind index, the newest 50 crashes", () => {
    const h = read("src/hooks/useCrashTrail.js");
    expect(h).toContain('query(ref(db, "activity"), orderByChild("kind"), equalTo("crash"), limitToLast(CRASH_TRAIL_LIMIT))');
    expect(h).toContain("export const CRASH_TRAIL_LIMIT = 50;");
    expect(h).toContain('dbError("activity (crash trail)")');
    expect(h).toMatch(/if \(!enabled\) return undefined;/);
  });
  it("App listens only for an admin whose prefs have loaded, and stores the newest crash's own time", () => {
    const app = appCode();
    expect(app).toContain('useCrashTrail(can("settingsAdmin") && prefsLoaded, userPrefs.crashSeenAt)');
    expect(app).toMatch(/if\(crashes\.latest>\(userPrefs\.crashSeenAt\|\|0\)\) saveUserPrefs\(\{crashSeenAt:crashes\.latest\}\);/);
    // Never this device's clock.
    const fn = app.slice(app.indexOf("function markCrashesSeen"), app.indexOf("const crashWord"));
    expect(fn).not.toMatch(/Date\.now|new Date/);
  });
  it("the count is on all four steps of the trail", () => {
    const app = appCode();
    expect(app).toMatch(/<CogIcon size=\{IC\.chrome\} \/><CountBadge n=\{crashes\.count\}[^>]*float/);
    expect(app).toContain('aria-label={"Settings & keyboard shortcuts"+(crashWord?", "+crashWord:"")}');
    expect(app).toContain("newCrashes={crashes.count}");
    expect(app).toContain("onCrashesSeen={markCrashesSeen}");
    const settings = read("src/components/Settings.jsx");
    expect(settings).toMatch(/alerts=\{newCrashes > 0 \? \{ admin: /);
    expect(settings).toContain("newCrashes={newCrashes} moreCrashes={moreCrashes}");
    expect(read("src/components/AdminSettings.jsx")).toMatch(/>Open the log<CountBadge n=\{newCrashes\}/);
    const log = read("src/components/ActivityLogModal.jsx");
    expect(log).toMatch(/k === "crash" \? <CountBadge n=\{newCrashes\}/);
  });
  it("turning the Crashes chip ON marks them seen, and turning it off does not", () => {
    const log = read("src/components/ActivityLogModal.jsx");
    const fn = log.slice(log.indexOf("function toggleKind"), log.indexOf("function pressCrashes"));
    expect(fn).toContain('if (k === "crash" && !kinds.crash && onCrashesSeen) onCrashesSeen();');
  });
  it("the WhatsApp unread count wears the same atom", () => {
    const app = appCode();
    expect(app).toContain('WhatsApp<CountBadge n={wa.unreadCount} float background="var(--wa-unread-dot)" /></button>');
  });
});
