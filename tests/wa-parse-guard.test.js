// tests/wa-parse-guard.test.js
//
// v18.0.0 phase 6 — the WhatsApp crash test's two data-integrity findings,
// pinned. Both are about the same thing: the LLM's answer is the one piece of
// this app's data a CUSTOMER's own words influence, and Gemini's responseSchema
// constrains the JSON *type* of each field and nothing else. "YYYY-MM-DD" and
// "HH:MM 24h" are descriptions in that schema, not constraints, so
// "next tuesday" and "8 in the evening" are schema-valid answers.
//
// CT-WA-01 — measured live on 2026-09-10 against the running DEV app: a draft
// carrying `time: "8 in the evening"` was accepted through the booking form and
// landed in /bookings verbatim (the rules pin `date` and deliberately do not pin
// `time`), after which `sanitize`'s own fallback rendered it as 13:00 on every
// screen. A party that asked for the evening reads as booked for lunch.
//
// CT-WA-03 — the draft card labelled "5000 pax · next tuesday · 8 in the
// evening" HIGH confidence, because clampConfidence counted a field as present
// when it was non-empty rather than when the app could use it.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { stripComments } from "../scripts/strip-comments.mjs";
import { inboundTs } from "../api/wa-inbound.js";
import { isPhoneKey, statusWins } from "../src/lib/whatsapp.js";
import { sanitizeParse, clampConfidence, isUsableSize, isUsableDate, isUsableTime, mergeDraft } from "../src/lib/whatsapp.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => stripComments(readFileSync(join(ROOT, p), "utf8")).join("\n");

// Exactly what the crash test drove through __waSim.custom(): every field the
// right JSON type, every field nonsense.
const HOSTILE = {
  intent: "new_booking", name: "Ana", size: 5000, date: "next tuesday",
  time: "8 in the evening", notes: "", preference: "auto",
  language: "es", confidence: "high", ambiguity: null,
};

describe("CT-WA-01 — a schema-valid nonsense parse cannot reach a booking", () => {
  it("nulls a date the app cannot step", () => {
    expect(sanitizeParse(HOSTILE).date).toBe(null);
  });
  it("nulls a time the app cannot take apart", () => {
    expect(sanitizeParse(HOSTILE).time).toBe(null);
  });
  it("nulls a size that is not a whole number of people", () => {
    expect(sanitizeParse(Object.assign({}, HOSTILE, { size: -7 })).size).toBe(null);
    expect(sanitizeParse(Object.assign({}, HOSTILE, { size: 2.5 })).size).toBe(null);
    expect(sanitizeParse(Object.assign({}, HOSTILE, { size: 0 })).size).toBe(null);
    expect(sanitizeParse(Object.assign({}, HOSTILE, { size: "4" })).size).toBe(null);
  });
  it("leaves a REAL parse completely untouched — nothing working may move", () => {
    const good = { intent: "new_booking", name: "Ana", size: 4, date: "2026-09-10", time: "21:00", notes: "alergia", preference: "outdoor", language: "es", confidence: "high", ambiguity: null };
    expect(sanitizeParse(good)).toEqual(good);
  });
  it("keeps the shapes the app already accepts elsewhere", () => {
    // isReadableTime's stated cost (v17.16.5) and isReadableDate's (v17.16.11):
    // these render and navigate today, so they must keep doing so.
    expect(sanitizeParse(Object.assign({}, HOSTILE, { time: "9:30" })).time).toBe("9:30");
    expect(sanitizeParse(Object.assign({}, HOSTILE, { date: "2026-8-3" })).date).toBe("2026-8-3");
  });
  it("passes null/undefined straight through — an LLM failure is not a draft", () => {
    expect(sanitizeParse(null)).toBe(null);
    expect(sanitizeParse(undefined)).toBe(undefined);
  });
  it("does not narrow the free-text or enum fields — they are gated elsewhere", () => {
    const out = sanitizeParse(Object.assign({}, HOSTILE, { name: "x".repeat(500), intent: "DROP TABLE" }));
    expect(out.name.length).toBe(500);
    expect(out.intent).toBe("DROP TABLE"); // applyParse's enum test refuses it
  });
  it("the predicates are the CONSUMERS' requirements, not formats", () => {
    expect(isUsableTime("13:00")).toBe(true);
    expect(isUsableTime("8 in the evening")).toBe(false);
    expect(isUsableTime(2000)).toBe(false);       // the v17.16.5 shape, one door up
    expect(isUsableDate("2026-09-10")).toBe(true);
    expect(isUsableDate("")).toBe(false);
    expect(isUsableSize(1)).toBe(true);
    expect(isUsableSize(20)).toBe(true);
  });
});

