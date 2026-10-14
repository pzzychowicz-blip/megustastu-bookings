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
//
// v18.8.0 adds the four handlers it did not run: `wa-inbound` (the webhook,
// read from a raw byte stream so its HMAC sees what Meta signed) and the three
// `wa-sim-*` endpoints (the 404 kill switch, then the shared method and auth
// gate, then their own 400s).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import crypto from "node:crypto";
import { Buffer } from "node:buffer";
import { Readable } from "node:stream";

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
import inboundHandler, { inboundContent } from "../api/wa-inbound.js";
import simInboundHandler from "../api/wa-sim-inbound.js";
import simSuggestHandler from "../api/wa-sim-suggest.js";
import simGenerateHandler from "../api/wa-sim-generate.js";
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

  it("a failed auto-ack does not lose the customer's message, and hands its claim back", async () => {
    vi.stubEnv("WA_SEND_MODE", "live"); // live with no token: sendText throws
    const r = await processInbound({ phone: KEY, text: "Hola", ts: TS, wamid: "wamid.G" });
    expect(r.skipped).toBe(false);
    expect(msgsAt(KEY).map((m) => m.direction)).toEqual(["in"]);
    expect(convAt(KEY).autoAckSent).toBe(false);
    // The claim is written BEFORE the send (two quick inbounds must not both
    // ack), then released: the order of the two writes is the contract.
    const claims = fake.state.writes.filter((w) => w.op === "update" && "autoAckSent" in w.value).map((w) => w.value.autoAckSent);
    expect(claims).toEqual([true, false]);
  });

  it("the next inbound after a failed auto-ack sends it, once", async () => {
    vi.stubEnv("WA_SEND_MODE", "live");
    await processInbound({ phone: KEY, text: "Hola", ts: TS, wamid: "wamid.H1" });
    vi.stubEnv("WA_SEND_MODE", "mock"); // the provider is back
    await processInbound({ phone: KEY, text: "¿Hola?", ts: TS + 60000, wamid: "wamid.H2" });
    expect(msgsAt(KEY).map((m) => [m.direction, !!m.isAutoAck])).toEqual([["in", false], ["in", false], ["out", true]]);
    expect(convAt(KEY).autoAckSent).toBe(true);
    await processInbound({ phone: KEY, text: "gracias", ts: TS + 120000, wamid: "wamid.H3" });
    expect(msgsAt(KEY).filter((m) => m.isAutoAck).length).toBe(1);
  });

  it("an auto-ack that was sent keeps its claim even if its bubble cannot be stored", async () => {
    const realSet = fake.db.ref;
    fake.db.ref = (path) => {
      const r = realSet(path);
      if (/\/ack/.test(path)) r.set = async () => { throw new Error("write refused"); };
      return r;
    };
    try {
      await processInbound({ phone: KEY, text: "Hola", ts: TS, wamid: "wamid.I" });
    } finally {
      fake.db.ref = realSet;
    }
    expect(convAt(KEY).autoAckSent).toBe(true);
    expect(msgsAt(KEY).map((m) => m.direction)).toEqual(["in"]);
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

// ── api/wa-inbound.js — the webhook (v18.8.0) ────────────────────────────────
// A request whose body is a byte STREAM, as Vercel hands this handler over
// (`bodyParser: false`), and a response that also records `send`.
function rawCall(handler, { method = "POST", body = "", headers = {}, query } = {}) {
  const req = Readable.from(body ? [Buffer.from(body)] : []);
  Object.assign(req, { method, headers, query: query || {} });
  const res = {
    statusCode: null, body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
    send(b) { this.body = b; return this; },
  };
  return handler(req, res).then(() => res);
}
const SECRET = "s3cret";
const hmac = (raw, secret = SECRET) => "sha256=" + crypto.createHmac("sha256", secret).update(raw).digest("hex");
const webhook = (value) => JSON.stringify({
  object: "whatsapp_business_account",
  entry: [{ id: "WABA", changes: [{ field: "messages", value: Object.assign({ messaging_product: "whatsapp" }, value) }] }],
});
const nowSecs = () => String(Math.floor(Date.now() / 1000));
const inMsg = (extra) => Object.assign({ from: "34600111222", id: "wamid.IN1", timestamp: nowSecs() }, extra);
// Posts a payload signed with the app secret; `raw` overrides the bytes.
const deliver = (value, { raw, headers } = {}) => {
  const body = raw !== undefined ? raw : webhook(value);
  return rawCall(inboundHandler, { body, headers: Object.assign({ "x-hub-signature-256": hmac(body) }, headers) });
};
const inbound = () => msgsAt(KEY).filter((m) => m.direction === "in");

// The phase-B parse is registered through Vercel's request-context waitUntil;
// the stub collects what was scheduled so a test can wait for it.
const REQ_CTX = Symbol.for("@vercel/request-context");
let scheduled;
beforeEach(() => {
  scheduled = [];
  globalThis[REQ_CTX] = { get: () => ({ waitUntil: (p) => scheduled.push(p) }) };
});
afterEach(() => { delete globalThis[REQ_CTX]; });

describe("wa-inbound — the handshake, the method, the signature", () => {
  beforeEach(() => vi.stubEnv("META_APP_SECRET", SECRET));

  it("GET echoes hub.challenge only for subscribe with the configured verify token", async () => {
    vi.stubEnv("META_VERIFY_TOKEN", "vt");
    const q = (mode, token) => ({ "hub.mode": mode, "hub.verify_token": token, "hub.challenge": "1234" });
    const ok = await rawCall(inboundHandler, { method: "GET", query: q("subscribe", "vt") });
    expect([ok.statusCode, ok.body]).toEqual([200, "1234"]);
    expect((await rawCall(inboundHandler, { method: "GET", query: q("subscribe", "nope") })).statusCode).toBe(403);
    expect((await rawCall(inboundHandler, { method: "GET", query: q("unsubscribe", "vt") })).statusCode).toBe(403);
  });
  it("GET refuses every token when none is configured, the empty one included", async () => {
    const res = await rawCall(inboundHandler, { method: "GET", query: { "hub.mode": "subscribe", "hub.verify_token": "", "hub.challenge": "1" } });
    expect(res.statusCode).toBe(403);
  });
  it("answers 405 to anything but GET and POST", async () => {
    expect((await rawCall(inboundHandler, { method: "PUT" })).statusCode).toBe(405);
  });
  it("answers 401 to a missing signature, a wrong secret and bytes changed after signing, and writes nothing", async () => {
    const body = webhook({ messages: [inMsg({ type: "text", text: { body: "hola" } })] });
    expect((await rawCall(inboundHandler, { body })).statusCode).toBe(401);
    expect((await rawCall(inboundHandler, { body, headers: { "x-hub-signature-256": hmac(body, "other") } })).statusCode).toBe(401);
    expect((await rawCall(inboundHandler, { body: body + " ", headers: { "x-hub-signature-256": hmac(body) } })).statusCode).toBe(401);
    expect(fake.state.writes).toEqual([]);
  });
  it("answers 400 to signed bytes that are not JSON", async () => {
    expect((await deliver(null, { raw: "{not json" })).statusCode).toBe(400);
  });
  it("answers 200 to a signed payload with nothing in it", async () => {
    const res = await deliver({});
    expect([res.statusCode, res.body]).toEqual([200, { ok: true, messages: 0, statuses: 0, skipped: 0, errors: 0 }]);
  });
});

describe("wa-inbound — what a message is stored as", () => {
  beforeEach(() => vi.stubEnv("META_APP_SECRET", SECRET));

  it("a text is stored as it came, with no media key, and parsed after the response", async () => {
    const res = await deliver({
      contacts: [{ wa_id: "34600111222", profile: { name: "Ana" } }],
      messages: [inMsg({ type: "text", text: { body: "Mesa para 4 mañana a las 21:00" } })],
    });
    expect(res.body).toMatchObject({ ok: true, messages: 1 });
    const [m] = inbound();
    expect(m.text).toBe("Mesa para 4 mañana a las 21:00");
    expect("media" in m).toBe(false);
    expect(convAt(KEY)).toMatchObject({ profileName: "Ana", lastMessageSnippet: "Mesa para 4 mañana a las 21:00", parsing: true });
    expect(scheduled).toHaveLength(1);
    await scheduled[0];
    expect(convAt(KEY)).toMatchObject({ draftStatus: "parsed", draftData: { size: 4 } });
  });
  it("a photo with a caption: the media beside the caption, the caption parsed", async () => {
    await deliver({ messages: [inMsg({ type: "image", image: { id: "1234567890", mime_type: "image/jpeg", sha256: "x", caption: " Mesa para 4 mañana a las 21:00 " } })] });
    const [m] = inbound();
    expect(m.media).toEqual({ kind: "image", mediaId: "1234567890", mime: "image/jpeg" });
    expect(m.text).toBe("Mesa para 4 mañana a las 21:00");
    expect(convAt(KEY).lastMessageSnippet).toBe("Photo · Mesa para 4 mañana a las 21:00");
    expect(scheduled).toHaveLength(1);
    await scheduled[0];
    expect(convAt(KEY).draftData.size).toBe(4);
  });
  it("a photo without a caption reads \"Photo\" and is not parsed", async () => {
    await deliver({ messages: [inMsg({ type: "image", image: { id: "1234567890", mime_type: "image/png" } })] });
    expect(inbound()[0]).toMatchObject({ text: "Photo", media: { kind: "image", mime: "image/png" } });
    expect(convAt(KEY).lastMessageSnippet).toBe("Photo");
    expect("parsing" in convAt(KEY)).toBe(false);
    expect(scheduled).toEqual([]);
  });
  it("a voice note keeps its voice flag and its codec line, and is never parsed", async () => {
    await deliver({ messages: [inMsg({ type: "audio", audio: { id: "998877", mime_type: "audio/ogg; codecs=opus", voice: true } })] });
    expect(inbound()[0]).toMatchObject({ text: "Voice message", media: { kind: "audio", mediaId: "998877", mime: "audio/ogg; codecs=opus", voice: true } });
    expect(scheduled).toEqual([]);
  });
  it("an audio file that is not a voice note reads \"Audio\" and carries no voice key", async () => {
    await deliver({ messages: [inMsg({ type: "audio", audio: { id: "998877", mime_type: "audio/mpeg" } })] });
    const [m] = inbound();
    expect(m.text).toBe("Audio");
    expect("voice" in m.media).toBe(false);
  });
  it("a document keeps its file name and is not parsed without a caption", async () => {
    await deliver({ messages: [inMsg({ type: "document", document: { id: "555", mime_type: "application/pdf", filename: "menu.pdf" } })] });
    expect(inbound()[0]).toMatchObject({ text: "Document: menu.pdf", media: { kind: "document", mediaId: "555", mime: "application/pdf", filename: "menu.pdf" } });
    expect(scheduled).toEqual([]);
  });
  it("a kind the app does not show is one line saying it stays on the phone, with no media", async () => {
    await deliver({ messages: [
      inMsg({ id: "wamid.V", type: "video", video: { id: "777", mime_type: "video/mp4" } }),
      inMsg({ id: "wamid.L", type: "location", location: { latitude: 28.1, longitude: -15.4 } }),
    ] });
    const ms = inbound();
    expect(ms.map((m) => m.text)).toEqual(["Video — open WhatsApp on the phone to see it", "Location — open WhatsApp on the phone to see it"]);
    expect(ms.some((m) => "media" in m)).toBe(false);
    expect(scheduled).toEqual([]);
  });
  it("a media id that could climb a path is not stored as media", async () => {
    await deliver({ messages: [inMsg({ type: "image", image: { id: "../x", mime_type: "image/jpeg" } })] });
    const [m] = inbound();
    expect(m.text).toBe("Photo — open WhatsApp on the phone to see it");
    expect("media" in m).toBe(false);
  });
  it("a redelivered message is skipped, not stored twice", async () => {
    const msg = inMsg({ type: "text", text: { body: "hola" } });
    await deliver({ messages: [msg] });
    const again = await deliver({ messages: [msg] });
    expect(again.body).toMatchObject({ messages: 0, skipped: 1 });
    expect(inbound()).toHaveLength(1);
  });
  it("messages that are not an array manufacture nothing (CT-WA-04)", async () => {
    const res = await deliver({ messages: "abc" });
    expect(res.body).toMatchObject({ messages: 0, errors: 0 });
    expect(fake.state.writes).toEqual([]);
  });
});

describe("wa-inbound — the message timestamp", () => {
  beforeEach(() => vi.stubEnv("META_APP_SECRET", SECRET));
  const tsFor = async (timestamp) => {
    fake.state.tree = {};
    await deliver({ messages: [inMsg({ timestamp, type: "text", text: { body: "hola" } })] });
    return inbound()[0].ts;
  };

  it("a timestamp that is not a number, or not positive, is now — stored, not a 500 (CT-WA-02)", async () => {
    for (const bad of ["abc", "-1", "0", ""]) {
      const before = Date.now();
      const ts = await tsFor(bad);
      expect(ts).toBeGreaterThanOrEqual(before);
      expect(ts).toBeLessThanOrEqual(Date.now());
    }
  });
  it("a future timestamp is now, and an old one is kept", async () => {
    const before = Date.now();
    expect(await tsFor("99999999999")).toBeLessThanOrEqual(Date.now());
    expect(await tsFor("99999999999")).toBeGreaterThanOrEqual(before);
    const old = Math.floor(Date.now() / 1000) - 3 * 86400;
    expect(await tsFor(String(old))).toBe(old * 1000);
  });
});

describe("wa-inbound — delivery and read receipts", () => {
  beforeEach(() => vi.stubEnv("META_APP_SECRET", SECRET));
  const seedOut = (status) => {
    fake.state.tree = { messages: { [KEY]: { o1: { id: "o1", direction: "out", text: "hi", ts: 1, status, providerMsgId: "wamid.OUT" } } } };
  };
  const receipt = (status, id = "wamid.OUT", recipient = "34600111222") => deliver({ statuses: [{ id, status, recipient_id: recipient, timestamp: nowSecs() }] });

  it("a receipt moves the message's status forward and is counted", async () => {
    seedOut("sent");
    const res = await receipt("delivered");
    expect(res.body).toMatchObject({ statuses: 1 });
    expect(fake.read("messages/" + KEY + "/o1/status")).toBe("delivered");
  });
  it("a receipt that arrives late never moves it back (CT-WA-05)", async () => {
    seedOut("read");
    const res = await receipt("delivered");
    expect(res.body).toMatchObject({ statuses: 1 });
    expect(fake.read("messages/" + KEY + "/o1/status")).toBe("read");
  });
  it("a receipt for a message nobody has, or for no recipient, writes nothing", async () => {
    seedOut("sent");
    expect((await receipt("delivered", "wamid.OTHER")).body).toMatchObject({ statuses: 0 });
    expect((await receipt("delivered", "wamid.OUT", "")).body).toMatchObject({ statuses: 0 });
    expect(fake.state.writes).toEqual([]);
  });
});

describe("wa-inbound — when to ask Meta to deliver again", () => {
  beforeEach(() => vi.stubEnv("META_APP_SECRET", SECRET));

  it("answers 500 only when everything in the payload failed", async () => {
    const realRef = fake.db.ref;
    fake.db.ref = () => { throw new Error("database unreachable"); };
    try {
      const res = await deliver({ messages: [inMsg({ type: "text", text: { body: "hola" } })] });
      expect(res.statusCode).toBe(500);
      expect(res.body).toMatchObject({ messages: 0, errors: 1 });
    } finally {
      fake.db.ref = realRef;
    }
  });
  it("answers 200 when one message failed and another was stored, so the stored one is not redelivered", async () => {
    const realRef = fake.db.ref;
    const OTHER = "+34600999888";
    fake.db.ref = (path) => { if (path.includes(OTHER)) throw new Error("refused"); return realRef(path); };
    try {
      const res = await deliver({ messages: [
        inMsg({ id: "wamid.OK", type: "text", text: { body: "hola" } }),
        inMsg({ id: "wamid.BAD", from: "34600999888", type: "text", text: { body: "hola" } }),
      ] });
      expect(res.statusCode).toBe(200);
      expect(res.body).toMatchObject({ messages: 1, errors: 1 });
    } finally {
      fake.db.ref = realRef;
    }
  });
});

describe("inboundContent", () => {
  it("a text that is only spaces is stored and not parsed", () => {
    expect(inboundContent({ type: "text", text: { body: "  " } })).toEqual({ text: "  ", media: null, snippet: "  ", parseText: null });
  });
  it("an audio's caption, should one ever arrive, is not read", () => {
    expect(inboundContent({ type: "audio", audio: { id: "1", caption: "hola" } })).toMatchObject({ text: "Audio", parseText: null });
  });
  it("a message with no type at all is a message to read on the phone", () => {
    expect(inboundContent({}).text).toBe("Message — open WhatsApp on the phone to see it");
    expect(inboundContent(null).text).toBe("Message — open WhatsApp on the phone to see it");
  });
});

// ── api/wa-sim-*.js — the simulator's three endpoints (v18.8.0) ──────────────
describe.each([
  ["wa-sim-inbound", simInboundHandler, { phone: KEY, text: "hola" }],
  ["wa-sim-suggest", simSuggestHandler, { history: [] }],
  ["wa-sim-generate", simGenerateHandler, {}],
])("%s — the kill switch, then the gate", (name, handler, body) => {
  it("answers 404 unless WA_SIM_ENABLED is exactly \"1\", before the method and before auth", async () => {
    for (const v of [undefined, "", "0", "true", "yes"]) {
      vi.stubEnv("WA_SIM_ENABLED", v);
      for (const method of ["GET", "POST"]) {
        for (const token of [undefined, "staff", "nonsense"]) {
          const res = await call(handler, { method, token, body });
          expect([v, method, token, res.statusCode]).toEqual([v, method, token, 404]);
        }
      }
    }
    expect(fake.state.writes).toEqual([]);
  });
  it("once enabled: 405 to GET, 401 without a token or with a bad one, 403 off the allow-list", async () => {
    vi.stubEnv("WA_SIM_ENABLED", "1");
    vi.stubEnv("WA_STAFF_EMAILS", "ana@example.com");
    expect((await call(handler, { method: "GET", token: "staff", body })).statusCode).toBe(405);
    expect((await call(handler, { body })).statusCode).toBe(401);
    expect((await call(handler, { token: "nonsense", body })).statusCode).toBe(401);
    expect((await call(handler, { token: "stranger", body })).statusCode).toBe(403);
    expect((await call(handler, { token: "unverified", body })).statusCode).toBe(403);
    expect(fake.state.writes).toEqual([]);
  });
});

describe("the simulator endpoints, enabled and signed in", () => {
  beforeEach(() => vi.stubEnv("WA_SIM_ENABLED", "1"));

  it("wa-sim-inbound: 400 without a phone or a text, and stores one that has both", async () => {
    expect((await call(simInboundHandler, { token: "staff", body: { text: "hola" } })).statusCode).toBe(400);
    expect((await call(simInboundHandler, { token: "staff", body: { phone: KEY, text: "  " } })).statusCode).toBe(400);
    expect(fake.state.writes).toEqual([]);
    const res = await call(simInboundHandler, { token: "staff", body: { phone: KEY, text: "hola", name: "Sim" } });
    expect([res.statusCode, res.body]).toEqual([200, { ok: true, phoneKey: KEY, skipped: false }]);
    expect(inbound()[0].text).toBe("hola");
  });
  it("wa-sim-suggest: 400 without a history, and 400 naming the key when Gemini has none", async () => {
    expect((await call(simSuggestHandler, { token: "staff", body: {} })).statusCode).toBe(400);
    const res = await call(simSuggestHandler, { token: "staff", body: { history: [] } });
    expect([res.statusCode, res.body.error]).toEqual([400, "GEMINI_API_KEY not set"]);
  });
  it("wa-sim-generate: 400 naming the key when Gemini has none, and writes nothing", async () => {
    const res = await call(simGenerateHandler, { token: "staff", body: { hint: "x" } });
    expect([res.statusCode, res.body.error]).toEqual([400, "GEMINI_API_KEY not set"]);
    expect(fake.state.writes).toEqual([]);
  });
});
