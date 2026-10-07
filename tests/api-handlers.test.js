// tests/api-handlers.test.js
//
// v18.4.5 (ROADMAP #4) — the WhatsApp backend's handlers, run.
//
// `api/wa-send.js`, `api/wa-recheck.js`, `api/wa-config.js`,
// `api/_lib/inbound-core.js` and `api/_lib/meta.js` had no test that executed
// them: the existing WhatsApp tests read their source or call the pure helpers
// they import. These call the handlers with a request and a response object and
// read what was answered and what was written.
//
// What is real and what is not. `firebase-admin` is replaced by an in-memory
// tree (three modules, below), so `api/_lib/rtdb.js` itself runs: its paths,
// its `sanitizeKey`, its staff check. The only other stand-in is
// `parseThread` (the recheck's LLM read of a thread); `parseMessage` runs in
// its mock mode, and `sendText` in its mock mode except where the live half is
// the subject, with `fetch` stubbed.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import crypto from "node:crypto";
import { Buffer } from "node:buffer";

const fake = vi.hoisted(() => {
  const state = { tree: {}, writes: [] };
  const parts = (p) => p.split("/").filter(Boolean);
  const read = (p) => parts(p).reduce((n, k) => (n != null && typeof n === "object" ? n[k] : undefined), state.tree);
  const write = (p, v) => {
    const ks = parts(p);
    let n = state.tree;
    ks.slice(0, -1).forEach((k) => { if (n[k] == null || typeof n[k] !== "object") n[k] = {}; n = n[k]; });
    const last = ks[ks.length - 1];
    if (v === null || v === undefined) delete n[last]; else n[last] = v;
  };
  const db = {
    ref: (path) => ({
      get: async () => { const v = read(path); return { exists: () => v !== undefined && v !== null, val: () => (v === undefined ? null : v) }; },
      set: async (v) => { state.writes.push({ op: "set", path, value: v }); write(path, v); },
      update: async (patch) => {
        state.writes.push({ op: "update", path, value: patch });
        Object.keys(patch).forEach((k) => write(path + "/" + k, patch[k]));
      },
    }),
  };
  const TOKENS = {
    staff: { uid: "u1", email: "ana@example.com", email_verified: true },
    stranger: { uid: "u2", email: "eve@example.com", email_verified: true },
    unverified: { uid: "u3", email: "ana@example.com", email_verified: false },
  };
  return { state, db, TOKENS, read };
});

vi.mock("firebase-admin/app", () => ({ initializeApp: () => ({}), getApps: () => [], cert: (x) => x }));
vi.mock("firebase-admin/database", () => ({ getDatabase: () => fake.db }));
vi.mock("firebase-admin/auth", () => ({
  getAuth: () => ({
    verifyIdToken: async (t) => { if (fake.TOKENS[t]) return fake.TOKENS[t]; throw new Error("bad token"); },
  }),
}));
vi.mock("../api/_lib/gemini.js", async (orig) => Object.assign({}, await orig(), { parseThread: vi.fn() }));

import sendHandler from "../api/wa-send.js";
import recheckHandler from "../api/wa-recheck.js";
import configHandler from "../api/wa-config.js";
import { processInbound, applyParse, injectSimInbound } from "../api/_lib/inbound-core.js";
import { verifySignature, sendText } from "../api/_lib/meta.js";
import { parseThread } from "../api/_lib/gemini.js";
import { WA_WINDOW_MS, WA_MAX_TEXT_LEN, WA_RECHECK_HISTORY, AUTO_ACK_TEXT } from "../src/lib/whatsapp.js";

