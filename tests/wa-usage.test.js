// tests/wa-usage.test.js
//
// v18.10.0 — the WhatsApp cost counter's pure half (`src/lib/wa-usage.js`):
// which months it shows, which daily bucket belongs to which month, and what
// each month adds up to. The endpoint that asks Meta is run in
// `tests/api-handlers.test.js`; who may see the section is read here.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { stripComments } from "../scripts/strip-comments.mjs";
import {
  FREE_TIER_MONTHLY, monthBounds, monthOf, summariseUsage, pricingPoints, currencyOf, costLabel, monthName,
} from "../src/lib/wa-usage.js";
import { ROLE_GRANTS, can, sanitizeRole } from "../src/lib/roles.js";

const S = (iso) => Date.parse(iso) / 1000;
const DAY = 86400;

describe("monthBounds", () => {
  it("is last month's and this month's UTC starts, and now, in seconds", () => {
    const b = monthBounds(Date.parse("2026-10-18T09:30:00Z"));
    expect(b.thisStart).toBe(S("2026-10-01T00:00:00Z"));
    expect(b.lastStart).toBe(S("2026-09-01T00:00:00Z"));
    expect(b.end).toBe(S("2026-10-18T09:30:00Z"));
  });
  it("asks Meta from a day before last month, so a bucket cut at an eastern midnight is not left out", () => {
    const b = monthBounds(Date.parse("2026-10-18T09:30:00Z"));
    expect(b.askFrom).toBe(S("2026-08-31T00:00:00Z"));
    expect(b.askTo).toBe(b.end);
  });
  it("turns the year in January", () => {
    const b = monthBounds(Date.parse("2027-01-05T12:00:00Z"));
    expect(b.thisStart).toBe(S("2027-01-01T00:00:00Z"));
    expect(b.lastStart).toBe(S("2026-12-01T00:00:00Z"));
  });
  it("reads the UTC month on its first second and last second", () => {
    expect(monthBounds(Date.parse("2026-11-01T00:00:00Z")).thisStart).toBe(S("2026-11-01T00:00:00Z"));
    expect(monthBounds(Date.parse("2026-10-31T23:59:59Z")).thisStart).toBe(S("2026-10-01T00:00:00Z"));
  });
});

describe("monthOf — a daily bucket is filed by its middle", () => {
  const b = monthBounds(Date.parse("2026-10-18T09:30:00Z"));
  it("files a bucket cut at the account's own midnight under that day, east or west of UTC", () => {
    // Madrid in October is UTC+2: its 1 October starts at 22:00 UTC on the 30th.
    expect(monthOf({ start: S("2026-09-30T22:00:00Z"), end: S("2026-10-01T22:00:00Z") }, b)).toBe("this");
    expect(monthOf({ start: S("2026-09-29T22:00:00Z"), end: S("2026-09-30T22:00:00Z") }, b)).toBe("last");
    // Meta's own example account is Pacific: its days start at 07:00 UTC.
    expect(monthOf({ start: S("2026-10-01T07:00:00Z"), end: S("2026-10-02T07:00:00Z") }, b)).toBe("this");
    expect(monthOf({ start: S("2026-09-01T07:00:00Z"), end: S("2026-09-02T07:00:00Z") }, b)).toBe("last");
  });
  it("drops the extra day asked for before last month, and anything without a readable start", () => {
    expect(monthOf({ start: S("2026-08-31T00:00:00Z"), end: S("2026-09-01T00:00:00Z") }, b)).toBe(null);
    expect(monthOf({ start: "x", end: 1 }, b)).toBe(null);
    expect(monthOf(null, b)).toBe(null);
  });
  it("falls back to the start when the end is missing or not after it", () => {
    expect(monthOf({ start: S("2026-10-02T00:00:00Z") }, b)).toBe("this");
    expect(monthOf({ start: S("2026-09-30T23:00:00Z"), end: S("2026-09-30T23:00:00Z") }, b)).toBe("last");
  });
});

describe("summariseUsage", () => {
  const b = monthBounds(Date.parse("2026-10-18T09:30:00Z"));
  const day = (iso, type, volume, cost, category = "SERVICE") =>
    ({ start: S(iso), end: S(iso) + DAY, pricing_type: type, pricing_category: category, volume, cost });
  it("adds each month up: delivered, free, entry point, billed and cost", () => {
    const out = summariseUsage([
      day("2026-10-02T00:00:00Z", "FREE_CUSTOMER_SERVICE", 30, 0),
      day("2026-10-03T00:00:00Z", "FREE_CUSTOMER_SERVICE", 7, 0),
      day("2026-10-03T00:00:00Z", "REGULAR", 2, 0.0332),
      day("2026-10-04T00:00:00Z", "FREE_ENTRY_POINT", 4, 0),
      day("2026-09-10T00:00:00Z", "FREE_CUSTOMER_SERVICE", 120, 0),
      day("2026-08-31T00:00:00Z", "REGULAR", 99, 9.9), // the extra day: dropped
    ], b);
    expect(out.this).toEqual({ delivered: 43, free: 37, entryPoint: 4, billed: 2, cost: 0.0332 });
    expect(out.last).toEqual({ delivered: 120, free: 120, entryPoint: 0, billed: 0, cost: 0 });
  });
  it("counts a type Meta adds later as delivered, in neither column", () => {
    const out = summariseUsage([day("2026-10-02T00:00:00Z", "SOMETHING_NEW", 5, 0)], b);
    expect(out.this).toEqual({ delivered: 5, free: 0, entryPoint: 0, billed: 0, cost: 0 });
  });
  it("treats Meta's answer as input: junk, negatives and non-numbers are zero", () => {
    const out = summariseUsage([
      day("2026-10-02T00:00:00Z", "REGULAR", -3, -1),
      day("2026-10-02T00:00:00Z", "REGULAR", "7", "0.5"),
      day("2026-10-02T00:00:00Z", "REGULAR", null, NaN),
      null, "x", 4,
    ], b);
    expect(out.this).toEqual({ delivered: 7, free: 0, entryPoint: 0, billed: 7, cost: 0.5 });
    expect(summariseUsage(undefined, b).this.delivered).toBe(0);
  });
});

