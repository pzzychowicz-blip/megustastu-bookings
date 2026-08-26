// tests/wa-rtdb-hardening.test.js
//
// The two ROADMAP "WhatsApp sandbox hardening" items, which were scoped to this
// branch because `verifyStaffToken` and `_lib/rtdb.js` exist only here. Both are
// required before the sandbox ever points at PROD or goes WA_SEND_MODE=live.
//
// What makes them worth a test rather than a comment: neither failure is
// visible. An absent allow-list looks exactly like a working backend, and an
// unsanitized path segment does not throw — it writes somewhere else.

import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { staffEmails, requireStaffAllowList } from "../api/_lib/env.js";
import { sanitizeKey, staffAuthError } from "../api/_lib/rtdb.js";

const DEV_DB_URL = "https://megustastu-bookings-dev-default-rtdb.europe-west1.firebasedatabase.app";
const saved = { ...process.env };
afterEach(() => {
  for (const k of ["WA_STAFF_EMAILS", "WA_SEND_MODE", "WA_DB_URL"]) delete process.env[k];
  Object.assign(process.env, saved);
});

describe("WA hardening — the staff allow-list", () => {
  it("parses a comma list, trims, lowercases and drops blanks", () => {
    process.env.WA_STAFF_EMAILS = " A@x.com ,, b@X.COM,  ";
    expect(staffEmails()).toEqual(["a@x.com", "b@x.com"]);
  });

  it("is EMPTY when unset — the sandbox default that needs no configuration", () => {
    delete process.env.WA_STAFF_EMAILS;
    expect(staffEmails()).toEqual([]);
  });

  it("is not required in the sandbox default (mock send, DEV database)", () => {
    delete process.env.WA_SEND_MODE;
    delete process.env.WA_DB_URL;
    expect(requireStaffAllowList()).toBe(false);
  });

  it("BECOMES required the moment the backend can send for real", () => {
    process.env.WA_SEND_MODE = "live";
    expect(requireStaffAllowList()).toBe(true);
  });

  it("BECOMES required the moment the database is not the DEV default", () => {
    process.env.WA_DB_URL = "https://megustastu-bookings-default-rtdb.europe-west1.firebasedatabase.app";
    expect(requireStaffAllowList()).toBe(true);
  });

  it("an explicitly-set DEV url still counts as DEV", () => {
    process.env.WA_DB_URL = DEV_DB_URL;
    expect(requireStaffAllowList()).toBe(false);
  });
});

describe("WA hardening — what a failed staff check tells the caller", () => {
  // The distinction is not pedantry: 401 tells a human to sign in again, which
  // can never fix either of the 503 cases or the 403 one.
  it("a server misconfig is 503, not a misleading 'invalid token'", () => {
    expect(staffAuthError({ code: "NO_SERVICE_ACCOUNT", message: "m" })).toEqual({ status: 503, error: "m" });
    expect(staffAuthError({ code: "NO_STAFF_ALLOWLIST", message: "m" })).toEqual({ status: 503, error: "m" });
  });

  it("a valid token from a non-staff account is 403, not 401", () => {
    expect(staffAuthError({ code: "NOT_STAFF", message: "nope" })).toEqual({ status: 403, error: "nope" });
  });

  it("anything else is 401 and says nothing about why", () => {
    expect(staffAuthError(new Error("jwt expired")).status).toBe(401);
    expect(staffAuthError(undefined).status).toBe(401);
    expect(staffAuthError(null).error).toBe("invalid token");
  });
});

describe("WA hardening — phoneKey is sanitized at the path boundary", () => {
  it("sanitizeKey neutralises the character that RE-TARGETS a write", () => {
    // A slash does not throw. It adds a path segment, so an unsanitized value
    // writes to a different node than the one the caller named.
    expect(sanitizeKey("+34600/../../settings")).toBe("+34600_______settings");
    expect(sanitizeKey("+34600")).toBe("+34600");          // the ordinary case is untouched
    expect(sanitizeKey("a.b#c$d[e]f/g")).toBe("a_b_c_d_e_f_g");
  });

  it("no RTDB path in rtdb.js interpolates a RAW phoneKey", () => {
    // The structural half, and the one that catches a regression: seven call
    // sites build paths from phoneKey, and a rule that must be remembered seven
    // times is one that gets forgotten once. Proven against known-bad input by
    // running it on the pre-hardening source, where it reports 7.
    const src = readFileSync(new URL("../api/_lib/rtdb.js", import.meta.url), "utf8");
    const raw = [...src.matchAll(/ref\("(?:conversations|messages)\/" \+ (\w+)/g)]
      .map((m) => m[1])
      .filter((name) => name === "phoneKey");
    expect(raw).toEqual([]);
    // …and the sanitized form really is present at every one of them.
    expect((src.match(/sanitizeKey\(phoneKey\)/g) || []).length).toBe(7);
  });
});