// A request as Vercel hands it over (the body already parsed) and a response
// that records the one answer a handler gives.
function call(handler, { method = "POST", token, body } = {}) {
  const res = { statusCode: null, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  const headers = token ? { authorization: "Bearer " + token } : {};
  return handler({ method, headers, body: body === undefined ? {} : body }, res).then(() => res);
}
const convAt = (key) => fake.read("conversations/" + key);
const msgsAt = (key) => Object.values(fake.read("messages/" + key) || {}).sort((a, b) => a.ts - b.ts);
const KEY = "+34600111222";
const openConv = (extra) => Object.assign({ phoneKey: KEY, phone: KEY, windowExpiresAt: Date.now() + 60000 }, extra || {});

beforeEach(() => {
  fake.state.tree = {};
  fake.state.writes = [];
  vi.stubEnv("FIREBASE_SERVICE_ACCOUNT", '{"project_id":"test"}');
  ["WA_STAFF_EMAILS", "WA_SEND_MODE", "WA_LLM_MODE", "WA_DB_URL", "WA_ALLOW_UNSIGNED", "WA_SIM_ENABLED",
    "META_APP_SECRET", "META_WA_TOKEN", "META_PHONE_NUMBER_ID", "META_VERIFY_TOKEN", "GEMINI_API_KEY", "GEMINI_MODEL", "TENANT_WA_CONTEXT",
  ].forEach((k) => vi.stubEnv(k, ""));
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  parseThread.mockReset();
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

// ── The gate the three token endpoints share ────────────────────────────────
describe.each([
  ["wa-send", sendHandler, "POST", "GET"],
  ["wa-recheck", recheckHandler, "POST", "GET"],
  ["wa-config", configHandler, "GET", "POST"],
])("%s — method and staff auth", (name, handler, method, wrong) => {
  it("answers 405 to the wrong method, before anything else", async () => {
    const res = await call(handler, { method: wrong, token: "staff" });
    expect(res.statusCode).toBe(405);
  });
  it("answers 401 with no token and with a token that does not verify", async () => {
    expect((await call(handler, { method })).statusCode).toBe(401);
    const bad = await call(handler, { method, token: "nonsense" });
    expect([bad.statusCode, bad.body.error]).toEqual([401, "invalid token"]);
  });
  it("answers 403 to a verified account that is not on the allow-list, and to an unverified one that is", async () => {
    vi.stubEnv("WA_STAFF_EMAILS", "ana@example.com");
    expect((await call(handler, { method, token: "stranger" })).statusCode).toBe(403);
    const unverified = await call(handler, { method, token: "unverified" });
    expect(unverified.statusCode).toBe(403);
    expect(unverified.body.error).toMatch(/not verified/);
  });
  it("answers 503 when the server is misconfigured: live sends with no allow-list, or no service account", async () => {
    vi.stubEnv("WA_SEND_MODE", "live");
    expect((await call(handler, { method, token: "staff" })).statusCode).toBe(503);
  });
  it("writes nothing on any refusal", async () => {
    vi.stubEnv("WA_STAFF_EMAILS", "ana@example.com");
    fake.state.tree = { conversations: { [KEY]: openConv() } };
    await call(handler, { method: wrong, token: "staff", body: { phoneKey: KEY, text: "hi" } });
    await call(handler, { method, body: { phoneKey: KEY, text: "hi" } });
    await call(handler, { method, token: "stranger", body: { phoneKey: KEY, text: "hi" } });
    expect(fake.state.writes).toEqual([]);
  });
});

// ── api/wa-send.js ───────────────────────────────────────────────────────────
describe("wa-send", () => {
  const send = (body, token = "staff") => call(sendHandler, { token, body });

  it("400 without a phoneKey, without text, and with text that is only spaces", async () => {
    fake.state.tree = { conversations: { [KEY]: openConv() } };
    expect((await send({ text: "hi" })).statusCode).toBe(400);
    expect((await send({ phoneKey: KEY })).statusCode).toBe(400);
    expect((await send({ phoneKey: KEY, text: "   " })).statusCode).toBe(400);
    expect((await send({ phoneKey: KEY, text: 42 })).statusCode).toBe(400);
    expect(fake.state.writes).toEqual([]);
  });

  it("404 for a conversation that does not exist: a reply never opens a thread", async () => {
    const res = await send({ phoneKey: KEY, text: "hi" });
    expect(res.statusCode).toBe(404);
    expect(fake.state.writes).toEqual([]);
  });

  it("410 once the 24h window has passed, or was never set", async () => {
    fake.state.tree = { conversations: { [KEY]: openConv({ windowExpiresAt: Date.now() - 1 }), "+34600999888": { phoneKey: "+34600999888" } } };
    expect((await send({ phoneKey: KEY, text: "hi" })).statusCode).toBe(410);
    expect((await send({ phoneKey: "+34600999888", text: "hi" })).statusCode).toBe(410);
    expect(fake.state.writes).toEqual([]);
  });

  it("200: stores the message with its author and updates the conversation, without moving the window", async () => {
    const conv = openConv();
    fake.state.tree = { conversations: { [KEY]: conv } };
    const res = await send({ phoneKey: KEY, text: "  Mesa confirmada  " });
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ ok: true, status: "delivered" });
    const [m] = msgsAt(KEY);
    expect(m).toMatchObject({ id: res.body.msgId, direction: "out", text: "Mesa confirmada", status: "delivered",
      isAutoAck: false, channel: "whatsapp", authorEmail: "ana@example.com", providerMsgId: res.body.wamid });
    expect(convAt(KEY)).toMatchObject({ lastMessageSnippet: "Mesa confirmada", lastMessageAt: m.ts, windowExpiresAt: conv.windowExpiresAt });
  });

  it("a reply to an archived conversation un-archives it; one to an open conversation does not write the field", async () => {
    fake.state.tree = { conversations: { [KEY]: openConv({ archived: true, archivedAt: 5 }) } };
    await send({ phoneKey: KEY, text: "hi" });
    expect(convAt(KEY).archived).toBe(false);
    expect("archivedAt" in convAt(KEY)).toBe(false);

    fake.state.tree = { conversations: { [KEY]: openConv() } };
    fake.state.writes = [];
    await send({ phoneKey: KEY, text: "hi" });
    const patch = fake.state.writes.find((w) => w.op === "update").value;
    expect(Object.keys(patch).sort()).toEqual(["lastMessageAt", "lastMessageSnippet"]);
  });

  it("caps the text before the send, so what is sent and what is stored are one string", async () => {
    vi.stubEnv("WA_SEND_MODE", "live");
    vi.stubEnv("WA_STAFF_EMAILS", "ana@example.com");
    vi.stubEnv("META_WA_TOKEN", "t");
    vi.stubEnv("META_PHONE_NUMBER_ID", "123");
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ messages: [{ id: "wamid.REAL" }] }) }));
    vi.stubGlobal("fetch", fetchMock);
    fake.state.tree = { conversations: { [KEY]: openConv() } };
    const res = await send({ phoneKey: KEY, text: "x".repeat(WA_MAX_TEXT_LEN + 500) });
    expect(res.statusCode).toBe(200);
    const sentBody = JSON.parse(fetchMock.mock.calls[0][1].body).text.body;
    expect(sentBody.length).toBe(WA_MAX_TEXT_LEN);
    expect(msgsAt(KEY)[0].text).toBe(sentBody);
    expect(msgsAt(KEY)[0]).toMatchObject({ status: "sent", providerMsgId: "wamid.REAL" });
  });

  it("502 when the provider refuses, and then nothing is stored: a failed send is never shown as sent", async () => {
    vi.stubEnv("WA_SEND_MODE", "live");
    vi.stubEnv("WA_STAFF_EMAILS", "ana@example.com");
    vi.stubEnv("META_WA_TOKEN", "t");
    vi.stubEnv("META_PHONE_NUMBER_ID", "123");
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 400, json: async () => ({ error: { message: "Recipient not allowed" } }) })));
    fake.state.tree = { conversations: { [KEY]: openConv() } };
    const res = await send({ phoneKey: KEY, text: "hi" });
    expect([res.statusCode, res.body.error]).toEqual([502, "send failed: Recipient not allowed"]);
    expect(fake.state.writes).toEqual([]);
  });

  it("a phoneKey holding a path separator reads and writes ONE child, never a sub-path", async () => {
    fake.state.tree = { conversations: { [KEY]: openConv({ draftData: { windowExpiresAt: Date.now() + 60000 } }) } };
    const res = await send({ phoneKey: KEY + "/draftData", text: "hi" });
    expect(res.statusCode).toBe(404);
    expect(fake.state.writes).toEqual([]);
  });
});

