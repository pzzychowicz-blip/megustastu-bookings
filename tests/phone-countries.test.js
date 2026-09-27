// v18.1.0 — the country-code phone field's pure core (src/lib/phone-countries.js).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  COUNTRIES, countryByIso, splitPhone, joinPhone, dialLabel, cleanPinned,
  matchesCountry, flagOf, DEFAULT_PINNED, phoneHasCode, withTypedCode, numberCleared,
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
    // An edit that leaves an old code-less number untouched still saves.
    expect(save).toMatch(/if\(ph&&!phoneHasCode\(ph\)&&!phoneUntouched\)\{setErrorField\("phone"\)/);
    expect(save).toMatch(/const phoneUntouched=!!origB&&cleanPhoneOf\(origB\.phone\)===cleanPhoneOf\(fIn\.phone\);/);
  });

  it("the phone field takes no default country", () => {
    expect(Field).toMatch(/splitPhone\(value, chosen\)/);
    expect(Field).not.toMatch(/defaultIso/);
    expect(Settings, "Settings no longer offers a default country").not.toMatch(/phoneCountry/);
  });
});

describe("withTypedCode — a code typed without the plus (v18.2.0 phase 20)", () => {
  const P = DEFAULT_PINNED; // ES GB DE FR IT NL

  it("gives a pinned country's code to a long number that starts with it", () => {
    expect(withTypedCode("44 7700 900123", P)).toBe("+44 7700 900123");
    expect(withTypedCode("34612345678", P)).toBe("+34 612345678");
    expect(withTypedCode("33 6 12 34 56 78", P)).toBe("+33 6 12 34 56 78");
    expect(withTypedCode("31 6 12345678", P)).toBe("+31 6 12345678");
    expect(withTypedCode("49 151 23456789", P)).toBe("+49 151 23456789");
    expect(withTypedCode("39 312 345 6789", P)).toBe("+39 312 345 6789");
  });

  it("leaves a national number alone — too short, or led by a trunk 0", () => {
    // A Spanish mobile read as a code would be Australia (+61).
    expect(withTypedCode("612 345 678", P)).toBe("612 345 678");
    // An Italian mobile starts "31", the Netherlands' code, and is 10 digits.
    expect(withTypedCode("3123456789", P)).toBe("3123456789");
    // A German mobile, 11 digits led by its 0. (Phase 66 made the one
    // exception: a BRITISH mobile, 07…, which this test pinned as untouched.)
    expect(withTypedCode("0170 1234567", P)).toBe("0170 1234567");
  });

  it("only knows the PINNED countries", () => {
    expect(withTypedCode("48 512 345 678", P)).toBe("48 512 345 678");
    expect(withTypedCode("48 512 345 678", ["PL"])).toBe("+48 512 345 678");
    // +1 is not pinned by default: a Chinese or Brazilian national number starts with 1.
    expect(withTypedCode("1 212 555 1234", P)).toBe("1 212 555 1234");
    expect(withTypedCode("1 212 555 1234", ["US"])).toBe("+1 212 555 1234");
    expect(withTypedCode("44 7700 900123", [])).toBe("44 7700 900123");
    expect(withTypedCode("44 7700 900123", undefined)).toBe("44 7700 900123");
  });

  it("takes the longest pinned code, as splitPhone does", () => {
    expect(withTypedCode("441481 123456", ["GB", "GG"])).toBe("+44 1481 123456");
  });

  it("never touches a number that already names its code", () => {
    expect(withTypedCode("+44 7700 900123", P)).toBe("+44 7700 900123");
    expect(withTypedCode("+34 44 7700 900123", P)).toBe("+34 44 7700 900123");
    expect(withTypedCode("", P)).toBe("");
    expect(withTypedCode(null, P)).toBe(null);
  });
});

