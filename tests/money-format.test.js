// tests/money-format.test.js — v18.2.0, the design critique's C3: one money
// format. "20 €", the amount then the restaurant's currency symbol, written by
// `money` (lib/vouchers.js) everywhere.
//
// Before: the List card's deposit flag read "€20" (and so did its timeline
// block's title and the printed Day sheet), while Vouchers beside it read
// "80 € left". Seven more sites built the right shape by hand, without the
// rounding: a 20 € voucher with 12.30 used leaves `20 - 12.3`, which is
// 7.699999999999999, and the redeem prompt printed it as it stood.

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { stripComments } from "../scripts/strip-comments.mjs";
import { money } from "../src/lib/vouchers.js";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
const read = (rel) => stripComments(readFileSync(join(SRC, rel), "utf8")).join("\n");

// v18.2.0 phase 45: the space is U+00A0, a NO-BREAK space. Measured on a
// 375px phone, the redeem prompt broke "20 €" into "20" at the end of one line
// and "€ left on it." at the start of the next. NB below is that character.
const NB = "\u00a0";

describe("money — the amount, then the symbol", () => {
  it("writes whole and part amounts", () => {
    expect(money(20, "€")).toBe("20" + NB + "€");
    expect(money(12.5, "€")).toBe("12.5" + NB + "€");
    expect(money(0, "€")).toBe("0" + NB + "€");
  });

  it("rounds away a floating-point remainder", () => {
    expect(20 - 12.3).toBe(7.699999999999999);
    expect(money(20 - 12.3, "€")).toBe("7.7" + NB + "€");
    expect(money(0.1 + 0.2, "€")).toBe("0.3" + NB + "€");
  });

  it("uses the restaurant's symbol, whatever it is", () => {
    expect(money(20, "£")).toBe("20" + NB + "£");
    expect(money(20, "CHF")).toBe("20" + NB + "CHF");
  });

  it("never lets a line break part the amount from its symbol", () => {
    for (const n of [0, 7.7, 20, 1250]) {
      expect(money(n, "€")).not.toMatch(/ /);
      expect(money(n, "€")).toMatch(/\u00a0€$/);
    }
  });
});

describe("every amount on screen goes through money", () => {
  it("no component puts the symbol first", () => {
    const hits = [];
    for (const f of readdirSync(join(SRC, "components"), { recursive: true })) {
      if (!/\.jsx$/.test(f)) continue;
      const src = read("components/" + f);
      if (/\(currency \|\| "€"\) \+ \w|"Deposit " \+ currency \+/.test(src)) hits.push(f);
    }
    expect(hits).toEqual([]);
  });

  it("no component builds 'N €' by hand, without the rounding", () => {
    const hits = [];
    for (const f of readdirSync(join(SRC, "components"), { recursive: true })) {
      if (!/\.jsx$/.test(f)) continue;
      const src = read("components/" + f);
      if (/\+ " " \+ currency\b/.test(src)) hits.push(f);
    }
    expect(hits).toEqual([]);
  });

  const sites = [
    ["components/ListView.jsx", /title=\{"Deposit " \+ money\(Number\(b\.deposit\), currency \|\| "€"\)\}/],
    ["components/ListView.jsx", /<DepositIcon size=\{IC\.control\} \/>\{money\(Number\(b\.deposit\), currency \|\| "€"\)\}/],
    ["components/TimelineView.jsx", /title: "Deposit " \+ money\(depositAmt, currency\),/],
    ["components/DaySheet.jsx", /\(Number\(b\.deposit\) \|\| 0\) > 0 \? money\(Number\(b\.deposit\), currency \|\| "€"\) : null,/],
    ["components/UnsettledBanner.jsx", /" still unrecorded — " \+ money\(left, currency\) \+ " on it\."/],
    ["components/VoucherCarryModal.jsx", /money\(carry\.amount, currency\) \+ " is left on voucher "/],
  ];
  for (const [file, re] of sites) {
    it(file, () => { expect(read(file)).toMatch(re); });
  }

  it("the voucher picker's three balances and the redeem prompt's three amounts", () => {
    expect((read("components/VoucherPicker.jsx").match(/money\([^)]*\), currency\) \+ " left"|money\(s\.remaining, currency\) \+ " left"/g) || []).length).toBe(3);
    expect((read("components/VoucherRedeemModal.jsx").match(/money\((max|left), currency\)/g) || []).length).toBe(3);
  });
});
