// tests/wa-sim-feedback.test.js
//
// v18.4.5 — the simulator says how a server post ended.
//
// In backend mode `simulateInbound` hands the message to the server and returns
// at once. It used to swallow the rejection (a console line only) while the
// panel printed "Sent via backend", so on a deployment whose simulator
// endpoints were off every button looked dead. The caller now gets
// `ctx.onBackend(error | null)`, and `simErrorText` names the two failures a
// person meets.

import { describe, it, expect, vi, beforeEach } from "vitest";
import process from "node:process";

const state = vi.hoisted(() => ({ on: true, result: null }));
vi.mock("../src/lib/wa-backend", () => ({ backendEnabled: () => state.on, WA_BACKEND_URL: "" }));
vi.mock("../src/lib/wa-backend-sim", async (orig) => {
  const real = await orig();
  return Object.assign({}, real, { backendInbound: vi.fn(() => state.result()) });
});

import { simulateInbound } from "../src/lib/wa-sim";
import { simErrorText } from "../src/lib/wa-backend-sim";

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("simulateInbound in backend mode reports how the post ended", () => {
  beforeEach(() => { state.on = true; vi.spyOn(console, "warn").mockImplementation(() => {}); });

  it("reports null when the server took the message", async () => {
    state.result = () => Promise.resolve({ ok: true });
    const onBackend = vi.fn();
    simulateInbound({ phone: "+34600111222", text: "hola" }, { onBackend });
    await flush();
    expect(onBackend.mock.calls).toEqual([[null]]);
  });

  it("reports the error when the server refused it", async () => {
    const err = new Error("not found");
    state.result = () => Promise.reject(err);
    const onBackend = vi.fn();
    simulateInbound({ phone: "+34600111222", text: "hola" }, { onBackend });
    await flush();
    expect(onBackend.mock.calls).toEqual([[err]]);
  });

  it("a report that throws on success is not reported again as a failure", async () => {
    state.result = () => Promise.resolve({ ok: true });
    const onBackend = vi.fn(() => { throw new Error("the panel is gone"); });
    const unhandled = vi.fn();
    process.once("unhandledRejection", unhandled);
    simulateInbound({ phone: "+34600111222", text: "hola" }, { onBackend });
    await flush();
    process.removeListener("unhandledRejection", unhandled);
    expect(onBackend).toHaveBeenCalledTimes(1);
    expect(unhandled).toHaveBeenCalledTimes(1); // it surfaces as its own error, not as a second report
  });

  it("needs no callback: the console helpers pass a ctx without one", async () => {
    state.result = () => Promise.reject(new Error("boom"));
    expect(() => simulateInbound({ phone: "+34600111222", text: "hola" }, {})).not.toThrow();
    await flush();
  });

  it("does not call it in client mode, where nothing is posted", async () => {
    state.on = false;
    const onBackend = vi.fn();
    const ctx = { conversations: [], upsertConversation: vi.fn(), appendMessage: vi.fn(), onBackend };
    simulateInbound({ phone: "+34600111222", text: "hola" }, ctx);
    await flush();
    expect(onBackend).not.toHaveBeenCalled();
    expect(ctx.upsertConversation).toHaveBeenCalledTimes(1);
  });
});

describe("simErrorText", () => {
  it("deployed: the gate's 404 is named as the switch that is off", () => {
    expect(simErrorText(new Error("not found"), false)).toMatch(/WA_SIM_ENABLED/);
    expect(simErrorText(new Error("HTTP 404"), false)).toMatch(/WA_SIM_ENABLED/);
  });
  it("dev server: a failed fetch is the harness not running", () => {
    expect(simErrorText(new TypeError("Failed to fetch"), true)).toMatch(/npm run wa:backend/);
    expect(simErrorText(new TypeError("Load failed"), true)).toMatch(/npm run wa:backend/);
  });
  it("any other message is the server's own, in both modes", () => {
    expect(simErrorText(new Error("not staff"), false)).toBe("not staff");
    expect(simErrorText(new Error("HTTP 500"), true)).toBe("HTTP 500");
    // the harness answering "not found" is not the deployment's gate
    expect(simErrorText(new Error("not found"), true)).toBe("not found");
  });
  it("never throws on a missing error", () => {
    expect(simErrorText(null, false)).toBe("unknown error");
  });
});
