// tests/roles.test.js — v18.0.0 phase 3
//
// The pure roles model. What these guard is not "does the Admin tab render" —
// it is the four properties the whole permission model rests on, each of which
// fails SILENTLY when broken:
//
//   1. extras ADD and never subtract, so a level is a floor;
//   2. an absent or null role reads as `staff`, so flipping enforcement on
//      cannot strand an account nobody has got to yet;
//   3. `settingsAdmin` is NOT relaxed by the enforcement flag, because its
//      server-side rule is not either — a client that relaxed it would show a
//      screen whose every write the server refuses;
//   4. an admin cannot strip their own admin, which is what makes "there is
//      always at least one admin" true without a counter node.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CAPABILITIES, CAP_IDS, ROLES, ROLE_GRANTS, RULE_ENFORCED, ALWAYS_ENFORCED,
  GATED_CAPS, capLabel,
  can, isAdminEntry, effectiveRole, sanitizeRole, sanitizeRoles,
  sanitizeInvite, sanitizeInvites, normalizeEmail, wouldRemoveOwnAdmin,
  matchInvite, applyInviteFields, userRows, displayName,
} from "../src/lib/roles.js";
import { sanitizeAdminSettings, DEFAULT_ADMIN_SETTINGS, inviteIdFor } from "../src/hooks/useRoles.js";

const entry = (o = {}) => sanitizeRole(Object.assign({ uid: "u1", email: "a@b.c" }, o), "u1");

describe("the capability list", () => {
  it("uses single camelCase tokens — an RTDB key may not contain a dot", () => {
    // `extras` must be an OBJECT (rules cannot search an array), so every id
    // becomes a child key. A dotted id is unstorable, not merely untidy.
    CAP_IDS.forEach((id) => {
      expect(id).toMatch(/^[a-z][A-Za-z]*$/);
      expect(id).not.toContain(".");
    });
  });

  it("has no duplicate ids", () => {
    expect(new Set(CAP_IDS).size).toBe(CAP_IDS.length);
  });

  it("gives every capability a label and a blurb for the grid", () => {
    CAPABILITIES.forEach((c) => {
      expect(c.label.length).toBeGreaterThan(0);
      expect(c.blurb.length).toBeGreaterThan(0);
    });
  });

  it("derives RULE_ENFORCED from the list rather than re-typing it", () => {
    // The panel's "enforced by the server" badge and the rules sweep read one
    // fact. Three today; the assertion is on the DERIVATION, so adding a fourth
    // needs only the flag on the capability.
    const flagged = CAPABILITIES.filter((c) => c.enforced).map((c) => c.id);
    expect(Object.keys(RULE_ENFORCED).slice().sort()).toEqual(flagged.slice().sort());
    expect(flagged).toEqual(["bookingDelete", "settingsWrite", "settingsAdmin"]);
  });
});

describe("ROLE_GRANTS — the map is a constant, and levels nest", () => {
  it("grants only known capabilities", () => {
    ROLES.forEach((r) => {
      Object.keys(ROLE_GRANTS[r]).forEach((cap) => expect(CAP_IDS).toContain(cap));
    });
  });

  it("is a strict ladder: staff ⊂ manager ⊂ admin", () => {
    // Not decoration. The panel renders all three columns side by side as an
    // at-a-glance comparison, and a level that granted something the level
    // above did not would make that grid a lie.
    Object.keys(ROLE_GRANTS.staff).forEach((c) => expect(ROLE_GRANTS.manager[c]).toBe(true));
    Object.keys(ROLE_GRANTS.manager).forEach((c) => expect(ROLE_GRANTS.admin[c]).toBe(true));
    expect(Object.keys(ROLE_GRANTS.admin).length).toBe(CAP_IDS.length);
  });

  it("puts the staff→manager line where Patryk put it", () => {
    // The one product decision in this file, pinned so a later edit is a
    // deliberate one rather than a drift nobody notices.
    expect(ROLE_GRANTS.staff.bookingDelete).toBeUndefined();
    expect(ROLE_GRANTS.staff.settingsWrite).toBeUndefined();
    expect(ROLE_GRANTS.staff.voucherIssue).toBeUndefined();
    expect(ROLE_GRANTS.staff.bookingCreate).toBe(true);
    expect(ROLE_GRANTS.staff.voucherRedeem).toBe(true);
    expect(ROLE_GRANTS.manager.settingsAdmin).toBeUndefined();
    expect(ROLE_GRANTS.manager.customerDelete).toBeUndefined();
  });

  it("is frozen — a consumer cannot mutate what every other consumer reads", () => {
    expect(Object.isFrozen(ROLE_GRANTS)).toBe(true);
    expect(Object.isFrozen(ROLE_GRANTS.staff)).toBe(true);
  });
});

