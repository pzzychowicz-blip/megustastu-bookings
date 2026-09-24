// v18.1.0 — the country-code phone field's pure core (src/lib/phone-countries.js).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  COUNTRIES, countryByIso, splitPhone, joinPhone, dialLabel, cleanPinned,
  matchesCountry, flagOf, DEFAULT_PINNED, phoneHasCode,
} from "../src/lib/phone-countries";
import * as phoneLib from "../src/lib/phone-countries";
import { normalizePhone } from "../src/lib/customers";
import { stripComments } from "../scripts/strip-comments.mjs";

const read = (...p) => stripComments(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", ...p), "utf8")).join("\n");

describe("the country list", () => {
  it("has every country once, with a digits-only code", () => {
    expect(COUNTRIES.length).toBeGreaterThanOrEqual(230);
    const isos = COUNTRIES.map((c) => c.iso);
    expect(new Set(isos).size).toBe(isos.length);
    for (const c of COUNTRIES) {
      expect(c.iso, c.name).toMatch(/^[A-Z]{2}$/);
      expect(c.dial, c.name).toMatch(/^\d{1,6}$/);
    }
  });
  it("seeds a pinned list of real countries", () => {
    for (const iso of DEFAULT_PINNED) expect(countryByIso(iso), iso).not.toBeNull();
  });
  it("draws a flag from the ISO code", () => {
    expect(flagOf("ES")).toBe("🇪🇸");
  });
});

describe("splitPhone", () => {
  it("reads the code off an international number and keeps the rest as typed", () => {
    expect(splitPhone("+34 600 123 456")).toEqual({ iso: "ES", national: "600 123 456" });
    expect(splitPhone("+447700900123")).toEqual({ iso: "GB", national: "7700900123" });
    expect(splitPhone("0049 170 1234567")).toEqual({ iso: "DE", national: "170 1234567" });
  });
  it("takes the LONGEST code, so an area-coded territory beats its parent", () => {
    expect(splitPhone("+1 876 555 1234").iso).toBe("JM");
    expect(splitPhone("+44 1481 123456").iso).toBe("GG");
  });
  it("settles a shared code by the preference, then by the primary country", () => {
    expect(splitPhone("+1 416 555 0100").iso).toBe("US");
    expect(splitPhone("+1 416 555 0100", "CA").iso).toBe("CA");
    expect(splitPhone("+7 701 000 0000", "KZ").iso).toBe("KZ");
    expect(splitPhone("+7 701 000 0000", "ES").iso).toBe("RU");
  });
  it("names no country for empty, a lone '+', or a legacy local number", () => {
    expect(splitPhone("", "GB")).toEqual({ iso: "GB", national: "" });
    expect(splitPhone("+", "DE")).toEqual({ iso: "DE", national: "" });
    expect(splitPhone("+34", "GB")).toEqual({ iso: "ES", national: "" });
    expect(splitPhone("600 123 456", "ES")).toEqual({ iso: "ES", national: "600 123 456" });
  });
  it("v18.2.0 phase 19: with no preference either, the country is NULL — never Spain", () => {
    expect(splitPhone("")).toEqual({ iso: null, national: "" });
    expect(splitPhone("+")).toEqual({ iso: null, national: "" });
    expect(splitPhone("600 123 456")).toEqual({ iso: null, national: "600 123 456" });
    expect(phoneLib.DEFAULT_COUNTRY, "the default country is gone").toBeUndefined();
  });
});

describe("joinPhone", () => {
  it("stores nothing for a number with no digits — never the bare code", () => {
    expect(joinPhone("ES", "")).toBe("");
    expect(joinPhone("GB", "  ")).toBe("");
  });
  it("prefixes the code, area code set apart", () => {
    expect(joinPhone("ES", "600 123 456")).toBe("+34 600 123 456");
    expect(joinPhone("JM", "555 1234")).toBe("+1 876 555 1234");
    expect(dialLabel(countryByIso("GG"))).toBe("+44 1481");
  });
  it("takes an international number typed into the number box whole", () => {
    expect(joinPhone("ES", "+44 7700 900123")).toBe("+44 7700 900123");
    expect(joinPhone("ES", "0044 7700 900123")).toBe("+44 7700 900123");
    expect(joinPhone(null, "0044 7700 900123")).toBe("+44 7700 900123");
  });
  it("v18.2.0 phase 19: with no country, keeps the number as typed — no code is invented", () => {
    expect(joinPhone(null, "600 123 456")).toBe("600 123 456");
    expect(joinPhone(undefined, "600 123 456")).toBe("600 123 456");
    expect(joinPhone(null, "  ")).toBe("");
  });
  it("round-trips to the SAME customer identity the old one-box field stored", () => {
    for (const p of ["+34 600 123 456", "+1 876 555 1234", "+44 1481 123456", "+49 170 1234567"]) {
      const { iso, national } = splitPhone(p);
      expect(normalizePhone(joinPhone(iso, national)), p).toBe(normalizePhone(p));
    }
  });
});

describe("cleanPinned / matchesCountry", () => {
  it("keeps known codes once, upper-cased, and falls back to the seed", () => {
    expect(cleanPinned(["es", "ES", "ZZ", "gb"])).toEqual(["ES", "GB"]);
    expect(cleanPinned(undefined)).toEqual(DEFAULT_PINNED);
    expect(cleanPinned([])).toEqual([]);
  });
  it("finds a country by name, ISO or code", () => {
    const es = countryByIso("ES");
    expect(matchesCountry(es, "spa")).toBe(true);
    expect(matchesCountry(es, "es")).toBe(true);
    expect(matchesCountry(es, "+34")).toBe(true);
    expect(matchesCountry(es, "44")).toBe(false);
    expect(matchesCountry(countryByIso("GB"), "king")).toBe(true);
  });
});

describe("typing into the number box (v18.1.0)", () => {
  it("keeps a trailing space so digit groups can be typed", () => {
    const stored = joinPhone("ES", "600 ");
    expect(splitPhone(stored).national).toBe("600 ");
  });
  it("dialOf names a code only once one is complete", async () => {
    const { dialOf } = await import("../src/lib/phone-countries");
    expect(dialOf("+")).toBe("");
    expect(dialOf("+3")).toBe("");
    expect(dialOf("+34")).toBe("34");
    expect(dialOf("0044 77")).toBe("44");
    expect(dialOf("600 123")).toBe("");
  });
});

describe("phoneHasCode (v18.2.0 phase 19)", () => {
  it("is true for a number that names its country — a leading + or 00", () => {
    expect(phoneHasCode("+34 600 123 456")).toBe(true);
    expect(phoneHasCode("(+34) 600 123 456")).toBe(true);
    expect(phoneHasCode("0044 7700 900123")).toBe(true);
  });
  it("is false for a local number, or a + that comes after the digits", () => {
    expect(phoneHasCode("600 123 456")).toBe(false);
    expect(phoneHasCode("07700 900123")).toBe(false);
    expect(phoneHasCode("600+34")).toBe(false);
  });
  it("agrees with normalizePhone: coded means an international key", () => {
    for (const p of ["+34 600 123 456", "(+34) 600 123 456", "600 123 456", "600+34"]) {
      expect(phoneHasCode(p), p).toBe(normalizePhone(p).charAt(0) === "+");
    }
  });
  it("has nothing to ask about an empty phone", () => {
    expect(phoneHasCode("")).toBe(true);
    expect(phoneHasCode("+")).toBe(true);
    expect(phoneHasCode(null)).toBe(true);
  });
});

describe("the booking form asks for the code (v18.2.0 phase 19)", () => {
  const App = read("src", "App.jsx");
  const Field = read("src", "components", "PhoneField.jsx");
  const Settings = read("src", "components", "Settings.jsx");

  it("no form is seeded with the Settings prefix any more", () => {
    expect(App).not.toMatch(/phone:[^,}]*generalSettings\.phonePrefix/);
    expect(App).toMatch(/phone:b\.phone\|\|""/);
    expect(App).toMatch(/phone:sourceBooking\.phone\|\|""/);
    expect(App).toMatch(/phone:w\.phone\|\|""/);
    expect(App).toMatch(/EMPTY_FORM,\{date:seedDate,phone:"",/);
  });

  it("Save refuses a typed number without a code, as the phone field's error, right after the name", () => {
    const save = App.slice(App.indexOf("function doSave(){"));
    const name = save.indexOf('setErrorField("name")');
    const phone = save.indexOf('setErrorField("phone")');
    const date = save.indexOf('setErrorField("date")');
    expect(name).toBeGreaterThan(-1);
    expect(phone).toBeGreaterThan(name);
    expect(phone).toBeLessThan(date);
    expect(save).toMatch(/if\(ph&&!phoneHasCode\(ph\)\)/);
    // An edit that leaves an old code-less number untouched still saves.
    expect(save).toMatch(/if\(!origB\|\|cleanPhoneOf\(origB\.phone\)!==ph\)\{setErrorField\("phone"\)/);
  });

  it("the phone field takes no default country", () => {
    expect(Field).toMatch(/splitPhone\(value, chosen\)/);
    expect(Field).not.toMatch(/defaultIso/);
    expect(Settings, "Settings no longer offers a default country").not.toMatch(/phoneCountry/);
  });
});
