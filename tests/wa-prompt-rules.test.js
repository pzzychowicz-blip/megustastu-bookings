// tests/wa-prompt-rules.test.js — v18.10.0
//
// The three prompt rules A5-7's live run asked for (Patryk, 2026-10-18): an
// approximate time with a number gets that hour, a hedged party size gets the
// larger number, both at low confidence, and the ambiguity note is written in
// the customer's language. What the model DOES with them is measured live on
// the sandbox (the go-live page's A5-7); this holds that the rules reach the
// request, in both prompts the backend sends: one message, and a staff
// Re-check's transcript. Read from the request body the real parse builds,
// not from the source, so a rule that is written but never sent fails.
import { describe, it, expect, vi, afterEach } from "vitest";
import process from "node:process";
import { parseMessage, parseThread, hoursLineOf } from "../api/_lib/gemini.js";
import { SCENARIOS } from "../src/lib/wa-sim-scenarios.js";

// A scenario's only call is simulateInbound; the stub hands its first argument
// to the test instead of writing anything.
vi.mock("../src/lib/wa-sim", () => ({ simulateInbound: (args, ctx) => ctx && ctx.__capture && ctx.__capture(args) }));

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); delete process.env.WA_LLM_MODE; delete process.env.GEMINI_API_KEY; });

async function promptOf(run) {
  process.env.WA_LLM_MODE = "live";
  process.env.GEMINI_API_KEY = "test-key";
  let sent = null;
  vi.stubGlobal("fetch", async (url, init) => {
    sent = JSON.parse(init.body).contents[0].parts[0].text;
    return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: "{}" }] } }] }) };
  });
  vi.spyOn(console, "log").mockImplementation(() => {});
  await run();
  expect(sent).not.toBe(null);
  return sent;
}

const RULES = [
  /approximate time WITH a number[^\n]*that hour[^\n]*confidence low/,
  /time with NO number[^\n]*null time/,
  /hedged party size[^\n]*the LARGER number, confidence low, and ambiguity names both numbers/,
  /ambiguity:[^\n]*SAME language as the customer's message/,
];

describe("the prompt rules for hedged times and sizes", () => {
  it("reach a single message's prompt", async () => {
    const p = await promptOf(() => parseMessage("dinner tomorrow around 8, 4 of us maybe 5", {}));
    RULES.forEach((r) => expect(p).toMatch(r));
    // The never-invent rule stays, and says a hedged number is not an invention.
    expect(p).toMatch(/NEVER invent or guess[^\n]*IS stated/);
  });
  it("reach a Re-check's transcript prompt", async () => {
    const p = await promptOf(() => parseThread([{ direction: "in", text: "Para 2 el jueves, sobre las nueve" }], {}));
    RULES.forEach((r) => expect(p).toMatch(r));
  });
});

// v18.10.0 /code-review: the special days share settings/operatingHours, and the
// prompt's line says "per weekday", so they stay out of it.
describe("the hours line", () => {
  const node = {
    days: { 0: { open: 13, close: 22, closed: false } },
    exceptions: { a1: { from: "2026-12-24", to: "2026-12-26", closed: false, open: 18, close: 23, note: "Christmas" } },
  };
  it("carries the weekdays and not the special days", () => {
    const line = hoursLineOf(node);
    expect(line).toMatch(/per weekday/);
    expect(line).toContain('"days"');
    expect(line).not.toMatch(/exceptions|Christmas|2026-12-24/);
    expect(node.exceptions.a1.note).toBe("Christmas"); // the node itself is untouched
    expect(hoursLineOf(null)).toBe(null);
  });
  it("is the line both prompts use", async () => {
    const one = await promptOf(() => parseMessage("mesa para 2", { hours: node }));
    const thread = await promptOf(() => parseThread([{ direction: "in", text: "mesa para 2" }], { hours: node }));
    [one, thread].forEach((p) => { expect(p).toContain(hoursLineOf(node)); expect(p).not.toMatch(/Christmas/); });
  });
});

// The simulator's canned parses stand in for the model in mock mode, so they
// follow the same rules: the scenarios that hedge show what the live run is
// now expected to return.
describe("the simulator's canned parses follow the rules", () => {
  const parseOf = (id) => {
    const s = SCENARIOS.find((x) => x.id === id);
    expect(s).toBeTruthy();
    let got = null;
    s.run({ __capture: (a) => { got = a; } });
    return got;
  };
  it("a hedged size is the larger number, at low confidence", () => {
    expect(parseOf("new_en_low").parse).toMatchObject({ size: 3, time: "20:00", confidence: "low" });
    expect(parseOf("nb_en_sizefuzzy").parse).toMatchObject({ size: 5, time: "20:00", confidence: "low" });
  });
  it("an approximate time with a number is that hour, low, with a note in the message's language", () => {
    const es = parseOf("nb_es_timefuzzy");
    expect(es.parse).toMatchObject({ time: "21:00", confidence: "low" });
    expect(es.parse.ambiguity).toMatch(/^Hora aproximada/);
    expect(parseOf("nb_es_tonight3").parse).toMatchObject({ time: "20:30", confidence: "low" });
  });
  it("a time with no number stays empty", () => {
    expect(parseOf("lg_20_over").parse).toMatchObject({ size: 20, time: null });
  });
});