describe("effectiveRole — an absent role reads as staff", () => {
  it("maps every unknown value to staff", () => {
    [null, undefined, "", "owner", "ADMIN", 0, {}].forEach((v) => {
      expect(effectiveRole(v)).toBe("staff");
    });
  });

  it("passes the three real levels through", () => {
    ROLES.forEach((r) => expect(effectiveRole(r)).toBe(r));
  });
});

describe("can()", () => {
  it("grants everything except settingsAdmin while enforcement is off", () => {
    // This is what makes the rules deploy rolling-safe: with the flag off the
    // app behaves byte-for-byte as it did before v18.0.0.
    CAP_IDS.forEach((cap) => {
      expect(can(null, cap, false)).toBe(cap !== "settingsAdmin");
    });
  });

  it("does NOT relax settingsAdmin with the flag off, because the rule does not", () => {
    // /roles, /invites and settings/admin are new in v18.0.0 and carry no
    // pre-existing traffic, so they are admin-only from the first deploy. A
    // client that relaxed this would render an Admin tab whose every write the
    // server refuses — the UI/rule disagreement this phase exists to avoid.
    expect(ALWAYS_ENFORCED.settingsAdmin).toBe(true);
    expect(can(null, "settingsAdmin", false)).toBe(false);
    expect(can(entry({ role: "manager" }), "settingsAdmin", false)).toBe(false);
    expect(can(entry({ role: "admin" }), "settingsAdmin", false)).toBe(true);
  });

  it("reads a missing row as staff once enforcement is on", () => {
    expect(can(null, "bookingCreate", true)).toBe(true);
    expect(can(null, "bookingDelete", true)).toBe(false);
  });

  it("reads a self-registered stub (role null) as staff", () => {
    const stub = entry({ role: null });
    expect(stub.role).toBe(null);
    expect(can(stub, "bookingCreate", true)).toBe(true);
    expect(can(stub, "bookingDelete", true)).toBe(false);
  });

  it("honours an extra on top of a level", () => {
    const e = entry({ role: "staff", extras: { bookingDelete: true } });
    expect(can(e, "bookingDelete", true)).toBe(true);
    // …and grants nothing else along with it.
    expect(can(e, "settingsWrite", true)).toBe(false);
  });

  it("extras never SUBTRACT — a level is a floor", () => {
    // sanitizeExtras drops `false` outright, so a revocation cannot even be
    // stored. Written as a test because the additive model is what makes the
    // grid readable as "level plus highlights".
    const e = entry({ role: "manager", extras: { bookingDelete: false } });
    expect(e.extras.bookingDelete).toBeUndefined();
    expect(can(e, "bookingDelete", true)).toBe(true);
  });

  it("an extra can grant settingsAdmin, and the rules honour the same route", () => {
    const e = entry({ role: "manager", extras: { settingsAdmin: true } });
    expect(can(e, "settingsAdmin", true)).toBe(true);
    expect(can(e, "settingsAdmin", false)).toBe(true);
    expect(isAdminEntry(e)).toBe(true);
  });
});

describe("isAdminEntry — one question, asked in one place", () => {
  it("is true by level or by extra, false otherwise", () => {
    expect(isAdminEntry(entry({ role: "admin" }))).toBe(true);
    expect(isAdminEntry(entry({ role: "staff", extras: { settingsAdmin: true } }))).toBe(true);
    expect(isAdminEntry(entry({ role: "manager" }))).toBe(false);
    expect(isAdminEntry(null)).toBe(false);
  });
});