// ── api/wa-recheck.js ────────────────────────────────────────────────────────
describe("wa-recheck", () => {
  const recheck = (body) => call(recheckHandler, { token: "staff", body });
  const thread = (list) => Object.fromEntries(list.map((m, i) => ["m" + i, Object.assign({ id: "m" + i, ts: i + 1 }, m)]));

  it("400 for a key that is not a normalised phone, before any read", async () => {
    for (const phoneKey of ["", "+", "+34 600 111 222", "+34600111222/draftData", "abc", 5, null]) {
      const res = await recheck({ phoneKey });
      expect([phoneKey, res.statusCode]).toEqual([phoneKey, 400]);
    }
    expect(parseThread).not.toHaveBeenCalled();
  });

  it("404 for an unknown conversation and 400 for one with no messages", async () => {
    expect((await recheck({ phoneKey: KEY })).statusCode).toBe(404);
    fake.state.tree = { conversations: { [KEY]: openConv() } };
    const res = await recheck({ phoneKey: KEY });
    expect([res.statusCode, res.body.error]).toEqual([400, "no messages to check"]);
    expect(parseThread).not.toHaveBeenCalled();
  });

  it("hands the model the thread without the auto-ack, the pending draft and the hours", async () => {
    const hours = { days: { 1: { open: 13, close: 22 } } };
    fake.state.tree = {
      settings: { operatingHours: hours },
      conversations: { [KEY]: openConv({ draftStatus: "parsed", draftData: { size: 2 } }) },
      messages: { [KEY]: thread([
        { direction: "in", text: "Hola" },
        { direction: "out", text: AUTO_ACK_TEXT.es, isAutoAck: true },
        { direction: "out", text: "Buenas" },
        { direction: "in", text: "Mesa para 4" },
      ]) },
    };
    parseThread.mockResolvedValue({ intent: "question", language: "es" });
    await recheck({ phoneKey: KEY });
    expect(parseThread).toHaveBeenCalledWith(
      [{ direction: "in", text: "Hola" }, { direction: "out", text: "Buenas" }, { direction: "in", text: "Mesa para 4" }],
      { hours, existingDraft: { size: 2 } }
    );
  });

  it("an accepted or dismissed draft is not context, and only the last messages are read", async () => {
    const many = Array.from({ length: WA_RECHECK_HISTORY + 5 }, (_, i) => ({ direction: "in", text: "m" + i }));
    fake.state.tree = {
      conversations: { [KEY]: openConv({ draftStatus: "accepted", draftData: { size: 2 } }) },
      messages: { [KEY]: thread(many) },
    };
    parseThread.mockResolvedValue(null);
    await recheck({ phoneKey: KEY });
    const [history, opts] = parseThread.mock.calls[0];
    expect(history.length).toBe(WA_RECHECK_HISTORY);
    expect(history[history.length - 1].text).toBe("m" + (WA_RECHECK_HISTORY + 4));
    expect(opts.existingDraft).toBe(null);
  });

  it("a draft intent writes the draft, stamped now, and answers updated: true", async () => {
    fake.state.tree = {
      conversations: { [KEY]: openConv({ parsing: true, parsingAt: 1 }) },
      messages: { [KEY]: thread([{ direction: "in", text: "Mesa para 4 mañana a las 21" }]) },
    };
    parseThread.mockResolvedValue({ intent: "new_booking", language: "en", size: 4, date: "2026-10-08", time: "21:00", confidence: "high" });
    const before = Date.now();
    const res = await recheck({ phoneKey: KEY });
    expect([res.statusCode, res.body]).toEqual([200, { intent: "new_booking", updated: true }]);
    const c = convAt(KEY);
    expect(c).toMatchObject({ draftStatus: "parsed", language: "en", draftData: { intent: "new_booking", size: 4, date: "2026-10-08", time: "21:00", confidence: "high" } });
    expect(c.draftUpdatedAt).toBeGreaterThanOrEqual(before);
    expect("parsing" in c).toBe(false);
    expect(msgsAt(KEY).length).toBe(1); // a re-check never appends a message
  });

  it("a question clears the indicator, leaves the draft alone and answers updated: false", async () => {
    fake.state.tree = {
      conversations: { [KEY]: openConv({ parsing: true, draftStatus: "parsed", draftData: { size: 2 } }) },
      messages: { [KEY]: thread([{ direction: "in", text: "¿Tenéis terraza?" }]) },
    };
    parseThread.mockResolvedValue({ intent: "question", language: "es" });
    const res = await recheck({ phoneKey: KEY });
    expect(res.body).toEqual({ intent: "question", updated: false });
    expect(convAt(KEY)).toMatchObject({ draftStatus: "parsed", draftData: { size: 2 } });
    expect("parsing" in convAt(KEY)).toBe(false);
  });

  it("a model timeout is named, and a model error keeps its own status", async () => {
    fake.state.tree = { conversations: { [KEY]: openConv() }, messages: { [KEY]: thread([{ direction: "in", text: "hola" }]) } };
    parseThread.mockRejectedValue(Object.assign(new Error("aborted"), { name: "AbortError" }));
    const timeout = await recheck({ phoneKey: KEY });
    expect([timeout.statusCode, timeout.body.error]).toEqual([500, "Gemini timeout"]);
    parseThread.mockRejectedValue(Object.assign(new Error("quota"), { status: 429 }));
    const quota = await recheck({ phoneKey: KEY });
    expect([quota.statusCode, quota.body.error]).toEqual([429, "quota"]);
  });
});

