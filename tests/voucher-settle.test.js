// tests/voucher-settle.test.js — v18.2.0 phase 48, round 3's V-3.
//
// Measured on DEV before: the strip's "Voucher not recorded" row offered
// "Settle Unsettled Probe", which opened the whole EDIT FORM. Its voucher line
// said "You will be asked how much of it the bill used when this booking is
// completed" — of a booking already completed — and what actually settled it
// was pressing Save booking, which raised the redeem prompt. Nothing said so,
// and Back left it unsettled. Settle now opens that prompt itself.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { stripComments } from "../scripts/strip-comments.mjs";
import { planSettle, settleEffects, carryOffer, carryTransform, SETTLE_GONE } from "../src/lib/voucher-settle.js";
import { normalizeCode, formatCode, remainingOf, attachedElsewhere, carryTarget } from "../src/lib/vouchers.js";
import { hasRealPhone, matchesIdentity } from "../src/lib/customers.js";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
const read = (rel) => stripComments(readFileSync(join(SRC, rel), "utf8")).join("\n");
const App = read("App.jsx");
const Modal = read("components/VoucherRedeemModal.jsx");

describe("Settle opens the redeem prompt, not the edit form", () => {
  it("raises the prompt from the strip's row, behind the redeem permission", () => {
    expect(App).toMatch(/<UnsettledBanner[^>]*onOpen=\{function\(id\)\{if\(refused\("voucherRedeem"\)\)return;setVoucherAsk\(\{id:id,status:"completed",from:"settle"\}\);\}\}/);
    expect(App, "no longer the edit form").not.toMatch(/<UnsettledBanner[^>]*openEdit\(b\)/);
  });

  it("writes no status for a settle — the booking is already completed", () => {
    // v18.6.0 (#17): the route is `planSettle`'s (lib/voucher-settle.js).
    expect(App).toMatch(/const ok=plan\.route==="settle"\?true:withRedeemAsked\(function\(\)\{/);
    expect(planSettle({ ask: { id: "b", status: "completed", from: "settle" }, bookings: [{ id: "b", status: "completed" }] })).toEqual({ route: "settle" });
  });

  // v18.2.0 /code-review: with no booking write to go first, nothing checked the
  // visit was STILL completed when the prompt was answered — walked back on
  // another device meanwhile, the redeem left a ledger entry against a booking
  // that is not completed. The check sits ABOVE the redeem, and refuses aloud.
  it("refuses a settle whose booking is no longer completed, before anything is written", () => {
    // v18.6.0 (#17): the check is `planSettle`, and App asks it above every write.
    for (const list of [[{ id: "b", status: "seated" }], [{ id: "b", status: "cancelled" }], []]) {
      expect(planSettle({ ask: { id: "b", status: "completed", from: "settle" }, bookings: list })).toEqual({ refuse: SETTLE_GONE });
    }
    const fn = App.slice(App.indexOf("function settleVoucher("), App.indexOf("function doVoucherCarry("));
    const guard = fn.indexOf("if(plan.refuse){flashRefusal(plan.refuse);return;}");
    expect(guard, "the guard").toBeGreaterThan(-1);
    expect(guard, "above the booking write").toBeLessThan(fn.indexOf("withRedeemAsked("));
    expect(guard, "above the redeem").toBeLessThan(fn.indexOf("redeemVoucher(after.code,ask.id,amount)"));
  });

  it("closes on Not now instead of completing anything", () => {
    expect(App).toMatch(/settle=\{voucherAsk\.from==="settle"\}/);
    expect(App).toMatch(/onSkip=\{function\(\)\{if\(voucherAsk\.from==="settle"\)setVoucherAsk\(null\);else settleVoucher\(0\);\}\}/);
  });

  it("says Not now and Redeem, and what the visit is, in settle mode", () => {
    expect(Modal).toMatch(/\{settle \? "Not now" : "Complete without using it"\}/);
    expect(Modal).toMatch(/\{settle \? "Redeem" : "Redeem & complete"\}/);
    expect(Modal).toMatch(/settle \? "'s visit was completed without recording this voucher\. " : "'s booking has this voucher attached\. "/);
  });
});

// v18.2.0 phase 58 (round 3's V-5 + V-6). Measured on DEV: the row's button
// read "Settle Unsettled Probe" (163px) where the strip's other rows say
// "Book" or "No show"; and the prompt's amount was `step={1}`, so "12.3" — a
// bill share the app takes — was `:invalid` (stepMismatch).
describe("the Settle row and the amount it asks for", () => {
  const Banner = read("components/UnsettledBanner.jsx");

  it("shows Settle, and names the party only to a screen reader", () => {
    expect(Banner).toMatch(/aria-label=\{"Settle " \+ who \+ "'s voucher"\}[\s\S]{0,160}>\s*Settle\s*<\/button>/);
    expect(Banner).not.toMatch(/\{"Settle " \+ who\}/);
  });

  it("takes an amount in cents", () => {
    expect(Modal).toMatch(/type="number" min=\{0\} max=\{max\} step=\{0\.01\} inputMode="decimal"/);
  });
});


// ── v18.6.0 (ROADMAP #17): the extraction, held to the code it replaced ──────
// `old*` below are BookingApp's three functions as they stood in v18.5.1, with
// the effects turned into return values. The lib must agree with them on every
// generated case.
describe("lib/voucher-settle.js agrees with the handlers it replaced", () => {
  const CODES = ["ABCD1234", "WXYZ9876"];
  const NOW = Date.parse("2026-10-09T12:00:00Z");
  const hist = (action, user) => ({ at: "T", by: user, action });

  function oldOffer(b, code, justRedeemed, bookings, vouchersByCode) {
    const v = vouchersByCode[code];
    if (!v) return null;
    const left = Math.max(0, remainingOf(v) - (Number(justRedeemed) || 0));
    if (left <= 0) return null;
    if (!hasRealPhone(b.phone) && !b.guestId) return null;
    const ident = { phone: b.phone, guestId: b.guestId };
    const mine = bookings.filter(function (x) { return matchesIdentity(x, ident); });
    const to = carryTarget(mine, code, vouchersByCode, bookings, NOW, b);
    if (!to) return null;
    return { code: code, amount: left, to: to.id, name: to.name || "", date: to.date, time: to.scheduledTime || to.time, from: b.date };
  }
  function oldSettle(ask, amount, bookings, vouchersByCode) {
    if (ask.from === "settle") {
      const cur = bookings.find(function (x) { return x.id === ask.id; });
      if (!cur || cur.status !== "completed") return { refuse: SETTLE_GONE };
    }
    const route = ask.from === "settle" ? "settle" : (ask.from !== "form" ? "status" : "form");
    const b = bookings.find(function (x) { return x.id === ask.id; });
    const code = b ? normalizeCode(b.voucherCode) : "";
    return { route, redeem: !!(code && amount), code, carry: (code && b) ? oldOffer(b, code, amount, bookings, vouchersByCode) : null };
  }
  function oldCarry(c, user) {
    const fromLabel = c.from || "";
    return function (prev) {
      if (attachedElsewhere(prev, c.code, c.to)) return prev;
      return prev.map(function (b) {
        if (b.id !== c.to || normalizeCode(b.voucherCode)) return b;
        return Object.assign({}, b, {
          voucherCode: c.code,
          history: (b.history || []).concat([hist("voucher " + formatCode(c.code) + " attached (carried from the " + fromLabel + " visit)", user)])
        });
      });
    };
  }

  // A small deterministic generator (mulberry32), so a failure is reproducible.
  function rng(seed) { return function () { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  function world(r) {
    const pick = (a) => a[Math.floor(r() * a.length)];
    const phones = ["+34 600 111 222", "+34 600 333 444", "", ""];
    const n = 2 + Math.floor(r() * 5);
    const bookings = [];
    for (let i = 0; i < n; i++) {
      bookings.push({
        id: "b" + i, name: pick(["Ana", "Bea", ""]), phone: pick(phones), guestId: pick([null, null, "g1", "g2"]),
        date: pick(["2026-10-08", "2026-10-09", "2026-10-10", "2026-10-20"]), time: pick(["13:00", "20:00"]),
        scheduledTime: pick(["", "13:30"]), status: pick(["confirmed", "seated", "completed", "cancelled", "pending"]),
        voucherCode: pick(["", "", CODES[0], CODES[1], "abcd-1234"]), returnOf: pick([null, null, "b0", "b1"]),
        history: pick([undefined, [], [{ at: "x", by: "y", action: "z" }]]),
      });
    }
    const vouchersByCode = {};
    for (const code of CODES) {
      if (r() < 0.8) {
        const value = pick([20, 50, 100]);
        const spent = pick([0, 0, 10, value]);
        vouchersByCode[code] = { code, value, remaining: value - spent, status: pick(["open", "open", "open", "void"]),
          expiresAt: pick([null, null, "2026-01-01", "2027-01-01"]), redemptions: {}, reversals: {} };
      }
    }
    return { bookings, vouchersByCode, pick };
  }

  it("planSettle + settleEffects, 20,000 cases", () => {
    const r = rng(186);
    let refused = 0, carried = 0, redeemed = 0;
    for (let i = 0; i < 20000; i++) {
      const w = world(r);
      const ask = { id: w.pick(["b0", "b1", "b2", "gone"]), status: "completed", from: w.pick(["settle", "form", "list", undefined]) };
      const amount = w.pick([0, 0, 5, 20, 50, 100, "12.5", null]);
      const want = oldSettle(ask, amount, w.bookings, w.vouchersByCode);
      const plan = planSettle({ ask, bookings: w.bookings });
      if (want.refuse) { expect(plan).toEqual({ refuse: want.refuse }); refused++; continue; }
      expect(plan).toEqual({ route: want.route });
      const got = settleEffects({ ask, amount, bookings: w.bookings, vouchersByCode: w.vouchersByCode, now: NOW });
      expect(got).toEqual({ code: want.code, redeem: want.redeem, carry: want.carry });
      if (got.carry) carried++;
      if (got.redeem) redeemed++;
    }
    // The generator has to reach every branch, or the agreement proves nothing.
    expect(refused).toBeGreaterThan(500);
    expect(carried).toBeGreaterThan(100);
    expect(redeemed).toBeGreaterThan(1000);
  });

  it("carryOffer, called directly, 20,000 cases", () => {
    const r = rng(187);
    let offers = 0;
    for (let i = 0; i < 20000; i++) {
      const w = world(r);
      const b = w.pick(w.bookings), code = w.pick(CODES), just = w.pick([0, 10, 50, undefined]);
      const want = oldOffer(b, code, just, w.bookings, w.vouchersByCode);
      expect(carryOffer({ b, code, justRedeemed: just, bookings: w.bookings, vouchersByCode: w.vouchersByCode, now: NOW })).toEqual(want);
      if (want) offers++;
    }
    expect(offers).toBeGreaterThan(100);
  });

  it("carryTransform, 20,000 cases: the same list, and the SAME array when it bails", () => {
    const r = rng(188);
    let moved = 0, bailed = 0;
    for (let i = 0; i < 20000; i++) {
      const w = world(r);
      const c = { code: w.pick(CODES), to: w.pick(["b0", "b1", "b2", "gone"]), from: w.pick(["2026-10-08", "", undefined]) };
      const want = oldCarry(c, "pat")(w.bookings);
      const got = carryTransform(c, "pat", hist)(w.bookings);
      expect(got).toEqual(want);
      expect(got === w.bookings).toBe(want === w.bookings);
      if (got === w.bookings) bailed++; else if (got.some((b, k) => b !== w.bookings[k])) moved++;
    }
    expect(moved).toBeGreaterThan(500);
    expect(bailed).toBeGreaterThan(500);
  });

  it("App keeps the order: dismiss, gate, plan, the booking write, then the money and the offer", () => {
    const fn = App.slice(App.indexOf("function settleVoucher("), App.indexOf("function doVoucherCarry("));
    const at = (t) => { const i = fn.indexOf(t); expect(i, t).toBeGreaterThan(-1); return i; };
    const order = [
      at("setVoucherAsk(null);"),
      at('if(refused("voucherRedeem")) return;'),
      at("const plan=planSettle({ask:ask,bookings:bookings});"),
      at("withRedeemAsked(function(){"),
      at("if(!ok) return;"),
      at("const after=settleEffects({ask:ask,amount:amount,bookings:bookings,vouchersByCode:vouchersByCode});"),
      at("if(after.redeem) redeemVoucher(after.code,ask.id,amount);"),
      at("if(after.carry) setVoucherCarry(after.carry);"),
    ];
    expect(order).toEqual(order.slice().sort((a, b) => a - b));
    expect(fn).toContain("doSave();\n      return !mayDispatch(saveGuardRef.current);");
    expect(App).toContain("const ok=saveBookings(carryTransform(c,getUser(),histEntry),false,goneReport(c.to));");
  });
});