describe("CT-WA-03 — confidence counts what the app can USE, not what is non-empty", () => {
  it("the measured draft no longer reads HIGH", () => {
    expect(clampConfidence("high", { size: 5000, date: "next tuesday", time: "8 in the evening" })).toBe("low");
  });
  it("one unusable field is medium, two are low", () => {
    expect(clampConfidence("high", { size: 4, date: "2026-09-10", time: "not a time" })).toBe("medium");
    expect(clampConfidence("high", { size: 4, date: "whenever", time: "not a time" })).toBe("low");
  });
  it("a complete, usable draft is still HIGH — the pre-fix behaviour holds", () => {
    expect(clampConfidence("high", { size: 4, date: "2026-09-10", time: "21:00" })).toBe("high");
  });
  it("an ambiguity note still costs one, and the stated value is still the ceiling", () => {
    expect(clampConfidence("high", { size: 4, date: "2026-09-10", time: "21:00", ambiguity: "evening?" })).toBe("medium");
    expect(clampConfidence("low", { size: 4, date: "2026-09-10", time: "21:00" })).toBe("low");
  });
  it("mergeDraft inherits it — a merged draft cannot claim more than its fields support", () => {
    const merged = mergeDraft(
      { intent: "new_booking", size: null, date: "2026-09-10", time: "21:00", confidence: "medium" },
      { intent: "new_booking", size: 5000, date: null, time: null, confidence: "high" },
    );
    expect(merged.size).toBe(5000);          // merge is mechanical; the guard is upstream
    expect(merged.confidence).toBe("high");  // …and by then every field is usable
  });
});