// ── api/wa-config.js ─────────────────────────────────────────────────────────
describe("wa-config", () => {
  const config = () => call(configHandler, { method: "GET", token: "staff" });

  it("reports each key as set or not, and never a value", async () => {
    vi.stubEnv("GEMINI_API_KEY", "secret-key-value");
    vi.stubEnv("META_VERIFY_TOKEN", "   "); // present: a blank-looking value is still a value
    const res = await config();
    expect(res.statusCode).toBe(200);
    expect(res.body.set).toMatchObject({ GEMINI_API_KEY: true, FIREBASE_SERVICE_ACCOUNT: true, META_WA_TOKEN: false, META_VERIFY_TOKEN: true, WA_STAFF_EMAILS: false });
    expect(Object.values(res.body.set).every((v) => typeof v === "boolean")).toBe(true);
    expect(JSON.stringify(res.body)).not.toContain("secret-key-value");
  });

  it("reports the EFFECTIVE modes: only exactly \"live\" is live", async () => {
    expect((await config()).body.modes).toEqual({ llm: "mock", send: "mock" });
    vi.stubEnv("WA_LLM_MODE", "LIVE");
    vi.stubEnv("WA_SEND_MODE", "true");
    expect((await config()).body.modes).toEqual({ llm: "mock", send: "mock" });
    vi.stubEnv("WA_LLM_MODE", "live");
    expect((await config()).body.modes).toEqual({ llm: "live", send: "mock" });
  });
});

