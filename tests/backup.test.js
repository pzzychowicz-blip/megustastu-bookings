// tests/backup.test.js — v18.1.1: what "Download backup" writes.
//
// The bug this pins: from v16.3.0 the backup was a hand-built object naming five
// collections and five settings nodes, and every node added after it — vouchers,
// roles, invites, activity, four settings nodes, the WhatsApp data — was missing
// from the only backup the restaurant has. A restore would have lost every
// gift-voucher balance, and nothing could see it, because the list was a second
// copy of a fact `database.rules.json` already holds.
//
// So the node list here is DERIVED from the rules file, never typed: a node added
// to the rules is swept by these tests the day it lands, and an omission naming a
// node the rules no longer declare fails. A hand-typed list in this file would be
// the same bug a second time.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { stripComments } from "../scripts/strip-comments.mjs";
import { buildBackup, runBackup, backupErrorText, backupReportTarget, BACKUP_OMIT, BACKUP_META_KEY } from "../src/lib/backup.js";

const ROOT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const RULES = JSON.parse(readFileSync(join(ROOT_DIR, "database.rules.json"), "utf8")).rules;

// Every node the rules declare, top-level and under settings/. Keys starting with
// "." are rule expressions and "$" are wildcards — neither is a node name.
const isNode = (k) => !k.startsWith(".") && !k.startsWith("$");
const TOP = Object.keys(RULES).filter(isNode);
const SETTINGS = Object.keys(RULES.settings).filter(isNode);

const omitted = (k) => Object.prototype.hasOwnProperty.call(BACKUP_OMIT, k);

const META = { exportedAt: "2026-09-23T10:00:00.000Z", appVersion: "18.1.1" };

// A database with a distinct value at every node the rules declare.
function fullDatabase() {
  const db = {};
  for (const k of TOP) db[k] = { marker: "top:" + k };
  db.settings = {};
  for (const k of SETTINGS) db.settings[k] = { marker: "settings:" + k };
  return db;
}

describe("buildBackup — the file is the whole database, minus a reasoned list", () => {
  it("sanity: the rules still declare the nodes this test is about", () => {
    // If these ever fail, the derivation above broke — not the backup.
    expect(TOP).toContain("bookings");
    expect(TOP).toContain("vouchers");
    expect(TOP).toContain("settings");
    expect(SETTINGS).toContain("admin");
    expect(SETTINGS.length).toBeGreaterThan(5);
  });

  it("keeps every top-level node the rules declare, except the named omissions", () => {
    const db = fullDatabase();
    const out = buildBackup(db, META);
    for (const k of TOP) {
      if (omitted(k)) expect(out, "omitted on purpose: " + k).not.toHaveProperty(k);
      else expect(out[k], "missing from the backup: " + k).toEqual(db[k]);
    }
  });

  it("keeps every settings/* node the rules declare", () => {
    const db = fullDatabase();
    const out = buildBackup(db, META);
    for (const k of SETTINGS) expect(out.settings[k], "missing: settings/" + k).toEqual(db.settings[k]);
  });

  it("carries vouchers — the node whose absence started this", () => {
    const vouchers = { ABCD2345: { value: 50, remaining: 20, issuedAt: 1000, redemptions: { b1: 30 } } };
    const out = buildBackup({ bookings: { b1: { id: "b1" } }, vouchers }, META);
    expect(out.vouchers).toEqual(vouchers);
  });

  it("copies values verbatim — revs included, nothing sanitized", () => {
    const db = {
      tableBlocks: [{ tableId: "3", date: "2026-09-23", allDay: true }],
      tableBlocksRev: 7,
      bookings: { x: { id: "x", time: "8 in the evening", odd: true } },
    };
    const out = buildBackup(db, META);
    expect(out.tableBlocksRev).toBe(7);
    expect(out.tableBlocks).toEqual(db.tableBlocks);
    // A restore must put back what was stored, not what sanitize would make of it.
    expect(out.bookings.x).toEqual(db.bookings.x);
  });
});