describe("wouldRemoveOwnAdmin — the last-admin invariant, derived", () => {
  const admin = entry({ role: "admin" });

  it("refuses an admin demoting themselves", () => {
    expect(wouldRemoveOwnAdmin("u1", "u1", admin, entry({ role: "manager" }))).toBe(true);
  });

  it("refuses an admin deleting their own row", () => {
    expect(wouldRemoveOwnAdmin("u1", "u1", admin, null)).toBe(true);
  });

  it("refuses stripping an extras-granted settingsAdmin from yourself", () => {
    const viaExtra = entry({ role: "manager", extras: { settingsAdmin: true } });
    expect(wouldRemoveOwnAdmin("u1", "u1", viaExtra, entry({ role: "manager" }))).toBe(true);
  });

  it("allows an admin demoting SOMEONE ELSE — which is what keeps the count ≥ 1", () => {
    // The whole argument: only a settingsAdmin holder may write /roles, and it
    // cannot remove its own, so the set shrinks only via a writer who still
    // holds it. Zero is unreachable without a counter node.
    expect(wouldRemoveOwnAdmin("u1", "u2", admin, entry({ role: "staff" }))).toBe(false);
  });

  it("allows an admin editing their own row in ways that keep admin", () => {
    expect(wouldRemoveOwnAdmin("u1", "u1", admin, entry({ role: "admin", name: "Pat" }))).toBe(false);
    // …including swapping the ROUTE by which they hold it.
    expect(wouldRemoveOwnAdmin("u1", "u1", admin,
      entry({ role: "manager", extras: { settingsAdmin: true } }))).toBe(false);
  });

  it("is silent about a non-admin editing their own row", () => {
    expect(wouldRemoveOwnAdmin("u1", "u1", entry({ role: "staff" }), null)).toBe(false);
  });
});

describe("sanitizeRole", () => {
  it("takes its identity from the child KEY when the row does not state one", () => {
    // The v17.16.13 lesson one collection over: mapping Object.values threw the
    // key away, a row carrying no id was minted a fresh one on EVERY read, the
    // write-diff read that as a create, and the node grew by a row per pass.
    expect(sanitizeRole({ email: "a@b.c" }, "uid-9").uid).toBe("uid-9");
    // A row that states its own uid keeps it.
    expect(sanitizeRole({ uid: "stated" }, "key").uid).toBe("stated");
  });

  it("keeps role null rather than coercing it to staff", () => {
    // `null` means "a stub no admin has given a level yet" — the whole of the
    // invite flow. Coercing it here would make that state unrenderable.
    expect(sanitizeRole({}, "u").role).toBe(null);
    expect(sanitizeRole({ role: "wizard" }, "u").role).toBe(null);
    expect(sanitizeRole({ role: "manager" }, "u").role).toBe("manager");
  });

  it("drops unknown capability ids and anything that is not exactly true", () => {
    const e = sanitizeRole({ extras: { bookingDelete: true, nonsense: true, voucherVoid: false, tableBlock: 1 } }, "u");
    expect(e.extras).toEqual({ bookingDelete: true });
  });

  it("SORTS the extras keys — the write-diff compare is key-order sensitive", () => {
    // contentKey in write-path.js is a JSON.stringify compare. Unsorted, a row
    // read back could differ from the one just written, the diff would report a
    // change that is not one, and the hook would write on every snapshot.
    const e = sanitizeRole({ extras: { voucherVoid: true, bookingDelete: true, settingsWrite: true } }, "u");
    expect(Object.keys(e.extras)).toEqual(["bookingDelete", "settingsWrite", "voucherVoid"]);
  });

  it("survives junk without throwing", () => {
    [null, undefined, 0, "x", []].forEach((v) => {
      expect(sanitizeRole(v, "u").uid).toBe("u");
    });
  });

  it("sanitizeRoles walks entries and drops rows with no identity at all", () => {
    const out = sanitizeRoles({ u1: { email: "a@b.c" }, "": { email: "x@y.z" } });
    expect(out.map((r) => r.uid)).toEqual(["u1"]);
  });

  it("sanitizeRoles returns [] for a missing node", () => {
    expect(sanitizeRoles(null)).toEqual([]);
    expect(sanitizeRoles("nope")).toEqual([]);
  });
});

describe("invites", () => {
  it("lower-cases the email, because it is a MATCH KEY", () => {
    // The panel pairs an invitation with a self-registered row by email, and
    // Firebase Auth does not promise the case a person typed at sign-up.
    expect(normalizeEmail("  Ana@Example.COM ")).toBe("ana@example.com");
    expect(sanitizeInvite({ email: " Ana@Example.COM " }, "i1").email).toBe("ana@example.com");
  });

  it("defaults an unknown role to staff — the safe direction for an invitation", () => {
    expect(sanitizeInvite({ email: "a@b.c", role: "wizard" }, "i1").role).toBe("staff");
    expect(sanitizeInvite({ email: "a@b.c", role: "admin" }, "i1").role).toBe("admin");
  });

  it("drops an invitation with no email — it could never be matched", () => {
    expect(sanitizeInvites({ i1: { role: "staff" }, i2: { email: "a@b.c" } }).map((i) => i.id))
      .toEqual(["i2"]);
  });

  it("matchInvite pairs case-insensitively and returns null for no match", () => {
    const invites = sanitizeInvites({ i1: { email: "Ana@B.c", role: "manager" } });
    expect(matchInvite(invites, "ana@b.c").id).toBe("i1");
    expect(matchInvite(invites, "ANA@B.C").id).toBe("i1");
    expect(matchInvite(invites, "other@b.c")).toBe(null);
    expect(matchInvite(invites, "")).toBe(null);
  });

  it("applyInviteFields returns only role and extras", () => {
    const inv = sanitizeInvite({ email: "a@b.c", role: "manager", extras: { bookingDelete: true, junk: true } }, "i1");
    expect(applyInviteFields(inv)).toEqual({ role: "manager", extras: { bookingDelete: true } });
  });
});

