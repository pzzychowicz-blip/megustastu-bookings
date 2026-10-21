// tests/wa-parse-log.test.js — v18.3.1
//
// The Gemini parse log carries no guest content outside a sandbox (SECURITY.md
// §3). Driven through the real parseMessage in MOCK mode, the production
// default, because that is the case a mode-keyed rule would have let through.
import { describe, it, expect, vi, afterEach } from "vitest";
import process from "node:process";
import { parseMessage, parseThread, parseLogFields } from "../api/_lib/gemini.js";

const MSG = "Mesa para 4 mañana a las 21:00, alergia al marisco, soy Lucía Pérez";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); delete process.env.WA_SIM_ENABLED; delete process.env.WA_LLM_MODE; delete process.env.GEMINI_API_KEY; });

async function logged() {
  const spy = vi.spyOn(console, "log").mockImplementation(() => {});
  await parseMessage(MSG, {});
  const lines = spy.mock.calls.map((c) => c.join(" ")).filter((l) => l.startsWith("[wa-parse:"));
  expect(lines).toHaveLength(1);
  return lines[0];
}

describe("the parse log", () => {
  it("outside a sandbox (mock mode, the default) logs no message text", async () => {
    const line = await logged();
    expect(line).not.toMatch(/marisco|Lucía|Mesa para/);
    expect(line).toContain('"len":' + MSG.length);
    expect(line).toMatch(/"filled":\[/);
  });

  it("in a sandbox keeps the text and the full result", async () => {
    process.env.WA_SIM_ENABLED = "1";
    const line = await logged();
    expect(line).toContain("alergia al marisco");
  });

  // /code-review: the live parser's error line. V8's SyntaxError quotes the
  // start of the text it could not parse, i.e. the model's reply about the guest.
  it("a reply that is not JSON is logged without its text", async () => {
    process.env.WA_LLM_MODE = "live";
    process.env.GEMINI_API_KEY = "test-key";
    const reply = "Lucía Pérez, alergia al marisco";
    vi.stubGlobal("fetch", async () => ({ ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: reply }] } }] }) }));
    vi.spyOn(console, "log").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await parseMessage(MSG, {});
    const lines = warn.mock.calls.map((c) => c.join(" ")).filter((l) => l.startsWith("[gemini]"));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("not valid JSON");
    expect(lines[0]).not.toMatch(/Luc|marisco/);
  });

  // v18.9.2: the time per parse, for the go-live plan's A5-7, and only when
  // Gemini was really called (/code-review). The fetch is held for DELAY ms, so
  // a timer that does not wrap the call (started after it, or read before it)
  // logs less than DELAY and fails.
  //
  // The hold is DELAY + 5, not DELAY: the timer runs on libuv's whole-millisecond
  // monotonic clock and gemini.js times with Date.now(), the wall clock, whose
  // millisecond boundaries fall elsewhere. A true 60 ms hold logged 59 once in CI
  // (PR #152), so a bare DELAY hold could fail with the timer correctly placed. A
  // timer that does not wrap the call logs ~0, so the slack hides nothing.
  const DELAY = 60;
  const slowGemini = () => vi.stubGlobal("fetch", async () => {
    await new Promise((r) => setTimeout(r, DELAY + 5));
    return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: "{}" }] } }] }) };
  });
  const msOf = (line) => { const m = line.match(/"ms":(\d+)/); return m ? Number(m[1]) : null; };

  it("times a live Gemini call, in both shapes of the line", async () => {
    process.env.WA_LLM_MODE = "live";
    process.env.GEMINI_API_KEY = "test-key";
    slowGemini();
    expect(msOf(await logged())).toBeGreaterThanOrEqual(DELAY);
    vi.restoreAllMocks();
    slowGemini();
    process.env.WA_SIM_ENABLED = "1";
    expect(msOf(await logged())).toBeGreaterThanOrEqual(DELAY);
  });
  // /code-review: the Re-check's transcript parse, the longest prompt, is timed too.
  it("times a live Re-check of a whole thread, and not a mock one", async () => {
    const thread = [{ direction: "in", text: MSG }, { direction: "out", text: "¿Para cuántos?" }, { direction: "in", text: "Somos 4" }];
    const recheckLine = async () => {
      const spy = vi.spyOn(console, "log").mockImplementation(() => {});
      await parseThread(thread, {});
      const lines = spy.mock.calls.map((c) => c.join(" ")).filter((l) => l.startsWith("[wa-recheck:"));
      expect(lines).toHaveLength(1);
      return lines[0];
    };
    expect(msOf(await recheckLine())).toBe(null);
    vi.restoreAllMocks();
    process.env.WA_LLM_MODE = "live";
    process.env.GEMINI_API_KEY = "test-key";
    slowGemini();
    expect(msOf(await recheckLine())).toBeGreaterThanOrEqual(DELAY);
  });
  it("logs no ms when no model was called: mock mode, or live with no key", async () => {
    expect(msOf(await logged())).toBe(null);
    vi.restoreAllMocks();
    process.env.WA_LLM_MODE = "live";
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(msOf(await logged())).toBe(null);
  });

  it("parseLogFields keeps the plain fields and names the filled content ones", () => {
    const parsed = { intent: "booking", name: "Lucía", size: 4, date: "2026-10-01", time: "21:00", notes: "shellfish allergy", preference: "indoor", language: "es", confidence: "high", ambiguity: null };
    expect(parseLogFields(parsed, false)).toEqual({ intent: "booking", language: "es", confidence: "high", preference: "indoor", filled: ["name", "size", "date", "time", "notes"] });
    expect(parseLogFields(parsed, true)).toBe(parsed);
    expect(parseLogFields(null, false)).toBe(null);
  });
});
