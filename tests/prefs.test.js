// tests/prefs.test.js - v17.14.0
//
// The localStorage convention behind the four boolean user prefs, which App had
// written out three times each (initializer, toggle, seeding effect).
//
// The house rule these encode: only the NON-DEFAULT value is ever stored, so an
// absent key means the default. Getting the direction backwards for one pref
// would silently invert it for every device that had never touched it.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { PREF_SPEC, PREF_NAMES, readPrefValue, prefLocalValue, DEFAULT_USER_PREFS,
         sanitizeUserPrefs } from "../src/hooks/useUserPrefs.js";

describe("readPrefValue - an absent key is the default", () => {
  it("whenOn defaults OFF (navLocked, reduceMotion)", () => {
    expect(readPrefValue("whenOn", null)).toBe(false);
    expect(readPrefValue("whenOn", "1")).toBe(true);
    expect(readPrefValue("whenOn", "0")).toBe(false);
    expect(readPrefValue("whenOn", "garbage")).toBe(false);
  });

  it("whenOff defaults ON (planGestures, splitEnabled)", () => {
    expect(readPrefValue("whenOff", null)).toBe(true);
    expect(readPrefValue("whenOff", "0")).toBe(false);
    expect(readPrefValue("whenOff", "1")).toBe(true);
    expect(readPrefValue("whenOff", "garbage")).toBe(true);
  });
});

describe("prefLocalValue - only the non-default is stored", () => {
  it("whenOn stores \"1\" and REMOVES on false", () => {
    expect(prefLocalValue("whenOn", true)).toBe("1");
    expect(prefLocalValue("whenOn", false)).toBe(null);
  });

  it("whenOff stores \"0\" and REMOVES on true", () => {
    expect(prefLocalValue("whenOff", false)).toBe("0");
    expect(prefLocalValue("whenOff", true)).toBe(null);
  });

  it("round-trips every pref in both directions", () => {
    PREF_NAMES.forEach((name) => {
      const store = PREF_SPEC[name].store;
      [true, false].forEach((v) => {
        expect(readPrefValue(store, prefLocalValue(store, v)), name).toBe(v);
      });
    });
  });
});

describe("PREF_SPEC agrees with everything that depends on it", () => {
  it("covers exactly the synced booleans, and not `theme`", () => {
    // theme is a tri-state string with a ?theme= override that must skip both
    // branches of the seeding effect. It stays written out in full on purpose.
    const boolFields = Object.keys(DEFAULT_USER_PREFS).filter((k) => k !== "v" && k !== "theme");
    expect([...PREF_NAMES].sort()).toEqual(boolFields.sort());
    expect(PREF_SPEC.theme).toBeUndefined();
  });

  it("App touches these keys ONLY through readPrefLS / writePref", () => {
    // /code-review: this was a negative assertion only — "App does not contain
    // localStorage.getItem(<key>)" — which passes vacuously against an App that
    // never mentions PREF_SPEC at all, and never looked at the WRITE side, so a
    // hand-written setItem was invisible to it. That is the exact drift this
    // commit found in `readSplit` (a second hand-written read of
    // "mgt-split-enabled"), so the guard has to see both directions.
    const app = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
    const offenders = [];
    PREF_NAMES.forEach((name) => {
      const key = PREF_SPEC[name].ls;
      // Any localStorage call naming one of these keys directly, anywhere in App.
      const direct = new RegExp("localStorage\\.(getItem|setItem|removeItem)\\(\\s*[\"']" + key + "[\"']", "g");
      const hits = app.match(direct);
      if (hits) offenders.push(key + " x" + hits.length);
    });
    expect(offenders, "App must reach these keys only via readPrefLS/writePref: " + offenders.join(", "))
      .toEqual([]);

    // …and the positive half, so the test cannot pass on an App that dropped
    // the mechanism entirely.
    expect(app, "App must read the four prefs through readPrefLS").toContain("readPrefLS(");
    expect(app, "App must write them through writePref").toContain("function writePref(");
    PREF_NAMES.forEach((name) => {
      expect(app, name + " must be read through readPrefLS").toContain('readPrefLS("' + name + '")');
    });
  });

  it("splitEnabled clears the SAME key App stores the split layout under", () => {
    // Two literals for one key. Turning Split View off must forget the saved
    // layout, or it returns the moment the feature is re-enabled.
    const app = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
    const m = app.match(/const SPLIT_KEY="([^"]+)"/);
    expect(m).toBeTruthy();
    expect(PREF_SPEC.splitEnabled.clears).toBe(m[1]);
  });

  it("an absent field still sanitizes to null, never to false", () => {
    // The property the whole device-fallback migration rests on: `null` means
    // "never chosen", and `false` would reset a configured device at first login.
    const s = sanitizeUserPrefs({});
    PREF_NAMES.forEach((name) => { expect(s[name], name).toBe(null); });
    expect(s.theme).toBe(null);
  });
});
