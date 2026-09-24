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
    expect(App).toMatch(/const ok=ask\.from==="settle"\?true:withRedeemAsked\(function\(\)\{/);
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