// ── api/_lib/inbound-core.js ─────────────────────────────────────────────────
describe("processInbound", () => {
  const TS = 1_800_000_000_000;

  it("skips a sender that is not a phone, writing nothing", async () => {
    for (const phone of ["", "+", "abc", null]) {
      expect(await processInbound({ phone, text: "hola", ts: TS })).toEqual({ phoneKey: null, skipped: true });
    }
    expect(fake.state.writes).toEqual([]);
  });

  it("a first message opens the conversation, stores the message and sends the one-time auto-ack", async () => {
    const r = await processInbound({ phone: "+34 600 111 222", text: "Hola", ts: TS, wamid: "wamid.A1", profileName: "Juan", langHint: "es" });
    expect(r).toEqual({ phoneKey: KEY, skipped: false });
    expect(convAt(KEY)).toMatchObject({ phoneKey: KEY, channel: "whatsapp", lastMessageAt: TS, lastMessageSnippet: "Hola", unread: true,
      windowExpiresAt: TS + WA_WINDOW_MS, language: "es", archived: false, autoAckSent: true, createdAt: TS, profileName: "Juan" });
    const [inbound, ack] = msgsAt(KEY);
    expect(inbound).toMatchObject({ id: "wamid_A1", direction: "in", text: "Hola", ts: TS, providerMsgId: "wamid.A1", isAutoAck: false });
    expect(ack).toMatchObject({ direction: "out", text: AUTO_ACK_TEXT.es, ts: TS + 1500, isAutoAck: true, status: "delivered" });
  });

  it("a later message sends no second ack, resets the window, and keeps what the conversation holds", async () => {
    fake.state.tree = { conversations: { [KEY]: { phoneKey: KEY, autoAckSent: true, createdAt: 5, acceptedBookingId: "b1",
      draftStatus: "accepted", draftData: { size: 2 }, profileName: "Juan", archived: true, archivedAt: 9, acceptedBadgeDismissedAt: 7 } } };
    await processInbound({ phone: KEY, text: "gracias", ts: TS, wamid: "wamid.B", profileName: "Someone Else", langHint: "es" });
    const c = convAt(KEY);
    expect(c).toMatchObject({ createdAt: 5, acceptedBookingId: "b1", draftStatus: "accepted", draftData: { size: 2 }, profileName: "Juan",
      archived: false, windowExpiresAt: TS + WA_WINDOW_MS });
    expect("archivedAt" in c).toBe(false);
    expect("acceptedBadgeDismissedAt" in c).toBe(false);
    expect(msgsAt(KEY).map((m) => m.direction)).toEqual(["in"]);
  });

  it("a redelivered webhook (same wamid) is skipped: one message, however often Meta retries", async () => {
    await processInbound({ phone: KEY, text: "Hola", ts: TS, wamid: "wamid.DUP" });
    const count = fake.state.writes.length;
    expect(await processInbound({ phone: KEY, text: "Hola", ts: TS + 5000, wamid: "wamid.DUP" })).toEqual({ phoneKey: KEY, skipped: true });
    expect(fake.state.writes.length).toBe(count);
    expect(convAt(KEY).lastMessageAt).toBe(TS);
  });

  it("a draft intent stores a draft the app can use: an unusable time or size becomes null and the confidence drops", async () => {
    await processInbound({ phone: KEY, text: "mesa", ts: TS, wamid: "wamid.C",
      parse: { intent: "new_booking", language: "en", size: 5000.5, date: "next tuesday", time: "8 in the evening", confidence: "high" } });
    const c = convAt(KEY);
    expect(c).toMatchObject({ draftStatus: "parsed", draftUpdatedAt: TS, language: "en" });
    expect(c.draftData).toMatchObject({ intent: "new_booking", size: null, date: null, time: null, preference: "auto", notes: "" });
    expect(c.draftData.confidence).not.toBe("high");
  });

  it("a question stores no draft, and the parsing flag is set only when a parse is still to come", async () => {
    await processInbound({ phone: KEY, text: "¿terraza?", ts: TS, wamid: "wamid.D", parse: { intent: "question", language: "es" }, willParse: true });
    expect("draftStatus" in convAt(KEY)).toBe(false); // written as null, which RTDB stores as absent
    expect("parsing" in convAt(KEY)).toBe(false);
    await processInbound({ phone: KEY, text: "otra", ts: TS + 1, wamid: "wamid.E", parse: null, willParse: true });
    expect(convAt(KEY).parsing).toBe(true);
  });

  it("stores at most WA_MAX_TEXT_LEN characters and a 200-character snippet", async () => {
    await processInbound({ phone: KEY, text: "y".repeat(WA_MAX_TEXT_LEN + 10), ts: TS, wamid: "wamid.F" });
    expect(msgsAt(KEY)[0].text.length).toBe(WA_MAX_TEXT_LEN);
    expect(convAt(KEY).lastMessageSnippet.length).toBe(200);
  });

  it("a failed auto-ack does not lose the customer's message", async () => {
    vi.stubEnv("WA_SEND_MODE", "live"); // live with no token: sendText throws
    const r = await processInbound({ phone: KEY, text: "Hola", ts: TS, wamid: "wamid.G" });
    expect(r.skipped).toBe(false);
    expect(msgsAt(KEY).map((m) => m.direction)).toEqual(["in"]);
    expect(convAt(KEY).autoAckSent).toBe(true);
  });
});

