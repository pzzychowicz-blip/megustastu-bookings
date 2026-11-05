// tests/wa-time-zone.test.js — v18.15.0
//
// The WhatsApp parse dates a message on the RESTAURANT's calendar. The server
// runs in UTC (Vercel), and until this version it told the model "Today is" in
// UTC and the mock parser stepped UTC days, so a message sent between 00:00 and
// 01:00 on a Canary summer night was dated a day early: "mañana" became the day
// the customer meant as today.
//
// The instant used throughout: 23:30 UTC on Wednesday 15 July 2026, which is
// 00:30 on Thursday the 16th in the Canaries and 19:30 on the 15th in New York.
// The wiring (readTimeZone, the webhook, the simulator, the Re-check) is in
// tests/api-handlers.test.js; this file holds the parser itself and the prompt
// it sends, read from the request body the real parse builds.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import process from "node:process";
import { restaurantToday, mockParse, parseMessage, parseThread } from "../api/_lib/gemini.js";
import { tenantTimeZone, FALLBACK_TIME_ZONE } from "../api/_lib/env.js";

const NIGHT = new Date("2026-07-15T23:30:00Z");

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NIGHT);
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("restaurantToday", () => {
  it("is the restaurant's date and weekday, whatever the server's clock says", () => {
    expect(restaurantToday("Atlantic/Canary")).toEqual({ iso: "2026-07-16", dow: 4, timeZone: "Atlantic/Canary" });
    expect(restaurantToday("America/New_York")).toEqual({ iso: "2026-07-15", dow: 3, timeZone: "America/New_York" });
    expect(restaurantToday("Asia/Tokyo").iso).toBe("2026-07-16");
    // `now` is a seam, as todayStr's is.
    expect(restaurantToday("Atlantic/Canary", Date.parse("2026-07-15T22:59:00Z")).iso).toBe("2026-07-15");
  });

  it("no zone, or one this runtime does not know, is the tenant's", () => {
    vi.stubEnv("TENANT_TIME_ZONE", "");
    for (const tz of [undefined, null, "", "Mars/Olympus", 3]) {
      expect(restaurantToday(tz).timeZone, String(tz)).toBe("Atlantic/Canary");
    }
    vi.stubEnv("TENANT_TIME_ZONE", "Asia/Tokyo");
    expect(restaurantToday(undefined).timeZone).toBe("Asia/Tokyo");
  });
});

describe("tenantTimeZone", () => {
  it("unset is the tenant that ships today: env's fallback and src/tenants/mgt.js agree", async () => {
    vi.stubEnv("TENANT_TIME_ZONE", "");
    const mod = await import("../src/tenants/mgt.js");
    expect(FALLBACK_TIME_ZONE).toBe(mod.profile.timeZone);
    expect(tenantTimeZone()).toBe(mod.profile.timeZone);
  });
  it("a variable that names no zone is refused, out loud, rather than read as UTC", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubEnv("TENANT_TIME_ZONE", "Canary");
    expect(tenantTimeZone()).toBe(FALLBACK_TIME_ZONE);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toMatch(/TENANT_TIME_ZONE "Canary"/);
  });
});

describe("mockParse dates on the restaurant's calendar", () => {
  const dateOf = (text, tz) => mockParse(text, null, tz).date;

  it("today, tomorrow and a weekday name, at 00:30 in the Canaries", () => {
    expect(dateOf("Mesa para 4 hoy a las 21:00", "Atlantic/Canary")).toBe("2026-07-16");
    expect(dateOf("Mesa para 4 mañana a las 21:00", "Atlantic/Canary")).toBe("2026-07-17");
    expect(dateOf("table for 2 tomorrow at 8pm", "Atlantic/Canary")).toBe("2026-07-17");
    // Sent on a Thursday, "el jueves" is next week's: the NEXT such day.
    expect(dateOf("Mesa para 2 el jueves a las 21:00", "Atlantic/Canary")).toBe("2026-07-23");
    expect(dateOf("Mesa para 2 el viernes a las 21:00", "Atlantic/Canary")).toBe("2026-07-17");
  });

  it("and at 19:30 on the Wednesday in New York", () => {
    expect(dateOf("Mesa para 4 mañana a las 21:00", "America/New_York")).toBe("2026-07-16");
    expect(dateOf("Mesa para 2 el jueves a las 21:00", "America/New_York")).toBe("2026-07-16");
  });

  it("with no zone given, the tenant's (the auto-ack's language hint passes none)", () => {
    expect(dateOf("Mesa para 4 mañana a las 21:00")).toBe("2026-07-17");
  });
});

describe("the parse hands the model the restaurant's today", () => {
  async function promptOf(run) {
    process.env.WA_LLM_MODE = "live";
    process.env.GEMINI_API_KEY = "test-key";
    let sent = null;
    vi.stubGlobal("fetch", async (url, init) => {
      sent = JSON.parse(init.body).contents[0].parts[0].text;
      return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: "{}" }] } }] }) };
    });
    try { await run(); } finally { delete process.env.WA_LLM_MODE; delete process.env.GEMINI_API_KEY; }
    expect(sent).not.toBe(null);
    return sent;
  }

  it("one message's prompt", async () => {
    expect(await promptOf(() => parseMessage("Mesa para 4 mañana", { timeZone: "Atlantic/Canary" })))
      .toContain("Today is 2026-07-16 (Thursday).");
    expect(await promptOf(() => parseMessage("Mesa para 4 mañana", { timeZone: "America/New_York" })))
      .toContain("Today is 2026-07-15 (Wednesday).");
  });

  it("a Re-check's transcript prompt", async () => {
    const p = await promptOf(() => parseThread([{ direction: "in", text: "Mesa para 4 mañana" }], { timeZone: "Atlantic/Canary" }));
    expect(p).toContain("Today is 2026-07-16 (Thursday).");
  });

  it("mock mode, and live mode with no key, date the draft on the same calendar", async () => {
    expect((await parseMessage("Mesa para 4 mañana a las 21:00", { timeZone: "Atlantic/Canary" })).date).toBe("2026-07-17");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    process.env.WA_LLM_MODE = "live";
    try {
      expect((await parseMessage("Mesa para 4 mañana a las 21:00", { timeZone: "Atlantic/Canary" })).date).toBe("2026-07-17");
      expect((await parseThread([{ direction: "in", text: "Mesa para 4 mañana a las 21:00" }], { timeZone: "America/New_York" })).date).toBe("2026-07-16");
    } finally { delete process.env.WA_LLM_MODE; }
  });
});
