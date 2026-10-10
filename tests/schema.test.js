// tests/schema.test.js — v18.6.0: the minimum schema gate (src/lib/schema.js).
import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { SCHEMA, storedSchemaOf, schemaBehind, shouldAnnounce, mayAnnounceFrom, configureSchemaGate, setStoredSchema,
  writesBlocked, resetSchemaGate } from "../src/lib/schema.js";
import { BOOKING_FIELDS } from "../src/lib/booking-fields.js";
import { stripComments } from "../scripts/strip-comments.mjs";

const SRC = fileURLToPath(new URL("../src/", import.meta.url));
const read = (rel) => stripComments(readFileSync(join(SRC, rel), "utf8")).join("\n");

describe("the stored number", () => {
  it("reads {v: N}, and anything else as 0", () => {
    expect(storedSchemaOf({ v: 3 })).toBe(3);
    expect(storedSchemaOf({ v: 3.9 })).toBe(3);
    for (const junk of [null, undefined, 3, "3", {}, { v: "3" }, { v: 0 }, { v: -1 }, { v: NaN }, { v: Infinity }]) {
      expect(storedSchemaOf(junk), JSON.stringify(junk)).toBe(0);
    }
  });
  it("a build is behind only when the database is strictly ahead, and never before the read", () => {
    expect(schemaBehind(2, 1)).toBe(true);
    expect(schemaBehind(1, 1)).toBe(false);
    expect(schemaBehind(0, 1)).toBe(false);
    expect(schemaBehind(null, 1)).toBe(false);
  });
  it("a build announces only a higher number, only after the read, only where enforced", () => {
    expect(shouldAnnounce(0, 1, true)).toBe(true);
    expect(shouldAnnounce(1, 2, true)).toBe(true);
    expect(shouldAnnounce(1, 1, true)).toBe(false);
    expect(shouldAnnounce(2, 1, true)).toBe(false);
    expect(shouldAnnounce(null, 1, true)).toBe(false);
    expect(shouldAnnounce(0, 1, false)).toBe(false);
  });
  // /code-review: a Vercel preview is a production build on the PROD database.
  // Announcing from one would stop every device in the restaurant for a branch
  // that is not merged.
  it("a Vercel preview never announces; production and any other build may", () => {
    expect(mayAnnounceFrom("preview")).toBe(false);
    expect(mayAnnounceFrom("production")).toBe(true);
    expect(mayAnnounceFrom("")).toBe(true);
    expect(mayAnnounceFrom(undefined)).toBe(true);
    const H = read("hooks/useSchemaGate.js");
    expect(H).toContain("const announce = enforce && mayAnnounceFrom(import.meta.env.VITE_DEPLOY_ENV);");
    const V = readFileSync(fileURLToPath(new URL("../vite.config.js", import.meta.url)), "utf8");
    expect(V).toContain('define: { "import.meta.env.VITE_DEPLOY_ENV": JSON.stringify(process.env.VERCEL_ENV || "") },');
  });
});