describe("userRows — what the left pane lists", () => {
  const roles = sanitizeRoles({
    u1: { email: "zoe@b.c",   name: "Zoe",   role: "staff" },
    u2: { email: "ana@b.c",   name: "Ana",   role: "admin" },
    u3: { email: "marco@b.c", name: "Marco", role: "manager" },
    u4: { email: "lu@b.c",    name: "Lucia", role: null },
  });
  const invites = sanitizeInvites({
    i1: { email: "lu@b.c",  role: "manager" },   // matches Lucia's stub
    i2: { email: "new@b.c", role: "staff" },     // nobody has signed in yet
  });

  it("orders admin → manager → staff → unapplied stub → pending invitation", () => {
    expect(userRows(roles, invites).map((r) => displayName(r)))
      .toEqual(["Ana", "Marco", "Zoe", "Lucia", "new@b.c"]);
  });

  it("shows a pending invitation for someone who has never signed in", () => {
    const pending = userRows(roles, invites).filter((r) => r.kind === "invite");
    expect(pending.map((r) => r.email)).toEqual(["new@b.c"]);
    expect(pending[0].uid).toBe(null);
  });

  it("attaches a matching invitation to the row as an OFFER, not a state", () => {
    // It rides on the row with an Apply control and changes nothing about what
    // that person can do until an admin taps it.
    const lucia = userRows(roles, invites).find((r) => r.email === "lu@b.c");
    expect(lucia.kind).toBe("user");
    expect(lucia.role).toBe(null);
    expect(lucia.invite.role).toBe("manager");
  });

  it("does not list an invitation twice once its row exists", () => {
    const rows = userRows(roles, invites);
    expect(rows.filter((r) => r.email === "lu@b.c").length).toBe(1);
  });

  it("handles empty inputs", () => {
    expect(userRows([], [])).toEqual([]);
    expect(userRows(null, null)).toEqual([]);
  });

  it("falls back name → email → uid for the displayed name", () => {
    expect(displayName({ name: "N", email: "e", uid: "u" })).toBe("N");
    expect(displayName({ email: "e", uid: "u" })).toBe("e");
    expect(displayName({ uid: "u" })).toBe("u");
    expect(displayName({})).toBe("");
  });
});

// ── The hook's two pure exports ─────────────────────────────────────────────
// Imported from the hook file, the way tests/prefs.test.js reads PREF_SPEC out
// of useUserPrefs.js. Nothing here mounts anything — these are the parts whose
// correctness is a property of a string rather than of React.
describe("sanitizeAdminSettings — absent reads as OFF", () => {
  it("defaults enforceRoles to false", () => {
    // The production state on the day this deploys is that the node does not
    // exist, and the whole rolling-deploy argument rests on that reading as off.
    expect(DEFAULT_ADMIN_SETTINGS.enforceRoles).toBe(false);
    expect(sanitizeAdminSettings(null).enforceRoles).toBe(false);
    expect(sanitizeAdminSettings({}).enforceRoles).toBe(false);
    expect(sanitizeAdminSettings({ v: 1 }).enforceRoles).toBe(false);
  });

  it("accepts ONLY boolean true — the rules test `.val() !== true`", () => {
    // A client reading "false" or 1 as ON would hide controls the database is
    // still accepting; reading them as OFF matches the server exactly. The
    // agreement is the point, not the truthiness.
    expect(sanitizeAdminSettings({ enforceRoles: true }).enforceRoles).toBe(true);
    ["true", 1, "yes", {}].forEach((v) => {
      expect(sanitizeAdminSettings({ enforceRoles: v }).enforceRoles).toBe(false);
    });
  });

  it("keeps the v marker, so RTDB cannot drop the node", () => {
    expect(sanitizeAdminSettings({ enforceRoles: false }).v).toBe(1);
  });
});

