// tests/modules.test.js — v18.0.0 phase 4
//
// The module registry. Four properties, each of which fails SILENTLY:
//
//   1. an ABSENT node reads every module at its own default, because that is
//      the production state on the day this deploys — a registry that read
//      absence as "everything off" would ship a blank app;
//   2. an unexpected stored value falls to the DEFAULT rather than to
//      truthiness, the same predicate reasoning `sanitizeAdminSettings` gives
//      for `enforceRoles`;
//   3. `withModule` changes ONE switch and leaves the others where they were,
//      which is what stops the second of two taps undoing the first;
//   4. `sanitizeAdminSettings` round-trips `modules`, which is the property the
//      whole-node write depends on — the node is replaced wholesale, so a field
//      the sanitizer drops is a field the next toggle deletes from the server.
import { describe, it, expect } from "vitest";
import {
  MODULES, MODULE_IDS, DEFAULT_MODULES,
  moduleMeta, sanitizeModules, moduleOn, withModule, hideWarning,
} from "../src/lib/modules.js";
import { sanitizeAdminSettings, DEFAULT_ADMIN_SETTINGS } from "../src/hooks/useRoles.js";

describe("the registry", () => {
  it("declares each module once, with the fields the Admin tab renders", () => {
    expect(MODULE_IDS.length).toBe(new Set(MODULE_IDS).size);
    MODULES.forEach((m) => {
      expect(typeof m.id).toBe("string");
      expect(typeof m.label).toBe("string");
      expect(typeof m.blurb).toBe("string");
      // `hides` is what an admin reads before moving the switch. A module
      // without it would present a switch whose consequence is undocumented on
      // the one screen where it is about to be pulled.
      expect(typeof m.hides).toBe("string");
      expect(typeof m.defaultEnabled).toBe("boolean");
    });
  });

  it("ships WhatsApp OFF and vouchers ON", () => {
    // Not decoration: WhatsApp's code does not exist in the app when this
    // lands (phase 5), so a default-on switch would offer to turn on a module
    // that is not there. Vouchers shipped in phase 1 and staying on is what
    // makes this phase a no-op for the restaurant on the day it deploys.
    expect(moduleMeta("whatsapp").defaultEnabled).toBe(false);
    expect(moduleMeta("vouchers").defaultEnabled).toBe(true);
  });

  it("returns null for an id it does not know", () => {
    expect(moduleMeta("nope")).toBe(null);
  });
});

describe("sanitizeModules", () => {
  it("reads an absent map as every module at its default", () => {
    expect(sanitizeModules(null)).toEqual(DEFAULT_MODULES);
    expect(sanitizeModules(undefined)).toEqual(DEFAULT_MODULES);
    expect(sanitizeModules("nonsense")).toEqual(DEFAULT_MODULES);
    expect(DEFAULT_MODULES.vouchers.enabled).toBe(true);
    expect(DEFAULT_MODULES.whatsapp.enabled).toBe(false);
  });

  it("reads a module the stored map has never heard of at its default", () => {
    // The shape a node written before a module existed has. Every module added
    // after the first deploy arrives this way.
    const stored = { vouchers: { enabled: false } };
    const out = sanitizeModules(stored);
    expect(out.vouchers.enabled).toBe(false);
    expect(out.whatsapp.enabled).toBe(false);   // its own default, not vouchers'
  });

  it("falls to the default on a value that is neither true nor false", () => {
    // The predicate that matters: a string "false" read as truthy would show a
    // module the restaurant switched off, and a bare `!!` would do exactly that.
    expect(sanitizeModules({ vouchers: { enabled: "false" } }).vouchers.enabled).toBe(true);
    expect(sanitizeModules({ whatsapp: { enabled: "true" } }).whatsapp.enabled).toBe(false);
    expect(sanitizeModules({ vouchers: { enabled: 1 } }).vouchers.enabled).toBe(true);
    expect(sanitizeModules({ vouchers: "on" }).vouchers.enabled).toBe(true);
  });

  it("drops an id the registry does not know", () => {
    // A module removed from the code must not leave a switch behind that
    // nothing honours.
    const out = sanitizeModules({ ghost: { enabled: true }, vouchers: { enabled: true } });
    expect(Object.keys(out).sort()).toEqual(MODULE_IDS.slice().sort());
  });

  it("stores a row and not a bare boolean", () => {
    // The shape is `{enabled}` so a module can carry more than a switch later
    // without a migration.
    expect(sanitizeModules(null).vouchers).toEqual({ enabled: true });
  });
});

