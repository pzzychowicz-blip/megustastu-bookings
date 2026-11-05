// tests/time-zones.test.js — v18.15.0: the restaurant's zone as something a
// person picks and reads (src/lib/time-zones.js), and the setting that stores it.

import { describe, it, expect } from "vitest";
import process from "node:process";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { stripComments } from "../scripts/strip-comments.mjs";
import { zoneList, zonePlace, zoneName, offsetLabel, matchesZone, zoneNote } from "../src/lib/time-zones.js";

const SUMMER = Date.UTC(2026, 6, 1, 12);
const WINTER = Date.UTC(2026, 0, 15, 12);
function withTZ(tz, fn) {
  const prev = process.env.TZ;
  process.env.TZ = tz;
  try { return fn(); } finally { if (prev === undefined) delete process.env.TZ; else process.env.TZ = prev; }
}

describe("the list a person picks from", () => {
  it("is the engine's own, sorted, and always holds the zone in force", () => {
    const list = zoneList("Atlantic/Canary");
    expect(list.length).toBeGreaterThan(300);
    expect(list).toContain("Atlantic/Canary");
    expect(list).toEqual([...list].sort());
    // A valid zone the engine's list leaves out (UTC is not in it) is kept.
    expect(zoneList("UTC")).toContain("UTC");
    expect(zoneList("Mars/Olympus")).not.toContain("Mars/Olympus");
  });
});

describe("how a zone is named", () => {
  it("place and full name, with no underscores", () => {
    expect(zonePlace("Atlantic/Canary")).toBe("Canary");
    expect(zonePlace("America/Argentina/Buenos_Aires")).toBe("Buenos Aires");
    expect(zoneName("America/Argentina/Buenos_Aires")).toBe("America / Argentina / Buenos Aires");
    expect(zonePlace(null)).toBe("");
  });
  it("offset as people write it, with a real minus and the half hours", () => {
    expect(offsetLabel("Atlantic/Canary", SUMMER)).toBe("UTC+1");
    expect(offsetLabel("Atlantic/Canary", WINTER)).toBe("UTC");
    expect(offsetLabel("America/New_York", WINTER)).toBe("UTC−5");
    expect(offsetLabel("Asia/Kolkata", WINTER)).toBe("UTC+5:30");
    expect(offsetLabel("America/St_Johns", WINTER)).toBe("UTC−3:30");
    expect(offsetLabel("Mars/Olympus", WINTER)).toBe("");
  });
  it("search finds by place, region and offset, ignoring case and accents", () => {
    expect(matchesZone("Atlantic/Canary", "canary", SUMMER)).toBe(true);
    expect(matchesZone("America/New_York", "new york", SUMMER)).toBe(true);
    expect(matchesZone("Europe/Warsaw", "EUROPE", SUMMER)).toBe(true);
    expect(matchesZone("Atlantic/Canary", "utc+1", SUMMER)).toBe(true);
    expect(matchesZone("America/New_York", "utc-4", SUMMER)).toBe(true); // a typed hyphen finds the minus sign
    expect(matchesZone("America/Sao_Paulo", "são", SUMMER)).toBe(true);
    expect(matchesZone("Atlantic/Canary", "warsaw", SUMMER)).toBe(false);
    expect(matchesZone("Atlantic/Canary", "  ", SUMMER)).toBe(true);
  });
});

describe("the header's note — only when the device's clock differs", () => {
  it("names the restaurant's place on a device elsewhere, and says nothing on the same clock", () => {
    withTZ("Europe/Warsaw", () => expect(zoneNote("Atlantic/Canary", SUMMER)).toBe("Canary time"));
    withTZ("America/New_York", () => expect(zoneNote("Atlantic/Canary", WINTER)).toBe("Canary time"));
    withTZ("Atlantic/Canary", () => expect(zoneNote("Atlantic/Canary", SUMMER)).toBeNull());
    // Lisbon keeps the Canaries' clock all year: no note, though the names differ.
    withTZ("Europe/Lisbon", () => {
      expect(zoneNote("Atlantic/Canary", SUMMER)).toBeNull();
      expect(zoneNote("Atlantic/Canary", WINTER)).toBeNull();
    });
    // London matches in both seasons too; Madrid is an hour ahead in both.
    withTZ("Europe/London", () => expect(zoneNote("Atlantic/Canary", SUMMER)).toBeNull());
    withTZ("Europe/Madrid", () => expect(zoneNote("Atlantic/Canary", WINTER)).toBe("Canary time"));
    expect(zoneNote(null, SUMMER)).toBeNull();
    expect(zoneNote("Mars/Olympus", SUMMER)).toBeNull();
  });
});

describe("the setting is stored, seeded and applied", () => {
  const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
  const read = (p) => stripComments(readFileSync(join(ROOT, p), "utf8")).join("\n");
  it("the tenant names a zone the engine knows", async () => {
    const { profile } = await import("../src/tenants/mgt.js");
    expect(profile.timeZone).toBe("Atlantic/Canary");
    expect(zoneList().includes(profile.timeZone)).toBe(true);
  });
  it("boot sets the tenant's zone before the first render", () => {
    const M = read("src/main.jsx");
    expect(M).toContain("setTimeZone(profile.timeZone);");
    expect(M.indexOf("setTimeZone(profile.timeZone);")).toBeLessThan(M.indexOf("ReactDOM.createRoot("));
  });
  it("the hook whitelists the key, seeds it from the tenant and applies it above each setGS", () => {
    const H = read("src/hooks/useGeneralSettings.js");
    expect(H).toContain("timeZone: isValidTimeZone(profile.timeZone) ? profile.timeZone : null");
    expect(H).toContain("timeZone: isValidTimeZone(src.timeZone) ? src.timeZone : d.timeZone");
    // Both writers of the state put the clock in force on the line above it.
    expect(H).toContain("applyClock(next);\n        setGS(next);");
    expect(H).toContain("applyClock(next);\n    setGS(next);");
    expect((H.match(/setGS\(/g) || []).length).toBe(2);
  });
  it("Settings → General offers it in the Restaurant section", () => {
    const S = read("src/components/Settings.jsx");
    expect(S).toContain("<TimeZoneSetting gs={gs} onSave={onSaveGeneralSettings} />");
    expect(S).toContain("onSave({ timeZone: tz })");
  });
});
