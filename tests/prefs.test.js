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

  it("every localStorage key it names is the one App reads", () => {
    // The keys are also read by index.html's pre-mount script and written by
    // hand nowhere else; a rename here that missed a reader would flip the
    // affected pref back to its default on every device.
    const app = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
    PREF_NAMES.forEach((name) => {
      expect(app, name).not.toContain('localStorage.getItem("' + PREF_SPEC[name].ls + '")');
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