describe("moduleOn", () => {
  it("answers from the sanitized map", () => {
    const m = sanitizeModules({ vouchers: { enabled: false }, whatsapp: { enabled: true } });
    expect(moduleOn(m, "vouchers")).toBe(false);
    expect(moduleOn(m, "whatsapp")).toBe(true);
  });

  it("falls back to the module's default on an unsanitized or partial map", () => {
    expect(moduleOn({}, "vouchers")).toBe(true);
    expect(moduleOn(null, "vouchers")).toBe(true);
    expect(moduleOn({}, "whatsapp")).toBe(false);
  });

  it("returns false for an id nothing declares", () => {
    // A typo'd gate HIDES a surface, which is visible the moment anyone looks.
    // Returning true would leave one permanently open, which is not.
    expect(moduleOn(DEFAULT_MODULES, "vouchesr")).toBe(false);
  });
});

describe("withModule", () => {
  it("changes one switch and leaves the rest alone", () => {
    const next = withModule(DEFAULT_MODULES, "vouchers", false);
    expect(next.vouchers.enabled).toBe(false);
    expect(next.whatsapp.enabled).toBe(false);
    const back = withModule(next, "whatsapp", true);
    expect(back.whatsapp.enabled).toBe(true);
    expect(back.vouchers.enabled).toBe(false);   // the earlier tap survives
  });

  it("does not mutate the map it was given", () => {
    const base = sanitizeModules(null);
    withModule(base, "vouchers", false);
    expect(base.vouchers.enabled).toBe(true);
  });

  it("ignores an unknown id rather than storing it", () => {
    expect(withModule(DEFAULT_MODULES, "ghost", true)).toEqual(DEFAULT_MODULES);
  });

  it("coerces the flag, so a truthy non-boolean cannot be stored", () => {
    expect(withModule(DEFAULT_MODULES, "whatsapp", "yes").whatsapp.enabled).toBe(false);
    expect(withModule(DEFAULT_MODULES, "whatsapp", true).whatsapp.enabled).toBe(true);
  });
});

describe("the node carries it", () => {
  it("round-trips modules through sanitizeAdminSettings", () => {
    // `settings/admin` is written WHOLE under the rev CAS, so every writer
    // sends every field. A `modules` the sanitizer dropped would be a `modules`
    // the next `enforceRoles` toggle deletes from the server — which is the
    // exact defect this phase had to fix in `setEnforceRoles`.
    const stored = { v: 1, enforceRoles: true, modules: { vouchers: { enabled: false } } };
    const out = sanitizeAdminSettings(stored);
    expect(out.enforceRoles).toBe(true);
    expect(out.modules.vouchers.enabled).toBe(false);
    expect(sanitizeAdminSettings(out)).toEqual(out);   // idempotent
  });

  it("gives an absent node every module at its default", () => {
    expect(sanitizeAdminSettings(null).modules).toEqual(DEFAULT_MODULES);
    expect(DEFAULT_ADMIN_SETTINGS.modules).toEqual(DEFAULT_MODULES);
    expect(DEFAULT_ADMIN_SETTINGS.enforceRoles).toBe(false);
  });
});

describe("hideWarning", () => {
  it("says nothing when there is nothing to lose", () => {
    // The ordinary case, and the important one: a confirm on every switch is a
    // confirm nobody reads.
    expect(hideWarning(0, "0 €")).toBe(null);
  });

  it("agrees with itself about number, in every clause", () => {
    // Four agreement points in one sentence and they were not all in step when
    // it shipped: "1 voucher is still open ... hides THEM ... brings THEM back
    // exactly as THEY ARE", measured on screen against one open voucher.
    const one = hideWarning(1, "75 €");
    expect(one).toContain("1 voucher is");
    expect(one).toContain("hides it");
    expect(one).toContain("brings it back");
    expect(one).toContain("as it is");
    expect(one).not.toMatch(/them|they are|vouchers are/);

    const many = hideWarning(3, "120 €");
    expect(many).toContain("3 vouchers are");
    expect(many).toContain("hides them");
    expect(many).toContain("brings them back");
    expect(many).toContain("as they are");
    expect(many).not.toMatch(/hides it|brings it|as it is|voucher is/);
  });

  it("states the amount it was handed, and formats none of it", () => {
    // It takes the amount ALREADY FORMATTED so this file never needs
    // `lib/vouchers.js` — the registry knows what modules exist, never what
    // they hold. A second money formatter here would be the worse of the two
    // ways out.
    expect(hideWarning(2, "12.5 €")).toContain("worth 12.5 €");
  });

  it("promises the data survives, because that is what makes it a warning and not a block", () => {
    expect(hideWarning(1, "10 €")).toContain("nothing is deleted");
  });
});