// ── The WIRING, not just the function ───────────────────────────────────────
// The pure tests above pass whether or not anything CALLS sanitizeParse —
// proven: deleting the call from draftPatchFromParse leaves all 33 WA tests
// green. So the two draft builders and doSave's own gate are scanned, the way
// tests/booking-logic.test.js scans the consumers of isReadableBlock. A boundary
// nothing crosses is not a boundary.
describe("CT-WA-01 — the boundary is actually crossed", () => {
  it("the server's draftPatchFromParse sanitizes before it builds a draft", () => {
    const src = read("api/_lib/inbound-core.js");
    const body = src.slice(src.indexOf("function draftPatchFromParse"));
    const build = body.indexOf("const draftData");
    expect(build).toBeGreaterThan(-1);
    expect(body.slice(0, build)).toMatch(/sanitizeParse\s*\(/);
  });
  it("the client simulator sanitizes the parse it is handed", () => {
    const src = read("src/lib/wa-sim.js");
    const body = src.slice(src.indexOf("export function simulateInbound"));
    const build = body.indexOf("draftData = {");
    expect(build).toBeGreaterThan(-1);
    expect(body.slice(0, build)).toMatch(/sanitizeParse\s*\(/);
  });
  it("doSave refuses an unreadable time BEFORE it computes with one", () => {
    const src = read("src/App.jsx");
    const body = src.slice(src.indexOf("function doSave()"));
    const guard = body.indexOf("isReadableTime(f.time)");
    const use = body.indexOf("toMins(f.time)");
    expect(guard).toBeGreaterThan(-1);
    expect(use).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(use);
  });
});

// ── CT-WA-02 ────────────────────────────────────────────────────────────────
// The webhook trusted `m.timestamp` as seconds-since-epoch. Measured against the
// emulator with correctly-signed payloads: "abc" → NaN → RTDB refuses the write
// → the handler answers 500 → Meta redelivers for up to seven days, identically,
// and the customer's message is never stored. "-1" → a window that expired in
// 1970, so staff can never reply. 99999999999 → a window in the year 5138.
describe("CT-WA-02 — a Meta timestamp is not a number until it is checked", () => {
  it("keeps a real timestamp, faithfully", () => {
    // Derived from the live clock, never a literal: this repo has already lost a
    // day to a fixture that was in the future when it was written and in the past
    // by the time it ran (tests/reconcile.test.js, 2026-09-02). Here the trap is
    // the mirror image — a literal that LOOKS past is future relative to `now`
    // and gets clamped, which is exactly what caught this line on its first run.
    const t = Math.floor(Date.now() / 1000) - 60;
    expect(inboundTs(String(t))).toBe(t * 1000);
    expect(inboundTs(t)).toBe(t * 1000);
  });
  it("falls back to now rather than writing NaN", () => {
    const before = Date.now();
    for (const bad of ["abc", "", "  ", null, undefined, {}, [], "NaN"]) {
      const out = inboundTs(bad);
      expect(Number.isFinite(out)).toBe(true);
      expect(out).toBeGreaterThanOrEqual(before);
    }
  });
  it("refuses a non-positive timestamp — the window must not expire in 1970", () => {
    const before = Date.now();
    for (const bad of ["-1", "0", -99999]) expect(inboundTs(bad)).toBeGreaterThanOrEqual(before);
  });
  it("clamps the future to now — a delivery cannot predate its own arrival", () => {
    const after = Date.now() + 1;
    expect(inboundTs("99999999999")).toBeLessThanOrEqual(after);
  });
  it("leaves an OLD timestamp alone — a Meta redelivery after an outage is real", () => {
    expect(inboundTs("1600000000")).toBe(1600000000000);
  });
});

// ── CT-WA-04 ────────────────────────────────────────────────────────────────
// `normalizePhone("+")` is `"+"` — truthy, a legal RTDB key, nobody's number.
// processInbound guarded only `if (!phoneKey)`; api/wa-recheck.js had already
// written the fuller test by hand, so the rule lived in ONE of the two places
// that build a conversation key. Measured against the emulator with a
// correctly-signed payload: a message carrying no `from` created a whole
// conversation at key "+", and `messages: "abc"` — a string where Meta sends an
// array — was iterated by `for...of` one character at a time, answering 200 with
// `messages: 3`.
describe("CT-WA-04 — a conversation key has to identify somebody", () => {
  it('refuses "+", which is what a message with no `from` normalises to', () => {
    expect(isPhoneKey("+")).toBe(false);
    expect(isPhoneKey("")).toBe(false);
    expect(isPhoneKey(null)).toBe(false);
    expect(isPhoneKey(undefined)).toBe(false);
  });
  it("accepts the keys the module actually writes", () => {
    expect(isPhoneKey("+34600111222")).toBe(true);
    expect(isPhoneKey("34600111222")).toBe(true);   // no "+" is legal — Meta sends bare digits
  });
  it("refuses anything normalisation would change — the round-trip rule", () => {
    for (const bad of ["+34 600 111 222", "+34-600-111", "conversations/x", "+34600111222 ", "abc"]) {
      expect(isPhoneKey(bad)).toBe(false);
    }
  });
  it("is the rule wa-recheck wrote by hand, and both endpoints use it now", () => {
    const core = read("api/_lib/inbound-core.js");
    const recheck = read("api/wa-recheck.js");
    expect(core).toMatch(/isPhoneKey\(/);
    expect(recheck).toMatch(/isPhoneKey\(/);
    // The hand-written half must be gone, or there are two rules again.
    expect(recheck).not.toMatch(/phoneKey === "\+"/);
  });
  it("the webhook checks the SHAPE of every envelope array, not just two of five", () => {
    const src = read("api/wa-inbound.js");
    for (const field of ["entry", "changes", "messages", "statuses", "contacts"]) {
      expect(src).toMatch(new RegExp("Array\\.isArray\\((payload|entry|value)\\." + field + "\\)"));
    }
    // `for...of value.messages || []` iterates a STRING one character at a time.
    expect(src).not.toMatch(/of\s+value\.(messages|statuses)\s*\|\|/);
  });
});

// ── CT-WA-05 ────────────────────────────────────────────────────────────────
// Meta does not guarantee `statuses[]` ordering and the receipt was written with
// a bare set(). Measured against the emulator: `read` then `delivered` left the
// bubble reading "delivered" for a message the customer had already read.
describe("CT-WA-05 — a delivery receipt may not go backwards", () => {
  it("refuses the measured downgrade", () => {
    expect(statusWins("delivered", "read")).toBe(false);
    expect(statusWins("sent", "delivered")).toBe(false);
  });
  it("accepts the ordinary forward path", () => {
    expect(statusWins("sent", "sending")).toBe(true);
    expect(statusWins("delivered", "sent")).toBe(true);
    expect(statusWins("read", "delivered")).toBe(true);
  });
  it("lets `failed` through and never buries it", () => {
    expect(statusWins("failed", "read")).toBe(true);
    expect(statusWins("delivered", "failed")).toBe(false);
  });
  it("accepts a status this app has never heard of, either side", () => {
    expect(statusWins("deleted", "read")).toBe(true);
    expect(statusWins("read", "deleted")).toBe(true);
  });
  it("a repeat of the same receipt is not a downgrade", () => {
    expect(statusWins("read", "read")).toBe(true);
    expect(statusWins("sent", undefined)).toBe(true);
  });
  it("rtdb.js actually asks before it writes", () => {
    const src = read("api/_lib/rtdb.js");
    const body = src.slice(src.indexOf("export async function updateMessageStatusByWamid"));
    const guard = body.indexOf("statusWins(");
    const write = body.indexOf('"/status").set(status)');
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(write);
  });
});