describe("pricingPoints / currencyOf / costLabel / monthName", () => {
  it("collects the data points from every block of Meta's answer", () => {
    const a = { pricing_analytics: { data: [{ data_points: [{ volume: 1 }] }, { data_points: [{ volume: 2 }, { volume: 3 }] }, {}, null] } };
    expect(pricingPoints(a).map((p) => p.volume)).toEqual([1, 2, 3]);
    [null, {}, { pricing_analytics: {} }, { pricing_analytics: { data: "x" } }].forEach((x) => expect(pricingPoints(x)).toEqual([]));
  });
  it("keeps only an ISO currency code", () => {
    expect(currencyOf("EUR")).toBe("EUR");
    ["eur", "EURO", "", null, 3].forEach((x) => expect(currencyOf(x)).toBe(null));
  });
  it("shows the cost to the cent, in the account's currency when Meta named it", () => {
    expect(costLabel(0.0332, "EUR")).toBe("€0.03");
    expect(costLabel(12.5, "USD")).toBe("US$12.50");
    expect(costLabel(0.0332, null)).toBe("0.03");
    expect(costLabel(-1, "EUR")).toBe("€0.00");
  });
  it("names the month from its UTC start", () => {
    expect(monthName(S("2026-10-01T00:00:00Z"))).toBe("October");
    expect(monthName(S("2026-12-01T00:00:00Z"))).toBe("December");
  });
  it("states Meta's free allowance once", () => {
    expect(FREE_TIER_MONTHLY).toBe(1000);
  });
});

// ── Who sees it ──────────────────────────────────────────────────────────────
describe("waCostView — manager and admin by default, grantable to staff", () => {
  const entry = (o) => sanitizeRole(Object.assign({ uid: "u1", email: "a@b.c" }, o), "u1");
  it("is a manager's and an admin's, not staff's", () => {
    expect(ROLE_GRANTS.manager.waCostView).toBe(true);
    expect(ROLE_GRANTS.admin.waCostView).toBe(true);
    expect(ROLE_GRANTS.staff.waCostView).toBeUndefined();
  });
  it("an extra grants it to staff, a deny takes it from a manager, with roles enforced", () => {
    expect(can(entry({ role: "staff" }), "waCostView", true)).toBe(false);
    expect(can(entry({ role: "staff", extras: { waCostView: true } }), "waCostView", true)).toBe(true);
    expect(can(entry({ role: "manager", denies: { waCostView: true } }), "waCostView", true)).toBe(false);
  });
  it("Settings gates the section on it, and the Inbox toggle stays on settingsWrite", () => {
    const src = stripComments(readFileSync(new URL("../src/components/Settings.jsx", import.meta.url), "utf8")).join("\n");
    expect(src).toContain('{allowed("waCostView") ? <WaCostSection /> : null}');
    expect(src).toMatch(/\{allowed\("settingsWrite"\) \? <Collapsible\s+title="Inbox"/);
    const chrome = stripComments(readFileSync(new URL("../src/components/SettingsChrome.jsx", import.meta.url), "utf8")).join("\n");
    expect(chrome).toContain('{ id: "whatsapp",  label: "WhatsApp", module: "whatsapp", caps: ["settingsWrite", "waCostView"] }');
  });
  it("the section asks Meta when it opens, never on mount", () => {
    const hook = stripComments(readFileSync(new URL("../src/hooks/useWaUsage.js", import.meta.url), "utf8")).join("\n");
    expect(hook).not.toMatch(/useEffect\([^)]*usageViaBackend/);
    expect(hook).toMatch(/const load = useCallback/);
    const src = stripComments(readFileSync(new URL("../src/components/Settings.jsx", import.meta.url), "utf8")).join("\n");
    const section = src.slice(src.indexOf("function WaCostSection("), src.indexOf("function BusinessAppSection("));
    expect(section).toMatch(/if \(next && !loading\) usage\.load\(\);/);
    expect(section).not.toMatch(/useEffect/);
  });
});
