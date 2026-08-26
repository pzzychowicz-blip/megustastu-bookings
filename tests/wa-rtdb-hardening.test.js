// tests/wa-rtdb-hardening.test.js
//
// The ROADMAP "WhatsApp sandbox hardening" items, scoped to this branch because
// `_lib/rtdb.js` exists only here. Required before the sandbox ever points at
// PROD or goes WA_SEND_MODE=live.
//
// What makes this worth a test rather than a comment: the failure is invisible.
// An unsanitized path segment does not throw — it writes somewhere else.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { sanitizeKey } from "../api/_lib/rtdb.js";

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