describe("applyParse", () => {
  it("clears the indicator whatever the parse, and sets a draft only for a draft intent", async () => {
    fake.state.tree = { conversations: { [KEY]: { phoneKey: KEY, parsing: true, parsingAt: 3, language: "es" } } };
    await applyParse(KEY, null, 10);
    expect(convAt(KEY)).toEqual({ phoneKey: KEY, language: "es" });
    await applyParse(KEY, { intent: "other", language: "en" }, 10);
    expect(convAt(KEY)).toEqual({ phoneKey: KEY, language: "en" });
    await applyParse(KEY, { intent: "cancel", language: "es", confidence: "high" }, 10);
    expect(convAt(KEY)).toMatchObject({ draftStatus: "parsed", draftUpdatedAt: 10, draftData: { intent: "cancel" } });
  });
  it("does nothing without a key", async () => {
    await applyParse("", { intent: "cancel" }, 10);
    expect(fake.state.writes).toEqual([]);
  });
});

describe("injectSimInbound", () => {
  it("stores the message at once with the indicator on, and lands the parse afterwards", async () => {
    let later;
    const r = await injectSimInbound({ phone: KEY, text: "Mesa para 4 personas mañana a las 21:00", name: "Sim" }, (p) => { later = p; });
    expect(r).toEqual({ phoneKey: KEY, skipped: false });
    expect(convAt(KEY)).toMatchObject({ parsing: true, profileName: "Sim" });
    expect(msgsAt(KEY)[0].direction).toBe("in");
    await later;
    const c = convAt(KEY);
    expect("parsing" in c).toBe(false);
    expect(c.draftStatus).toBe("parsed");
    expect(c.draftData.size).toBe(4);
  });
  it("back-dates the message by agoMs, so an expired window can be simulated", async () => {
    const before = Date.now();
    await injectSimInbound({ phone: KEY, text: "hola", agoMs: 25 * 3600 * 1000 }, () => {});
    expect(convAt(KEY).windowExpiresAt).toBeLessThan(before);
  });
});