// v18.2.0 phase 52. Measured on DEV, typing "+34 622 333 444" key by key: at
// "+34" the picker took Spain and the box emptied; the SPACE then arrived in an
// empty box, "no digits" read as "cleared", the found country was forgotten,
// and the number went on without its code.
describe("numberCleared — when a found country is forgotten (v18.2.0 phase 52)", () => {
  it("is true when an edit takes the last digit out", () => {
    expect(numberCleared("612 345 678", "")).toBe(true);
    expect(numberCleared("6", "")).toBe(true);
    expect(numberCleared("612", "-")).toBe(true);
  });
  it("is false for the space after a typed code: there was no number to clear", () => {
    expect(numberCleared("", " ")).toBe(false);
    expect(numberCleared("", "")).toBe(false);
    expect(numberCleared(null, " ")).toBe(false);
  });
  it("is false while digits remain", () => {
    expect(numberCleared("612", "61")).toBe(false);
    expect(numberCleared("", "6")).toBe(false);
  });
});

describe("where the detection runs (v18.2.0 phase 20)", () => {
  const App = read("src", "App.jsx");
  const Field = read("src", "components", "PhoneField.jsx");
  const Form = read("src", "components", "BookingFormModal.jsx");

  it("the number box runs it on BLUR, only after typing in that focus, and reports it as 'detect'", () => {
    expect(Field).toMatch(/function onNumber\(e\) \{\s*typedRef\.current = true;/);
    expect(Field).toMatch(/function onBoxBlur\(e\) \{\s*if \(typedRef\.current\) \{\s*typedRef\.current = false;\s*const found = withTypedCode\(value, pinned\);/);
    expect(Field).toMatch(/onChange\(found, "detect"\);/);
    // The caller's own blur (the form closes its suggestion list) still runs.
    expect(Field).toMatch(/if \(callerBlur\) callerBlur\(e\);/);
    expect(Field).toMatch(/\{\.\.\.boxProps\}\s*onBlur=\{onBoxBlur\}/);
  });

  it("a country the FIELD found is forgotten when the number is cleared; a PICKED one stays", () => {
    // Measured before: "44 7700 900123" detected GB, the box was cleared, and a
    // French number typed without its code saved as "+44 33 6 12 34 56 78".
    expect(Field).toMatch(/function onPick\(nextIso\) \{\s*setChosen\(nextIso\);\s*foundRef\.current = false;/);
    expect(Field).toMatch(/function forgetFound\(\) \{\s*if \(!foundRef\.current\) return;\s*foundRef\.current = false;\s*setChosen\(null\);/);
    // Phase 52: CLEARED means the box had digits and has none — see below.
    expect(Field).toMatch(/if \(numberCleared\(national, s\)\) forgetFound\(\);/);
    // Both ways the field finds a country mark it as found.
    expect(Field.match(/foundRef\.current = true;/g) || []).toHaveLength(2);
  });

  it("only typing (no source) opens the form's suggestion list", () => {
    expect(Form).toMatch(/onChange=\{function\(v,src\)\{if\(!src\) setPhoneFocus\(true\);/);
  });

  it("Save runs it too — into `f`, never an untouched edit's number — before the code check", () => {
    const save = App.slice(App.indexOf("function doSave(){"));
    expect(save).toMatch(/const typedPhone=phoneUntouched\?fIn\.phone:withTypedCode\(fIn\.phone,generalSettings\.pinnedCountries\);/);
    expect(save).toMatch(/const f=typedPhone!==fIn\.phone\?Object\.assign\(\{\},fIn,\{phone:typedPhone\}\):fIn;/);
    expect(save.indexOf("withTypedCode(")).toBeLessThan(save.indexOf('setErrorField("phone")'));
    // Not written back to the form: that would clear the error this save may set.
    expect(save.slice(0, save.indexOf('setErrorField("phone")'))).not.toMatch(/setForm\(/);
  });
});

// v18.2.0 phase 66 (Patryk): a British number is 11 digits with a leading 0
// dialled at home and +44 without it from abroad, and the automatic detection
// must know it. Mobiles only (his call): the 01/02/03 landlines share their
// shape with German landlines and Egyptian mobiles.
describe("withTypedCode — the UK's own format (v18.2.0 phase 66)", () => {
  const P = DEFAULT_PINNED;

  it("gives a British mobile typed the home way its +44, without the 0", () => {
    expect(withTypedCode("07911 123456", P)).toBe("+44 7911 123456");
    expect(withTypedCode("07911123456", P)).toBe("+44 7911123456");
    expect(withTypedCode("07700 900123", P)).toBe("+44 7700 900123");
    expect(withTypedCode("(0)7911 123456", P)).toBe("+44 7911 123456");
    expect(withTypedCode("079-1112-3456", P)).toBe("+44 79-1112-3456");
  });

  it("takes only a mobile's exact shape, and only with 🇬🇧 pinned", () => {
    expect(withTypedCode("07011 123456", P), "070: personal numbers").toBe("07011 123456");
    expect(withTypedCode("07611 123456", P), "076: pagers").toBe("07611 123456");
    expect(withTypedCode("0791 112345", P), "10 digits").toBe("0791 112345");
    expect(withTypedCode("079111234567", P), "12 digits").toBe("079111234567");
    expect(withTypedCode("020 7946 0958", P), "a London landline").toBe("020 7946 0958");
    expect(withTypedCode("030 12345678", P), "Berlin, same shape as a UK 03").toBe("030 12345678");
    expect(withTypedCode("07911 123456", ["ES", "DE"])).toBe("07911 123456");
    expect(withTypedCode("07911 123456", undefined)).toBe("07911 123456");
  });

  it("drops the home 0 kept after +44, whatever is pinned", () => {
    expect(withTypedCode("+44 07911 123456", P)).toBe("+44 7911 123456");
    expect(withTypedCode("+44 (0) 7911 123456", P)).toBe("+44 7911 123456");
    expect(withTypedCode("+4407911123456", [])).toBe("+44 7911123456");
    expect(withTypedCode("0044 07911 123456", [])).toBe("+44 7911 123456");
    // A Crown dependency written the same way lands on its own code.
    expect(withTypedCode("+44 01481 234567", P)).toBe("+44 1481 234567");
    expect(splitPhone("+44 1481 234567").iso).toBe("GG");
  });

  it("leaves a number that is already right, or not British, alone", () => {
    expect(withTypedCode("+44 7911 123456", P)).toBe("+44 7911 123456");
    expect(withTypedCode("+34 612 345 678", P)).toBe("+34 612 345 678");
    expect(withTypedCode("+39 06 1234 5678", P), "Italy keeps its 0 after the code").toBe("+39 06 1234 5678");
  });

  it("files every way of typing one British mobile under ONE customer", () => {
    const one = normalizePhone("+44 7911 123456");
    // "0044 …" reaches this function as "+44 …": the phone field's joinPhone
    // stores an international "00" as "+" while it is typed.
    expect(joinPhone("GB", "0044 7911 123456")).toBe("+44 7911 123456");
    for (const typed of ["07911 123456", "+44 07911 123456", "+44 7911 123456", "44 7911 123456"]) {
      expect(normalizePhone(withTypedCode(typed, P)), typed).toBe(one);
    }
  });
});

// v18.2.0 phase 80 (round 2's loose end): "Add to waitlist" took the phone as
// typed, so phase 19's code check guarded Save and nothing else. Measured on DEV
// after: "600 111 333" pressed straight from the number box was refused on the
// phone field ("Choose the country code…", aria-invalid, nothing written);
// "34 600 111 333", pressed the same way, was stored as "+34 600 111 333".
describe("Add to waitlist takes the phone the way Save does (v18.2.0 phase 80)", () => {
  const App = read("src", "App.jsx");
  const add = App.slice(App.indexOf("function addFormToWaitlist(){"), App.indexOf("function addWalkinToWaitlist(){"));
  it("finds a code typed without its plus, then refuses a number that still names no country", () => {
    expect(add).toMatch(/const typed=withTypedCode\(f0\.phone,generalSettings\.pinnedCountries\);/);
    expect(add).toMatch(/if\(ph&&!phoneHasCode\(ph\)\)\{setErrorField\("phone"\);setError\("Choose the country code for this phone number\."\);return;\}/);
    // The refusal comes BEFORE the write, and the stored phone is the checked one.
    expect(add.indexOf("setErrorField(\"phone\")")).toBeLessThan(add.indexOf("addToWaitlist("));
    expect(add).toMatch(/phone:ph,/);
  });
  it("Save's message and this one are the same sentence", () => {
    const save = App.slice(App.indexOf("function doSave(){"));
    expect(save).toMatch(/setError\("Choose the country code for this phone number\."\)/);
  });
});