describe("BACKUP_OMIT — leaving a node out is a decision with a reason", () => {
  it("every omission names a node the rules still declare", () => {
    for (const k of Object.keys(BACKUP_OMIT)) expect(TOP, "stale omission: " + k).toContain(k);
  });

  it("every omission carries a reason", () => {
    for (const [k, why] of Object.entries(BACKUP_OMIT)) {
      expect(typeof why, k).toBe("string");
      expect(why.length, k).toBeGreaterThan(20);
    }
  });

  it("is exactly presence and reminderFires — widening it is a visible change", () => {
    // Pinned on purpose. Adding an omission means data a restore will not bring
    // back; the edit to this line is where that gets noticed in review.
    expect(Object.keys(BACKUP_OMIT).sort()).toEqual(["presence", "reminderFires"]);
  });
});

describe("the file's own metadata", () => {
  it("leads the file and records version, time and each omission's reason", () => {
    const out = buildBackup(fullDatabase(), META);
    expect(Object.keys(out)[0]).toBe(BACKUP_META_KEY);
    const meta = out[BACKUP_META_KEY];
    expect(meta.exportedAt).toBe(META.exportedAt);
    expect(meta.appVersion).toBe("18.1.1");
    expect(meta.omitted).toHaveLength(Object.keys(BACKUP_OMIT).length);
    for (const k of Object.keys(BACKUP_OMIT)) {
      expect(meta.omitted.some((line) => line.startsWith(k + " ("))).toBe(true);
    }
  });

  it("replaces a _backup node left by an earlier restore — never nests it", () => {
    const out = buildBackup({ [BACKUP_META_KEY]: { exportedAt: "old", appVersion: "18.0.0" }, bookings: { a: 1 } }, META);
    expect(out[BACKUP_META_KEY].exportedAt).toBe(META.exportedAt);
    expect(out[BACKUP_META_KEY]).not.toHaveProperty(BACKUP_META_KEY);
    expect(Object.keys(out).filter((k) => k === BACKUP_META_KEY)).toHaveLength(1);
  });

  it("an empty database gives a file holding only the metadata", () => {
    expect(Object.keys(buildBackup(null, META))).toEqual([BACKUP_META_KEY]);
  });

  it("survives a JSON round trip unchanged — nothing undefined inside", () => {
    const out = buildBackup(fullDatabase(), META);
    expect(JSON.parse(JSON.stringify(out))).toEqual(out);
  });
});

// v18.4.5 (ROADMAP #17): the flow left BookingApp for `runBackup`, so its four
// outcomes are RUN here where the old checks read App's source for them.
describe("runBackup: what Download backup does and says", () => {
  const meta = { appVersion: "9.9.9", day: "2026-10-07", exportedAt: "2026-10-07T10:00:00.000Z" };
  const run = (over) => {
    const reports = [];
    const saved = [];
    const deps = Object.assign({
      readRoot: () => Promise.resolve({ bookings: { a: { id: "a" } }, presence: { k: 1 } }),
      save: (text, filename, type) => { saved.push({ text, filename, type }); },
      report: (st) => reports.push(st),
    }, meta, over);
    return runBackup(deps).then(() => ({ reports, saved }));
  };

  it("says it is reading, then saves the built file under the day's name", async () => {
    const { reports, saved } = await run();
    expect(reports.map((r) => r.kind)).toEqual(["busy", "done"]);
    expect(reports[1].text).toBe("Backup file created: mgt-backup-2026-10-07.json. Check this device's downloads.");
    expect(saved).toHaveLength(1);
    expect([saved[0].filename, saved[0].type]).toEqual(["mgt-backup-2026-10-07.json", "application/json"]);
    // the file is buildBackup's answer, not a payload of its own
    expect(JSON.parse(saved[0].text)).toEqual(buildBackup({ bookings: { a: { id: "a" } }, presence: { k: 1 } }, meta));
    expect(JSON.parse(saved[0].text).presence).toBeUndefined();
  });

  it("a device that cannot make the file says so, as an error", async () => {
    const { reports } = await run({ save: () => { throw new Error("no blob"); } });
    expect(reports.map((r) => r.kind)).toEqual(["busy", "error"]);
    expect(reports[1].text).toBe("Couldn't create the backup file on this device.");
  });

  it("offline is named, and saves nothing", async () => {
    const { reports, saved } = await run({ readRoot: () => Promise.reject(new Error("offline")) });
    expect(reports.map((r) => r.kind)).toEqual(["busy", "error"]);
    expect(reports[1].text).toMatch(/^Offline\. A backup needs a connection/);
    expect(saved).toEqual([]);
  });

  it("any other failed read is a failed read", async () => {
    const { reports, saved } = await run({ readRoot: () => Promise.reject(new Error("permission_denied")) });
    expect(reports[1]).toEqual({ kind: "error", text: "Couldn't read the database for the backup." });
    expect(saved).toEqual([]);
    expect(backupErrorText(null)).toBe("Couldn't read the database for the backup.");
  });

  it("always resolves: the outcome is the report", async () => {
    await expect(runBackup(Object.assign({ readRoot: () => Promise.reject(new Error("x")), save: () => {}, report: () => {} }, meta))).resolves.toBeUndefined();
  });
});

