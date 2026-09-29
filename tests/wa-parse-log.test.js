// tests/wa-parse-log.test.js — v18.3.1
//
// The Gemini parse log carries no guest content outside a sandbox (SECURITY.md
// §3). Driven through the real parseMessage in MOCK mode, the production
// default, because that is the case a mode-keyed rule would have let through.
import { describe, it, expect, vi, afterEach } from "vitest";
import process from "node:process";
import { parseMessage, parseLogFields } from "../api/_lib/gemini.js";

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

  it("parseLogFields keeps the plain fields and names the filled content ones", () => {
    const parsed = { intent: "booking", name: "Lucía", size: 4, date: "2026-10-01", time: "21:00", notes: "shellfish allergy", preference: "indoor", language: "es", confidence: "high", ambiguity: null };
    expect(parseLogFields(parsed, false)).toEqual({ intent: "booking", language: "es", confidence: "high", preference: "indoor", filled: ["name", "size", "date", "time", "notes"] });
    expect(parseLogFields(parsed, true)).toBe(parsed);
    expect(parseLogFields(null, false)).toBe(null);
  });
});
