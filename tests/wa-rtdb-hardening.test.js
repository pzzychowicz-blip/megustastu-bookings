// tests/wa-rtdb-hardening.test.js
//
// The two ROADMAP "WhatsApp sandbox hardening" items, which were scoped to this
// branch because `verifyStaffToken` and `_lib/rtdb.js` exist only here. Both are
// required before the sandbox ever points at PROD or goes WA_SEND_MODE=live.
//
// What makes them worth a test rather than a comment: neither failure is
// visible. An absent allow-list looks exactly like a working backend, and an
// unsanitized path segment does not throw — it writes somewhere else.

import { describe, it, expect, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { stripComments } from "../scripts/strip-comments.mjs";
import { staffEmails, requireStaffAllowList } from "../api/_lib/env.js";
import { sanitizeKey, staffAuthError, assertStaffAllowed } from "../api/_lib/rtdb.js";
import { conversationDeletePatch } from "../src/lib/whatsapp.js";

const DEV_DB_URL = "https://megustastu-bookings-dev-default-rtdb.europe-west1.firebasedatabase.app";

// vi.stubEnv rather than touching process.env directly: these files are the
// first tests in the repo to need an environment variable, and reaching for the
// `process` global here would have meant widening eslint's node-globals block
// from `api/**` to `tests/**` — a lint-config change to serve one test file.
// The stub API does the same job and unwinds itself.
afterEach(() => { vi.unstubAllEnvs(); });

describe("WA hardening — the staff allow-list", () => {
  it("parses a comma list, trims, lowercases and drops blanks", () => {
    vi.stubEnv("WA_STAFF_EMAILS", " A@x.com ,, b@X.COM,  ");
    expect(staffEmails()).toEqual(["a@x.com", "b@x.com"]);
  });

  it("is EMPTY when unset — the sandbox default that needs no configuration", () => {
    vi.stubEnv("WA_STAFF_EMAILS", "");
    expect(staffEmails()).toEqual([]);
  });

  it("is not required in the sandbox default (mock send, DEV database)", () => {
    vi.stubEnv("WA_SEND_MODE", "");
    vi.stubEnv("WA_DB_URL", "");
    expect(requireStaffAllowList()).toBe(false);
  });

  it("BECOMES required the moment the backend can send for real", () => {
    vi.stubEnv("WA_SEND_MODE", "live");
    expect(requireStaffAllowList()).toBe(true);
  });

  it("BECOMES required the moment the database is not the DEV default", () => {
    vi.stubEnv("WA_DB_URL", "https://megustastu-bookings-default-rtdb.europe-west1.firebasedatabase.app");
    expect(requireStaffAllowList()).toBe(true);
  });

  it("an explicitly-set DEV url still counts as DEV", () => {
    vi.stubEnv("WA_DB_URL", DEV_DB_URL);
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


describe("WA hardening — who actually gets in", () => {
  // The decision itself, which until now had no test at all: it lived inside
  // verifyStaffToken, welded to getAuth().verifyIdToken, so every branch that
  // stands between a stranger with a Firebase account and the send/Gemini
  // endpoints was unreachable. `assertStaffAllowed` is that decision, pure.
  const staff = { uid: "u1", email: "PZ@Example.com", email_verified: true };

  it("no allow-list in the sandbox default lets any signed-in account through", () => {
    vi.stubEnv("WA_STAFF_EMAILS", "");
    expect(assertStaffAllowed(staff)).toBe(staff);
  });

  it("no allow-list on a LIVE backend refuses every request", () => {
    vi.stubEnv("WA_STAFF_EMAILS", "");
    vi.stubEnv("WA_SEND_MODE", "live");
    expect(() => assertStaffAllowed(staff)).toThrow(/WA_STAFF_EMAILS is not configured/);
    try { assertStaffAllowed(staff); } catch (e) { expect(e.code).toBe("NO_STAFF_ALLOWLIST"); }
  });

  it("no allow-list on a non-DEV database refuses every request", () => {
    vi.stubEnv("WA_STAFF_EMAILS", "");
    vi.stubEnv("WA_DB_URL", "https://megustastu-bookings-default-rtdb.europe-west1.firebasedatabase.app");
    try { assertStaffAllowed(staff); expect.unreachable(); }
    catch (e) { expect(e.code).toBe("NO_STAFF_ALLOWLIST"); }
  });

  it("matches the allow-list case-insensitively", () => {
    vi.stubEnv("WA_STAFF_EMAILS", "pz@example.com");
    expect(assertStaffAllowed(staff)).toBe(staff);
  });

  it("refuses an account that is NOT on the list", () => {
    vi.stubEnv("WA_STAFF_EMAILS", "someone@else.com");
    try { assertStaffAllowed(staff); expect.unreachable(); }
    catch (e) { expect(e.code).toBe("NOT_STAFF"); }
  });

  it("refuses a token carrying no email at all", () => {
    vi.stubEnv("WA_STAFF_EMAILS", "pz@example.com");
    try { assertStaffAllowed({ uid: "u2" }); expect.unreachable(); }
    catch (e) { expect(e.code).toBe("NOT_STAFF"); }
  });

  it("refuses an UNVERIFIED address that IS on the list — and says so", () => {
    // The ship-day trap: a Firebase-console account has emailVerified=false, and
    // the allow-list is first enforced the day WA_SEND_MODE goes live. A shared
    // "not on the allow-list" message would be a lie about an address the
    // operator can see on the list, and would send them to fix the wrong thing.
    vi.stubEnv("WA_STAFF_EMAILS", "pz@example.com");
    try { assertStaffAllowed({ ...staff, email_verified: false }); expect.unreachable(); }
    catch (e) {
      expect(e.code).toBe("EMAIL_UNVERIFIED");
      expect(e.message).toMatch(/not verified/);
      expect(e.message).not.toMatch(/not on the WhatsApp staff allow-list/);
    }
  });

  it("a token with email_verified absent still passes (not `=== false`)", () => {
    // Custom tokens and some providers omit the claim; only an explicit false
    // is a statement that the address is unproven.
    vi.stubEnv("WA_STAFF_EMAILS", "pz@example.com");
    expect(assertStaffAllowed({ uid: "u3", email: "pz@example.com" })).toBeTruthy();
  });

  it("both 403 causes map to 403, with their own messages preserved", () => {
    expect(staffAuthError({ code: "EMAIL_UNVERIFIED", message: "unverified" }))
      .toEqual({ status: 403, error: "unverified" });
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
    // Comments off (v18.0.0 phase 5): this greps the module for the write
    // helpers it must use, and the header comment names every one of them.
    const src = stripComments(readFileSync(new URL("../api/_lib/rtdb.js", import.meta.url), "utf8")).join("\n");
    const raw = [...src.matchAll(/ref\("(?:conversations|messages)\/" \+ (\w+)/g)]
      .map((m) => m[1])
      .filter((name) => name === "phoneKey");
    expect(raw).toEqual([]);
    // …and the sanitized form really is present at every one of them.
    // 8 since v18.8.0: `getMessage`, the message api/wa-media.js reads a media id from.
    // 11 since phase 7: the prune's `readMessageNode`, `removeConversationIf` and
    // `removeMessages` (its keys come from the stored node, which they leave as is).
    // 12 since the /code-review: `readOldMessages`, the prune's query on `ts`.
    // 14 since v18.9.0: `findMessageByWamid` (an edit or a delete finds its
    // message) and `updateMessage` (and patches it).
    expect((src.match(/sanitizeKey\(phoneKey\)/g) || []).length).toBe(14);
  });
});

// v18.8.0 /code-review: the inbox's Delete was two writes, the conversation row
// and then its messages, and messages whose row is gone are reached by nothing
// (the inbox and the nightly prune both find a thread through its row).
describe("WA hardening — a deleted conversation takes its messages in the same write", () => {
  it("one patch holds both halves of every key, and nothing else", () => {
    expect(conversationDeletePatch(["+34600111222", "+44700900123"])).toEqual({
      "conversations/+34600111222": null, "messages/+34600111222": null,
      "conversations/+44700900123": null, "messages/+44700900123": null,
    });
  });
  it("skips a key that is not one path segment, and never names a whole node", () => {
    const patch = conversationDeletePatch(["", "a/b", "a.b", "a#b", "a$b", "a[b", "a]b", null, 7, undefined]);
    expect(patch).toEqual({});
    expect(conversationDeletePatch(null)).toEqual({});
  });
  it("every delete in the hook goes through it, as one update at the root", () => {
    const hook = stripComments(readFileSync(new URL("../src/hooks/useWhatsApp.js", import.meta.url), "utf8")).join("\n");
    // No single-half delete is left to call.
    expect(hook).not.toMatch(/set\(ref\(db, "(conversations|messages)\/" \+ \w+\), null\)/);
    expect(hook).not.toMatch(/function remove(Conversation|Messages)\b/);
    const body = (name) => {
      const i = hook.indexOf("function " + name + "(");
      expect(i, name).toBeGreaterThan(-1);
      return hook.slice(i, hook.indexOf("\n  }\n", i));
    };
    for (const name of ["deleteConversations", "eraseConversation", "clearAllWaData"]) {
      expect(body(name), name).toContain("conversationDeletePatch(");
      expect(body(name), name).toMatch(/update\(ref\(db\), (patch|conversationDeletePatch\()/);
    }
    expect(body("bulkDeleteConversations")).toContain("deleteConversations(keys)");
    expect(body("doDeleteConversation")).toContain("deleteConversations([phoneKey])");
  });
});