describe("writesBlocked", () => {
  beforeEach(() => { resetSchemaGate(); vi.restoreAllMocks(); });
  it("lets every write through until the number is read, at the same number, and below it", () => {
    expect(writesBlocked("bookings")).toBe(false);
    setStoredSchema(0); expect(writesBlocked("bookings")).toBe(false);
    setStoredSchema(SCHEMA); expect(writesBlocked("bookings")).toBe(false);
  });
  it("refuses once the database is ahead, and says which write", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    setStoredSchema(SCHEMA + 1);
    expect(writesBlocked("vouchers")).toBe(true);
    expect(warn.mock.calls[0][0]).toContain("Refused to write vouchers");
  });
  it("advisory (DEV): writes anyway, and warns once", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    configureSchemaGate({ enforce: false });
    setStoredSchema(SCHEMA + 1);
    expect(writesBlocked("bookings")).toBe(false);
    expect(writesBlocked("tableBlocks")).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

// Every writer that reads through a whitelist and writes the record whole asks
// the gate before it dispatches. A writer added later is not found by this list:
// CLAUDE.md's Rule of law names the gate as part of adding a persisted node.
describe("the writers ask it", () => {
  it("bookings, before the freshness gate, and the legacy migration", () => {
    const P = read("hooks/usePersistence.js");
    const fn = P.slice(P.indexOf("function saveBookings("), P.indexOf("function saveBlocks("));
    expect(fn.indexOf('if(writesBlocked("bookings")){dropped();return false;}')).toBeGreaterThan(-1);
    expect(fn.indexOf('if(writesBlocked("bookings"))')).toBeLessThan(fn.indexOf("if(staleRef.current){"));
    expect(P).toContain('if(writesBlocked("the bookings migration")) return;');
  });
  it("every rev-paired node, in the one function that writes them", () => {
    const R = read("lib/revGuard.js");
    const fn = R.slice(R.indexOf("export function writeWithRev("));
    expect(fn.indexOf("if(writesBlocked(path)) return Promise.resolve();")).toBeGreaterThan(-1);
    expect(fn.indexOf("if(writesBlocked(path))")).toBeLessThan(fn.indexOf("revRef.current = nextRev"));
  });
  it("vouchers, and roles and invites", () => {
    expect(read("hooks/useVouchers.js")).toContain('if (writesBlocked("vouchers")) return false;');
    expect(read("hooks/useRoles.js")).toContain("if (writesBlocked(node)) return false;");
  });
  it("the hook never announces before the read, and App makes the page inert under the card", () => {
    const H = read("hooks/useSchemaGate.js");
    const ask = H.indexOf("if (!announced.current && shouldAnnounce(stored, SCHEMA, announce)) {");
    expect(ask).toBeGreaterThan(H.indexOf("const stored = storedSchemaOf(snap.val());"));
    // Once per page load: a refused announce rolls back and arrives as the old
    // number again, which looped (99 refused writes, measured on DEV).
    expect(H.indexOf("announced.current = true;")).toBeGreaterThan(ask);
    expect(H.indexOf("announced.current = true;")).toBeLessThan(H.indexOf('writeWithRev("schema"'));
    expect(H).toContain('writeWithRev("schema", { v: SCHEMA }, revRef,');
    const A = read("App.jsx");
    // /code-review: until `/schema` is read the gate lets every write through.
    // The hook is called before `usePersistence`, so its listener is attached
    // first and the number arrives before the bookings any write needs.
    expect(A.indexOf("useSchemaGate();")).toBeGreaterThan(-1);
    expect(A.indexOf("useSchemaGate();")).toBeLessThan(A.indexOf("} = usePersistence({"));
    expect(A).toContain("const anyModal=modalStack.length>0||schemaBlocked;");
    expect(A).toContain("{schemaBlocked?<div style={{position:\"relative\",zIndex:350}}><UpdateRequired onRefresh={function(){window.location.reload();}} /></div>:null}");
  });
});

// ── The guard: what is stored, pinned to the number ─────────────────────────
// A fingerprint of every `sanitize*` function in src (found by walking it, not
// typed out here) and of the booking's field list. When this fails, something
// that decides what is stored has changed:
//   - a key was ADDED or REMOVED (a per-booking field, a key in a rule, a
//     voucher, a settings node): raise SCHEMA in src/lib/schema.js by one, set
//     PINNED.schema to it, and replace the prints below with the ones printed;
//   - the edit stores nothing new (a clamp, a rename inside the function, a
//     comment-free refactor): replace the prints only, and leave SCHEMA alone,
//     because raising it stops every device on the previous build from writing.
function walk(dir, out) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.jsx?$/.test(name)) out.push(p);
  }
  return out;
}
function sanitisers() {
  const prints = {};
  for (const file of walk(SRC, []).sort()) {
    const text = stripComments(readFileSync(file, "utf8")).join("\n");
    const re = /function (sanitize[A-Za-z]*)\s*\(/g;
    let m;
    while ((m = re.exec(text))) {
      let i = text.indexOf("{", text.indexOf(")", m.index)), depth = 0, end = text.length;
      for (let j = i; j < text.length; j++) {
        if (text[j] === "{") depth++;
        else if (text[j] === "}" && --depth === 0) { end = j + 1; break; }
      }
      const body = text.slice(m.index, end).replace(/\s+/g, "");
      prints[file.slice(SRC.length) + ":" + m[1]] = createHash("sha256").update(body).digest("hex").slice(0, 10);
    }
  }
  prints["BOOKING_FIELDS"] = BOOKING_FIELDS.map((r) => r.key).join(",");
  return prints;
}

const PINNED = {
  schema: 1,
  prints: {
      "hooks/useBookingDefaults.js:sanitizeTiers": "8d1b9808c9",
      "hooks/useBookingDefaults.js:sanitizeBookingDefaults": "7a6d45c5c4",
      "hooks/useDayShifts.js:sanitizeShifts": "42278cbe80",
      "hooks/useGeneralSettings.js:sanitizeGeneral": "9497dee0b6",
      "hooks/useLayout.js:sanitizeFloorPlan": "1c43f674f3",
      "hooks/useLayout.js:sanitizeLayout": "ade2386fc8",
      "hooks/useOperatingHours.js:sanitizeDay": "ad45829200",
      "hooks/useOperatingHours.js:sanitizeWeek": "626f2ee9fb",
      "hooks/useOptimizerSettings.js:sanitizeOptimizer": "74794693a2",
      "hooks/useRecurring.js:sanitizeRule": "b047ce1ebe",
      "hooks/useRecurring.js:sanitizeRecurring": "9f3c9986fd",
      "hooks/useRoles.js:sanitizeAdminSettings": "97b57e7524",
      "hooks/useUserPrefs.js:sanitizeUserPrefs": "fb820d1b7b",
      "hooks/useVoucherDefaults.js:sanitizeVoucherDefaults": "7abe4b008f",
      "hooks/useWaSettings.js:sanitizeWa": "2cbe5d8113",
      "lib/booking-fields.js:sanitizeByTable": "1b03b3eeed",
      "lib/booking-fields.js:sanitize": "13df4f0302",
      "lib/booking-logic.js:sanitizeAll": "0f5dccd886",
      "lib/booking-logic.js:sanitizeBlock": "d816dc8acd",
      "lib/booking-logic.js:sanitizeBlocks": "e99a88e569",
      "lib/modules.js:sanitizeModules": "fda6f20b7d",
      "lib/roles.js:sanitizeRole": "fda2bcc13d",
      "lib/roles.js:sanitizeCaps": "ffd5f289a4",
      "lib/roles.js:sanitizeRoles": "30d2d04752",
      "lib/roles.js:sanitizeInvite": "28429586db",
      "lib/roles.js:sanitizeInvites": "dca4d8e470",
      "lib/tags.js:sanitizeTagList": "5efb78d18b",
      "lib/vouchers.js:sanitizeVoucher": "ef3e67ad4b",
      "lib/vouchers.js:sanitizeVouchers": "371d5b2c85",
      "lib/whatsapp.js:sanitizeParse": "b8f1f1273a",
      "BOOKING_FIELDS": "id,name,phone,date,time,scheduledTime,size,duration,originalDuration,preference,notes,status,tables,customDur,_manual,_locked,_conflict,preferredTables,returnOf,history,noShow,deposit,voucherCode,recurringId,recurringDate,anonymized,guestId,stayedMin,updatedAt,tags,guestTags,guestTagsAt"
  },
};

describe("what is stored is pinned to SCHEMA", () => {
  const now = sanitisers();
  it("found the sanitisers (a walker that returns none would pass the next test)", () => {
    expect(Object.keys(now).length).toBeGreaterThanOrEqual(25);
    expect(now["lib/booking-fields.js:sanitize"]).toBeTruthy();
    expect(now["hooks/useRecurring.js:sanitizeRule"]).toBeTruthy();
    expect(now["lib/vouchers.js:sanitizeVoucher"]).toBeTruthy();
  });
  it("SCHEMA is the pinned number", () => {
    expect(SCHEMA).toBe(PINNED.schema);
  });
  it("no sanitiser and no booking field changed without the pin (read the note above before re-pinning)", () => {
    expect(now).toEqual(PINNED.prints);
  });
});