describe("inviteIdFor — an email is not a legal RTDB key", () => {
  it("strips every character RTDB forbids", () => {
    // `. $ # [ ] /` are illegal in a key, and every real address has a dot — so
    // a raw email as a key is a write that always fails.
    const id = inviteIdFor("Ana.Lopez+staff@example.co.uk");
    expect(id).not.toMatch(/[.$#[\]/]/);
    expect(id).toBe("e_ana_lopez+staff_example_co_uk");
  });

  it("is DETERMINISTIC, so two admins inviting one person do not fork", () => {
    // Same reasoning as the deterministic recurring-occurrence ids: two devices
    // write the SAME path, so the second is refused by the CAS instead of
    // creating a duplicate invitation nobody can tell apart.
    expect(inviteIdFor("ana@b.c")).toBe(inviteIdFor("  ANA@B.C  "));
  });
});

// ── Every capability that CAN be absent has a gate (v18.0.0 phase 3) ─────────
//
// The bug this exists for: `can()` shipped gating the Admin tab and nothing
// else, so with enforcement ON a staff account still had every button, every
// popup, every drag and every keyboard shortcut. It was reported from the
// keyboard, which is simply where it showed first.
//
// The guard is possible because the set is DERIVED. `staff` is the floor and
// extras only ADD, so every account holds `ROLE_GRANTS.staff` by construction
// and only the complement can ever be missing. Promote a capability above staff
// later and it joins `GATED_CAPS` automatically — and this test fails until it
// has a gate, instead of shipping an ungated action.
describe("GATED_CAPS — the capabilities a person can actually lack", () => {
  const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
  const read = (p) => readFileSync(join(ROOT, p), "utf8");
  const App = read("src/App.jsx");
  const Chrome = read("src/components/SettingsChrome.jsx");

  it("is exactly the complement of the staff floor", () => {
    expect(GATED_CAPS.slice().sort()).toEqual(
      CAP_IDS.filter((id) => !ROLE_GRANTS.staff[id]).slice().sort());
    // Every capability staff HAS is ungated on purpose — a gate there is a
    // branch that can never run.
    Object.keys(ROLE_GRANTS.staff).forEach((id) => expect(GATED_CAPS).not.toContain(id));
  });

  it("names the six the app actually gates", () => {
    // Pinned so a change to the level map is a deliberate edit here too.
    expect(GATED_CAPS).toEqual([
      "bookingDelete", "voucherIssue", "voucherVoid",
      "settingsWrite", "customerDelete", "settingsAdmin",
    ]);
  });

  it("every one of them is gated — by a tab capability or by refused()", () => {
    // Two mechanisms, deliberately: a whole TAB is the natural boundary for
    // `settingsWrite` (every control on those three writes a settings node,
    // where the alternative was a guard on ten save functions), and an ACTION
    // guard is right for the rest. What matters is that neither is missing.
    const tabCaps = [...Chrome.matchAll(/cap:\s*"([A-Za-z]+)"/g)].map((m) => m[1]);
    const refusedCaps = [...App.matchAll(/refused\("([A-Za-z]+)"\)/g)].map((m) => m[1]);
    const guarded = new Set([...tabCaps, ...refusedCaps]);
    const ungated = GATED_CAPS.filter((c) => !guarded.has(c));
    expect(ungated).toEqual([]);
  });

  it("refused() is reachable from the KEYBOARD, not only from buttons", () => {
    // The surface an audit of components misses, and the one this bug was
    // reported from. The `D` shortcut goes through App's `requestDelete`, which
    // carries the gate — it must not call `setConfirmDel` directly again.
    const kb = read("src/hooks/useKeyboardShortcuts.js");
    expect(kb).toContain("K.requestDelete(sel.id)");
    expect(kb).not.toMatch(/K\.setConfirmDel\(sel\.id\)/);
  });

  it("capLabel reads the capability's own label, so a refusal cannot drift", () => {
    expect(capLabel("bookingDelete")).toBe("delete bookings");
    expect(capLabel("settingsWrite")).toBe("change settings");
    // Unknown ids still make a sentence rather than printing "undefined".
    expect(capLabel("nope")).toBe("do that");
    CAP_IDS.forEach((id) => expect(capLabel(id).length).toBeGreaterThan(0));
  });
});