// ── api/_lib/meta.js ─────────────────────────────────────────────────────────
describe("verifySignature", () => {
  const body = Buffer.from('{"object":"whatsapp_business_account"}');
  const sign = (secret, raw) => "sha256=" + crypto.createHmac("sha256", secret).update(raw).digest("hex");

  it("accepts the HMAC of the exact bytes under the app secret, and nothing else", () => {
    vi.stubEnv("META_APP_SECRET", "s3cret");
    expect(verifySignature(body, sign("s3cret", body))).toBe(true);
    expect(verifySignature(body, sign("other", body))).toBe(false);
    expect(verifySignature(Buffer.from(body.toString() + " "), sign("s3cret", body))).toBe(false);
    expect(verifySignature(body, sign("s3cret", body).replace("sha256=", "sha1="))).toBe(false);
    expect(verifySignature(body, sign("s3cret", body).slice(0, -2))).toBe(false);
    expect(verifySignature(body, "")).toBe(false);
    expect(verifySignature(body, undefined)).toBe(false);
  });
  it("refuses everything when no secret is configured", () => {
    expect(verifySignature(body, sign("", body))).toBe(false);
  });
  it("WA_ALLOW_UNSIGNED skips the check only at exactly \"1\"", () => {
    vi.stubEnv("WA_ALLOW_UNSIGNED", "true");
    expect(verifySignature(body, undefined)).toBe(false);
    vi.stubEnv("WA_ALLOW_UNSIGNED", "1");
    expect(verifySignature(body, undefined)).toBe(true);
  });
});

describe("sendText", () => {
  it("mock mode touches no network and reports delivered", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const r = await sendText(KEY, "hi");
    expect(r.status).toBe("delivered");
    expect(r.wamid).toMatch(/^wamid\.MOCK\./);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("live mode without its two settings throws rather than pretending", async () => {
    vi.stubEnv("WA_SEND_MODE", "live");
    await expect(sendText(KEY, "hi")).rejects.toThrow(/META_WA_TOKEN/);
  });
  it("live mode posts a text message to the number's endpoint, the recipient without its plus", async () => {
    vi.stubEnv("WA_SEND_MODE", "live");
    vi.stubEnv("META_WA_TOKEN", "tok");
    vi.stubEnv("META_PHONE_NUMBER_ID", "555");
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ messages: [{ id: "wamid.X" }] }) }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await sendText(KEY, "hola")).toEqual({ wamid: "wamid.X", status: "sent" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toMatch(/^https:\/\/graph\.facebook\.com\/v\d+\.\d+\/555\/messages$/);
    expect(init.headers.Authorization).toBe("Bearer tok");
    expect(JSON.parse(init.body)).toEqual({ messaging_product: "whatsapp", to: "34600111222", type: "text", text: { body: "hola" } });
  });
  it("a Graph error carries Meta's message, or the status when there is none", async () => {
    vi.stubEnv("WA_SEND_MODE", "live");
    vi.stubEnv("META_WA_TOKEN", "tok");
    vi.stubEnv("META_PHONE_NUMBER_ID", "555");
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 401, json: async () => ({ error: { message: "Invalid OAuth access token" } }) })));
    await expect(sendText(KEY, "hi")).rejects.toThrow("Invalid OAuth access token");
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 500, json: async () => { throw new Error("not json"); } })));
    await expect(sendText(KEY, "hi")).rejects.toThrow("Graph API error 500");
  });
});
