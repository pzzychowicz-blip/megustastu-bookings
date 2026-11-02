// tests/gemini-overload.test.js
//
// v18.14.1 — a Gemini overload. Measured on the sandbox on 2026-11-02: five
// calls of five failed on gemini-3.5-flash-lite (one 503 "high demand", four
// timeouts), the simulator's buttons answered a bare 500, and a Re-check that
// could not read a thread said "Nothing outstanding". `fetch` is the only thing
// stubbed here, so askGemini, its timer and its callers are the real ones.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { parseMessage, parseThread, generateCustomerReply, generateScenarioMessage } from "../api/_lib/gemini.js";
import { DEFAULT_MODEL, FALLBACK_MODEL } from "../api/_lib/env.js";

const KEY = "test-key-never-printed";
const reply = (text) => ({ candidates: [{ content: { parts: [{ text }] } }] });
const http = (status, body) => new Response(JSON.stringify(body), { status });
const booking = reply(JSON.stringify({ intent: "new_booking", size: 4, language: "es", confidence: "high" }));
const busy = () => http(503, { error: { message: "This model is currently experiencing high demand." } });
// What fetch does when askGemini's timer fires: a real AbortError.
const stalls = (url, opts) => new Promise((_, reject) => {
  opts.signal.addEventListener("abort", () => reject(Object.assign(new Error("This operation was aborted"), { name: "AbortError" })));
});

// One answer per attempt, in order; the models asked, read off the URLs.
function answers(...steps) {
  const f = vi.fn((url, opts) => {
    const step = steps[Math.min(f.mock.calls.length - 1, steps.length - 1)];
    return typeof step === "function" ? step(url, opts) : Promise.resolve(step());
  });
  vi.stubGlobal("fetch", f);
  return () => f.mock.calls.map(([url]) => /models\/([^:]+):/.exec(url)[1]);
}

beforeEach(() => {
  vi.stubEnv("GEMINI_API_KEY", KEY);
  vi.stubEnv("GEMINI_MODEL", "");
  vi.stubEnv("WA_LLM_MODE", "live");
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("the second try", () => {
  it("an overloaded model hands the same request to the fallback", async () => {
    const models = answers(busy, () => http(200, booking));
    const parsed = await parseMessage("mesa para 4");
    expect(models()).toEqual([DEFAULT_MODEL, FALLBACK_MODEL]);
    expect(parsed).toMatchObject({ intent: "new_booking", size: 4 });
    const [first, second] = fetch.mock.calls.map(([, o]) => o.body);
    expect(second).toBe(first);
  });

  it.each([[429], [500], [503], [504]])("%i is temporary", async (status) => {
    const models = answers(() => http(status, {}), () => http(200, booking));
    await parseMessage("mesa para 4");
    expect(models()).toHaveLength(2);
  });

  it.each([[400], [401], [403], [404]])("%i is the request's fault: no second call", async (status) => {
    const models = answers(() => http(status, {}));
    await expect(generateCustomerReply([], "es")).rejects.toMatchObject({ status: 502 });
    expect(models()).toEqual([DEFAULT_MODEL]);
  });

  it("a timeout is temporary, and each attempt has its own timer", async () => {
    vi.useFakeTimers();
    const models = answers(stalls, () => http(200, reply("hola")));
    const p = generateCustomerReply([], "es");
    await vi.advanceTimersByTimeAsync(8000);
    await expect(p).resolves.toBe("hola");
    expect(models()).toEqual([DEFAULT_MODEL, FALLBACK_MODEL]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("a body that stalls after the headers is a timeout too", async () => {
    vi.useFakeTimers();
    const models = answers((url, opts) => Promise.resolve({ ok: true, json: () => stalls(url, opts) }), () => http(200, reply("hola")));
    const p = generateCustomerReply([], "es");
    await vi.advanceTimersByTimeAsync(8000);
    await expect(p).resolves.toBe("hola");
    expect(models()).toHaveLength(2);
  });

  it("a connection dropped half way through a 200 gets the second try", async () => {
    const models = answers(() => Promise.resolve({ ok: true, json: () => Promise.reject(new TypeError("terminated")) }), () => http(200, reply("hola")));
    await expect(generateCustomerReply([], "es")).resolves.toBe("hola");
    expect(models()).toHaveLength(2);
  });

  it("a healthy model is asked once", async () => {
    const models = answers(() => http(200, booking));
    await parseMessage("mesa para 4");
    expect(models()).toEqual([DEFAULT_MODEL]);
  });

  it("with the fallback configured as the model, the second try is that model again", async () => {
    vi.stubEnv("GEMINI_MODEL", FALLBACK_MODEL);
    const models = answers(busy, () => http(200, reply("hola")));
    await expect(generateCustomerReply([], "es")).resolves.toBe("hola");
    expect(models()).toEqual([FALLBACK_MODEL, FALLBACK_MODEL]);
  });

  it("there is no third call", async () => {
    const models = answers(busy, busy, () => http(200, booking));
    await expect(generateCustomerReply([], "es")).rejects.toMatchObject({ status: 503 });
    expect(models()).toHaveLength(2);
  });
});

describe("when both tries fail", () => {
  it("a message is still saved, without a draft", async () => {
    answers(busy);
    await expect(parseMessage("mesa para 4")).resolves.toBeNull();
  });

  it("a Re-check hears it, because staff asked and 'nothing outstanding' would be false", async () => {
    answers(busy);
    await expect(parseThread([{ direction: "in", text: "mesa para 4" }])).rejects.toMatchObject({ status: 503 });
  });

  it("an overload is 503 with Google's sentence, a timeout 504 with ours, and no connection 503", async () => {
    answers(busy);
    await expect(generateScenarioMessage()).rejects.toMatchObject({ status: 503, message: "This model is currently experiencing high demand." });

    vi.useFakeTimers();
    answers(stalls);
    const timedOut = generateCustomerReply([], "es").catch((e) => e);
    await vi.advanceTimersByTimeAsync(16000);
    expect(await timedOut).toMatchObject({ status: 504, message: "Gemini took too long to answer. Try again in a minute." });
    vi.useRealTimers();

    answers(() => Promise.reject(new TypeError("fetch failed")));
    await expect(generateCustomerReply([], "es")).rejects.toMatchObject({ status: 503, message: "Could not reach Gemini." });
  });

  it("no failure carries the request URL, which holds the key", async () => {
    answers(() => Promise.reject(new TypeError("request to https://x?key=" + KEY + " failed")));
    const e = await generateCustomerReply([], "es").catch((x) => x);
    expect(e.message).not.toContain(KEY);
    answers(() => new Response("<html>bad gateway</html>", { status: 502 }));
    const page = await generateCustomerReply([], "es").catch((x) => x);
    expect(page).toMatchObject({ status: 503, message: "Gemini error 502" });
  });
});

describe("a reply that cannot be used", () => {
  it("is 502 and no retry: the model answered", async () => {
    const models = answers(() => http(200, reply("not json")));
    await expect(generateScenarioMessage()).rejects.toMatchObject({ status: 502, message: "Gemini's reply was not valid JSON" });
    expect(models()).toHaveLength(1);
    answers(() => http(200, {}));
    await expect(generateCustomerReply([], "es")).rejects.toMatchObject({ status: 502, message: "Gemini returned no text" });
  });

  it("never quotes the guest's words back through a SyntaxError", async () => {
    answers(() => http(200, reply("Lucía García, alergia al marisco")));
    const e = await parseThread([{ direction: "in", text: "hola" }]).catch((x) => x);
    expect(e.message).not.toContain("Luc");
  });
});
