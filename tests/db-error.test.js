// tests/db-error.test.js — v17.16.13
//
// `describeWriteError` exists because the two write catches in this app both
// stated a cause nothing had checked. usePersistence's took no argument at all
// and hard-coded "stale per-booking revision"; revGuard's had `err` in hand and
// still hard-coded "stale revision". Diagnosing the v15.6.1 reconciliation
// oscillation meant re-instrumenting that catch to see `PERMISSION_DENIED` at
// all — the app was busy blaming a revision for what turned out to be a create
// refused for its `baseUpdatedAt`.
//
// The property under test is therefore NOT "it says the right cause" — RTDB
// collapses every rule refusal into one code and the error carries nothing that
// separates them. It is: **it never names a single cause it cannot know.**
import { describe, it, expect } from "vitest";
import { describeWriteError } from "../src/lib/dbError.js";

describe("describeWriteError", () => {
  it("names the path, the code and the SDK's own message", () => {
    const out = describeWriteError("bookings", { code: "PERMISSION_DENIED", message: "Permission denied" });
    expect(out).toContain("bookings");
    expect(out).toContain("PERMISSION_DENIED");
    expect(out).toContain("Permission denied");
  });

  it("enumerates the causes of PERMISSION_DENIED rather than picking one", () => {
    const out = describeWriteError("bookings", { code: "PERMISSION_DENIED", message: "x" });
    expect(out).toMatch(/baseUpdatedAt/);
    expect(out).toMatch(/\.validate/);
    expect(out).toMatch(/not been deployed/);
    // The regression this guards: a sentence asserting ONE of them.
    expect(out).not.toMatch(/rejected by server \(stale/);
  });

  it("does not enumerate rule causes for a non-rule failure", () => {
    const out = describeWriteError("waitlist", { code: "NETWORK_ERROR", message: "offline" });
    expect(out).toContain("NETWORK_ERROR");
    expect(out).not.toMatch(/Security Rule/);
  });

  it("survives an error that is not an object, and never throws", () => {
    expect(describeWriteError("reminders", undefined)).toContain("unknown");
    expect(describeWriteError("reminders", "boom")).toContain("boom");
    expect(describeWriteError("reminders", null)).toContain("reminders");
  });
});