// A read that returns after Settings closed belongs to no open of it. It must
// not leave a stale line for the next open, and a failure must still be seen:
// the banner, visible once the overlay is gone.
describe("backupReportTarget: where an outcome is shown", () => {
  it("under the button while the Settings that started it is open", () => {
    ["busy", "done", "error"].forEach((kind) => expect(backupReportTarget({ kind }, true)).toBe("status"));
  });
  it("after it closed: a failure to the banner, the rest nowhere", () => {
    expect(backupReportTarget({ kind: "error" }, false)).toBe("banner");
    expect(backupReportTarget({ kind: "done" }, false)).toBe("drop");
    expect(backupReportTarget({ kind: "busy" }, false)).toBe("drop");
  });
});

describe("the hook and App are wired to the flow", () => {
  const strip = (rel) => stripComments(readFileSync(join(ROOT_DIR, "src", rel), "utf8")).join("\n");
  const hook = strip("hooks/useBackup.js");
  const app = strip("App.jsx");

  it("the hook asks the capability first, then runs the flow with the root read and the file saver", () => {
    const body = hook.slice(hook.indexOf("function doBackup("));
    expect(body.indexOf('refused("dataExport")')).toBeGreaterThan(-1);
    expect(body.indexOf('refused("dataExport")')).toBeLessThan(body.indexOf("runBackup("));
    expect(body).toMatch(/readRoot: readDatabaseRoot,/);
    expect(body).toMatch(/save: saveTextFile,/);
  });

  it("the hook routes each report through backupReportTarget, by which open it belongs to", () => {
    expect(hook).toMatch(/backupReportTarget\(st, open === openRef\.current\)/);
    expect(hook).toMatch(/if \(target === "status"\) setBackupStatus\(st\);/);
    expect(hook).toMatch(/else if \(target === "banner"\) setWriteWarning\(st\.text\);/);
    expect(hook).toMatch(/function endBackupOpen\(\) \{ setBackupStatus\(null\); openRef\.current\+\+; \}/);
  });

  it("App uses the hook, ends the open when Settings closes, and builds no payload of its own", () => {
    expect(app).toMatch(/useBackup\(\{readDatabaseRoot:readDatabaseRoot,refused:refused,setWriteWarning:setWriteWarning,appVersion:__APP_SIGNATURE__\.version\}\)/);
    expect(app).toMatch(/function closeSettings\(\)\{[^}]*endBackupOpen\(\);\}/);
    expect(app).not.toContain("buildBackup(");
    expect(app).not.toContain("createObjectURL");
  });

  it("Settings keeps the status region mounted, so it can announce", () => {
    const settings = stripComments(readFileSync(join(ROOT_DIR, "src", "components", "Settings.jsx"), "utf8")).join("\n");
    expect(settings).toMatch(/<div role="status"[^>]*>\s*\{backupStatus \? backupStatus\.text : null\}/);
  });
});
