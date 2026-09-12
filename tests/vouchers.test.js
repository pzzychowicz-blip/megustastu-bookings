// tests/vouchers.test.js
//
// v18.0.0 phase 1 — the voucher model's pure core.
//
// The whole model is testable before anything renders, which is why this file
// exists before the hook and the UI. What it pins is mostly the set of things
// that would be silently wrong rather than loudly broken: a normaliser that
// destroys a printed number, a generator that re-issues a number, a state
// function that reads a voided voucher as spendable, and an expiry that hands
// out days it did not mean to.

import { describe, it, expect } from "vitest";
import {
  CODE_ALPHABET, CODE_LENGTH, MANUAL_CODE_MIN, MANUAL_CODE_MAX,
  normalizeCode, isValidCode, formatCode, generateCode, codeSet,
  clampMoney, valueOf, remainingOf, redeemedTotal,
  expiryFrom, isExpired, voucherState, isRedeemedBy, canAttach,
  attachedElsewhere, isUnsettled,
  sanitizeVoucher, sanitizeVouchers, voucherIndex,
  validateIssue, applyRedemption, removeRedemption, redeemableAmount, attachRefusal, searchVouchers,
  guestOpenVouchers, carryTarget,
} from "../src/lib/vouchers.js";

function v(o) {
  return Object.assign(
    { code: "ABCD2345", value: 50, remaining: 50, status: "open", expiresAt: null, redemptions: {} },
    o
  );
}

// A deterministic stand-in for Math.random: walks a list of 0..1 values.
function seq(values) {
  let i = 0;
  return () => values[i++ % values.length];
}

describe("normalizeCode", () => {
  it("resolves the three spellings of one code to one child", () => {
    expect(normalizeCode("abcd 2345")).toBe("ABCD2345");
    expect(normalizeCode("ABCD-2345")).toBe("ABCD2345");
    expect(normalizeCode("ABCD2345")).toBe("ABCD2345");
  });

  it("KEEPS every alphanumeric — a printed book's number survives intact", () => {
    // The regression this whole design turns on. Under the plan's original
    // wording ("strip everything outside the alphabet") these lost 0 and 1:
    // "0001234" became "234", "LOT-1001" became "T", and "0001234" collided
    // with "1234".
    expect(normalizeCode("0001234")).toBe("0001234");
    expect(normalizeCode("LOT-1001")).toBe("LOT1001");
    expect(normalizeCode("1234")).toBe("1234");
    expect(normalizeCode("0001234")).not.toBe(normalizeCode("1234"));
  });

  it("strips only punctuation and whitespace, and survives non-strings", () => {
    expect(normalizeCode("  a.b/c#d  ")).toBe("ABCD");
    expect(normalizeCode(1234)).toBe("1234");
    expect(normalizeCode(null)).toBe("");
    expect(normalizeCode(undefined)).toBe("");
    expect(normalizeCode("")).toBe("");
  });

  it("never emits a character RTDB refuses in a key", () => {
    const out = normalizeCode("a.b#c$d[e]f/g");
    expect(out).toBe("ABCDEFG");
    expect(/[.#$[\]/]/.test(out)).toBe(false);
  });
});

describe("isValidCode", () => {
  it("bounds a manual code rather than truncating it", () => {
    expect(isValidCode("AB")).toBe(false);              // under MANUAL_CODE_MIN
    expect(isValidCode("ABC")).toBe(true);              // at the floor
    expect(isValidCode("A".repeat(MANUAL_CODE_MAX))).toBe(true);
    expect(isValidCode("A".repeat(MANUAL_CODE_MAX + 1))).toBe(false);
    expect(isValidCode("")).toBe(false);
    expect(isValidCode("--")).toBe(false);              // normalises to empty
  });

  it("MANUAL_CODE_MIN is at least 3 and the ceiling is far under RTDB's key limit", () => {
    expect(MANUAL_CODE_MIN).toBeGreaterThanOrEqual(3);
    expect(MANUAL_CODE_MAX).toBeLessThan(768);
  });
});

describe("formatCode", () => {
  it("groups a generated code and leaves a manual one as typed", () => {
    expect(formatCode("ABCD2345")).toBe("ABCD-2345");
    expect(formatCode("abcd-2345")).toBe("ABCD-2345");
    // Not CODE_LENGTH: shown verbatim, so it matches the physical voucher.
    expect(formatCode("LOT1001")).toBe("LOT1001");
    expect(formatCode("0001234")).toBe("0001234");
    expect(formatCode("")).toBe("");
  });
});

describe("generateCode", () => {
  it("emits CODE_LENGTH characters, all from the unambiguous alphabet", () => {
    for (let i = 0; i < 200; i++) {
      const c = generateCode([]);
      expect(c).toHaveLength(CODE_LENGTH);
      for (const ch of c) expect(CODE_ALPHABET).toContain(ch);
    }
  });

  it("never emits a character a human confuses reading it out", () => {
    expect(CODE_ALPHABET).not.toMatch(/[01ILO]/);
    const joined = Array.from({ length: 300 }, () => generateCode([])).join("");
    expect(joined).not.toMatch(/[01ILO]/);
  });

  it("retries past a code already in use — the collision path, not the odds", () => {
    // First roll lands on AAAAAAAA (index 0 eight times), which is taken;
    // second lands on BBBBBBBB.
    const rnd = seq([0, 0, 0, 0, 0, 0, 0, 0, 1 / 31, 1 / 31, 1 / 31, 1 / 31, 1 / 31, 1 / 31, 1 / 31, 1 / 31]);
    expect(generateCode(["AAAAAAAA"], rnd)).toBe("BBBBBBBB");
  });

  it("excludes a VOIDED number — the reason a voucher is never deleted", () => {
    const rnd = seq([0, 0, 0, 0, 0, 0, 0, 0, 1 / 31, 1 / 31, 1 / 31, 1 / 31, 1 / 31, 1 / 31, 1 / 31, 1 / 31]);
    const existing = { AAAAAAAA: { code: "AAAAAAAA", status: "void", remaining: 0 } };
    expect(generateCode(existing, rnd)).toBe("BBBBBBBB");
  });

  it("excludes a MANUAL number, so the generator can never mint one twice", () => {
    const rnd = seq([0, 0, 0, 0, 0, 0, 0, 0, 1 / 31, 1 / 31, 1 / 31, 1 / 31, 1 / 31, 1 / 31, 1 / 31, 1 / 31]);
    expect(generateCode(["AAAAAAAA"], rnd)).toBe("BBBBBBBB");
    expect(generateCode([{ code: "aaaa-aaaa" }], rnd)).toBe("BBBBBBBB");
  });

  it("returns null rather than throwing when every try collides", () => {
    const rnd = () => 0; // always AAAAAAAA
    expect(generateCode(["AAAAAAAA"], rnd)).toBe(null);
  });
});

describe("codeSet", () => {
  it("accepts the four shapes a call site actually holds", () => {
    expect(codeSet(["ab-cd"]).has("ABCD")).toBe(true);
    expect(codeSet([{ code: "ab cd" }]).has("ABCD")).toBe(true);
    expect(codeSet(new Set(["abcd"])).has("ABCD")).toBe(true);
    expect(codeSet({ ABCD: { value: 10 } }).has("ABCD")).toBe(true);
    expect(codeSet(null).size).toBe(0);
  });

  it("takes the KEY as authoritative when a row's echoed code is missing", () => {
    const s = codeSet({ ZZZZ1111: { value: 10 } });
    expect(s.has("ZZZZ1111")).toBe(true);
  });
});

describe("money", () => {
  it("clamps a string, a null, a NaN and a negative in one expression", () => {
    expect(clampMoney("25")).toBe(25);
    expect(clampMoney(null)).toBe(0);
    expect(clampMoney(NaN)).toBe(0);
    expect(clampMoney(-5)).toBe(0);
    expect(clampMoney(undefined)).toBe(0);
    expect(clampMoney("abc")).toBe(0);
  });

  it("valueOf / remainingOf survive a missing voucher", () => {
    expect(valueOf(null)).toBe(0);
    expect(remainingOf(null)).toBe(0);
    expect(remainingOf(v({ remaining: -3 }))).toBe(0);
  });

  it("redeemedTotal is derived from the ledger, never stored", () => {
    expect(redeemedTotal(v({ redemptions: { b1: { amount: 20 }, b2: { amount: 10 } } }))).toBe(30);
    expect(redeemedTotal(v({ redemptions: {} }))).toBe(0);
    expect(redeemedTotal(v({ redemptions: null }))).toBe(0);
    expect(redeemedTotal(v({ redemptions: { b1: { amount: "bad" } } }))).toBe(0);
  });
});

describe("expiryFrom", () => {
  it("lands on the end of the target day, not the moment of issue", () => {
    const issued = new Date(2026, 0, 15, 21, 0, 0).getTime(); // 15 Jan 2026, 21:00
    const e = new Date(expiryFrom(issued, 12));
    expect(e.getFullYear()).toBe(2027);
    expect(e.getMonth()).toBe(0);
    expect(e.getDate()).toBe(15);
    expect(e.getHours()).toBe(23);
    expect(e.getMinutes()).toBe(59);
  });

  it("CLAMPS a day-of-month the target month does not have", () => {
    // Date.setMonth alone turns 31 Jan + 1 month into 3 March.
    const e = new Date(expiryFrom(new Date(2026, 0, 31, 12).getTime(), 1));
    expect(e.getMonth()).toBe(1);   // February
    expect(e.getDate()).toBe(28);   // 2026 is not a leap year
  });

  it("clamps into a leap February too", () => {
    const e = new Date(expiryFrom(new Date(2024, 0, 31, 12).getTime(), 1));
    expect(e.getMonth()).toBe(1);
    expect(e.getDate()).toBe(29);
  });

  it("months <= 0 means never", () => {
    expect(expiryFrom(Date.now(), 0)).toBe(null);
    expect(expiryFrom(Date.now(), -1)).toBe(null);
  });
});

describe("isExpired", () => {
  const now = new Date(2026, 5, 1).getTime();
  it("a null expiry never expires", () => {
    expect(isExpired(v({ expiresAt: null }), now)).toBe(false);
    expect(isExpired(v({ expiresAt: undefined }), now)).toBe(false);
    expect(isExpired(v({ expiresAt: "" }), now)).toBe(false);
  });
  it("compares against the stored instant", () => {
    expect(isExpired(v({ expiresAt: now - 1 }), now)).toBe(true);
    expect(isExpired(v({ expiresAt: now + 1 }), now)).toBe(false);
    expect(isExpired(v({ expiresAt: now }), now)).toBe(false); // usable on the boundary
  });
  it("an unparseable expiry does not expire the voucher", () => {
    expect(isExpired(v({ expiresAt: "soon" }), now)).toBe(false);
  });
});

describe("voucherState", () => {
  const now = new Date(2026, 5, 1).getTime();

  it("open is the ordinary case", () => {
    expect(voucherState(v(), now)).toBe("open");
  });

  it("void wins over everything, including a positive balance", () => {
    expect(voucherState(v({ status: "void" }), now)).toBe("void");
    expect(voucherState(v({ status: "void", remaining: 50, expiresAt: now - 1 }), now)).toBe("void");
  });

  it("spent beats expired — a voucher can be both, and spent is the story", () => {
    expect(voucherState(v({ remaining: 0, expiresAt: now - 1 }), now)).toBe("spent");
    expect(voucherState(v({ remaining: 0 }), now)).toBe("spent");
  });

  it("expired only once the balance is still positive", () => {
    expect(voucherState(v({ remaining: 20, expiresAt: now - 1 }), now)).toBe("expired");
  });

  it("a missing voucher reads as void, never as open", () => {
    expect(voucherState(null, now)).toBe("void");
    expect(voucherState(undefined, now)).toBe("void");
  });
});

describe("canAttach / isRedeemedBy", () => {
  const now = new Date(2026, 5, 1).getTime();

  it("an open voucher attaches", () => {
    expect(canAttach(v(), "b1", now)).toBe(true);
  });

  it("void, spent and expired do not", () => {
    expect(canAttach(v({ status: "void" }), "b1", now)).toBe(false);
    expect(canAttach(v({ remaining: 0 }), "b1", now)).toBe(false);
    expect(canAttach(v({ expiresAt: now - 1 }), "b1", now)).toBe(false);
    expect(canAttach(null, "b1", now)).toBe(false);
  });

  it("a booking that already spent it KEEPS its link at zero remaining", () => {
    // Otherwise editing the booking that spent the last of a voucher would be
    // told the voucher is spent and made to drop a record of what happened.
    const spent = v({ remaining: 0, redemptions: { b1: { amount: 50 } } });
    expect(canAttach(spent, "b1", now)).toBe(true);
    expect(canAttach(spent, "b2", now)).toBe(false);
  });

  it("isRedeemedBy needs both a ledger entry and a booking id", () => {
    expect(isRedeemedBy(v({ redemptions: { b1: { amount: 5 } } }), "b1")).toBe(true);
    expect(isRedeemedBy(v({ redemptions: { b1: { amount: 5 } } }), "b2")).toBe(false);
    expect(isRedeemedBy(v(), "b1")).toBe(false);
    expect(isRedeemedBy(v({ redemptions: { b1: { amount: 5 } } }), "")).toBe(false);
  });
});

describe("attachedElsewhere", () => {
  const bk = (o) => Object.assign({ id: "b1", status: "confirmed", voucherCode: "" }, o);

  it("finds a live booking holding the same code", () => {
    const list = [bk({ id: "b1", voucherCode: "ABCD2345" }), bk({ id: "b2" })];
    expect(attachedElsewhere(list, "abcd-2345", "b2").id).toBe("b1");
  });

  it("does not report the booking asking the question", () => {
    const list = [bk({ id: "b1", voucherCode: "ABCD2345" })];
    expect(attachedElsewhere(list, "ABCD2345", "b1")).toBe(null);
  });

  it("a terminal booking's link is a record, not a live claim", () => {
    const done = [bk({ id: "b1", voucherCode: "ABCD2345", status: "completed" })];
    const gone = [bk({ id: "b1", voucherCode: "ABCD2345", status: "cancelled" })];
    expect(attachedElsewhere(done, "ABCD2345", "b2")).toBe(null);
    expect(attachedElsewhere(gone, "ABCD2345", "b2")).toBe(null);
  });

  it("a seated booking IS a live claim", () => {
    const seated = [bk({ id: "b1", voucherCode: "ABCD2345", status: "seated" })];
    expect(attachedElsewhere(seated, "ABCD2345", "b2").id).toBe("b1");
  });

  it("survives a missing code or a missing list", () => {
    expect(attachedElsewhere([], "ABCD2345", "b1")).toBe(null);
    expect(attachedElsewhere(null, "ABCD2345", "b1")).toBe(null);
    expect(attachedElsewhere([bk({})], "", "b1")).toBe(null);
  });
});

describe("isUnsettled", () => {
  const idx = { ABCD2345: v({ redemptions: {} }) };
  const settled = { ABCD2345: v({ redemptions: { b1: { amount: 50 } } }) };
  const bk = (o) => Object.assign({ id: "b1", status: "completed", voucherCode: "ABCD2345" }, o);

  it("a completed booking with an unredeemed voucher is unsettled", () => {
    // Exactly what the close-time auto-complete leaves behind: it flips a
    // seated booking to completed with nobody present, and must never redeem.
    expect(isUnsettled(bk(), idx)).toBe(true);
  });

  it("a redeemed one is not", () => {
    expect(isUnsettled(bk(), settled)).toBe(false);
  });

  it("only a COMPLETED booking can be unsettled", () => {
    expect(isUnsettled(bk({ status: "seated" }), idx)).toBe(false);
    expect(isUnsettled(bk({ status: "confirmed" }), idx)).toBe(false);
    expect(isUnsettled(bk({ status: "cancelled" }), idx)).toBe(false);
  });

  it("no voucher, no unknown code, no crash", () => {
    expect(isUnsettled(bk({ voucherCode: "" }), idx)).toBe(false);
    expect(isUnsettled(bk({ voucherCode: "NOPE9999" }), idx)).toBe(false);
    expect(isUnsettled(null, idx)).toBe(false);
    expect(isUnsettled(bk(), null)).toBe(false);
  });
});

describe("sanitizeVoucher", () => {
  it("takes the CHILD KEY as the identity, not the stored echo", () => {
    // v17.16.13's lesson one collection over — except that here the key IS the
    // code, so a row disagreeing with its own key must lose.
    expect(sanitizeVoucher({ code: "WRONG123" }, "ABCD2345").code).toBe("ABCD2345");
    expect(sanitizeVoucher({ code: "abcd-2345" }, null).code).toBe("ABCD2345");
  });

  it("seeds an absent remaining from value, never from zero", () => {
    // Reading a row written by anything but this app as already spent would
    // silently swallow a customer's balance.
    expect(sanitizeVoucher({ value: 50 }, "A1").remaining).toBe(50);
    expect(sanitizeVoucher({ value: 50, remaining: 0 }, "A1").remaining).toBe(0);
    expect(sanitizeVoucher({ value: 50, remaining: 20 }, "A1").remaining).toBe(20);
  });

  it("fills every gap so no consumer has to guard", () => {
    const s = sanitizeVoucher({}, "ABCD2345");
    expect(s).toMatchObject({
      code: "ABCD2345", value: 0, remaining: 0, notes: "", status: "open",
      origin: "generated", issuedAt: 0, issuedBy: "", expiresAt: null, updatedAt: 0,
    });
    expect(s.redemptions).toEqual({});
  });

  it("pins status and origin to their known values", () => {
    expect(sanitizeVoucher({ status: "weird" }, "A1").status).toBe("open");
    expect(sanitizeVoucher({ status: "void" }, "A1").status).toBe("void");
    expect(sanitizeVoucher({ origin: "manual" }, "A1").origin).toBe("manual");
    expect(sanitizeVoucher({ origin: "typo" }, "A1").origin).toBe("generated");
  });

  it("clamps money the deposit way", () => {
    expect(sanitizeVoucher({ value: "50", remaining: -1 }, "A1")).toMatchObject({ value: 50, remaining: 0 });
    expect(sanitizeVoucher({ value: NaN }, "A1").value).toBe(0);
  });
});

describe("sanitizeVouchers / voucherIndex", () => {
  it("walks ENTRIES so each row keeps its key", () => {
    const out = sanitizeVouchers({ ABCD2345: { value: 50 }, LOT1001: { value: 10, origin: "manual" } });
    expect(out.map((x) => x.code).sort()).toEqual(["ABCD2345", "LOT1001"]);
    expect(out.find((x) => x.code === "LOT1001").origin).toBe("manual");
  });

  it("drops a row whose key normalises to nothing", () => {
    expect(sanitizeVouchers({ "---": { value: 1 } })).toHaveLength(0);
  });

  it("survives a null or non-object node", () => {
    expect(sanitizeVouchers(null)).toEqual([]);
    expect(sanitizeVouchers("nope")).toEqual([]);
  });

  it("voucherIndex keys by code", () => {
    const idx = voucherIndex(sanitizeVouchers({ ABCD2345: { value: 50 } }));
    expect(idx.ABCD2345.value).toBe(50);
    expect(voucherIndex(null)).toEqual({});
  });
});

// ── Mutations ────────────────────────────────────────────────────────────────
// These live in lib/ rather than in useVouchers.js for v17.8.0's reason: logic
// that decides something the restaurant acts on does not live in a hook. This
// is money, so it is tested rather than trusted.

describe("validateIssue", () => {
  it("blank code generates; a typed one is used as given", () => {
    const gen = validateIssue({ code: "", value: 50, taken: [] });
    expect(gen.ok).toBe(true);
    expect(gen.origin).toBe("generated");
    expect(gen.code).toHaveLength(CODE_LENGTH);

    const man = validateIssue({ code: "lot 1001", value: 50, taken: [] });
    expect(man).toMatchObject({ ok: true, code: "LOT1001", origin: "manual", value: 50 });
  });

  it("refuses a duplicate and a malformed number DIFFERENTLY", () => {
    // Staff can act on the difference, so the messages must not be one message.
    const dup = validateIssue({ code: "LOT1001", value: 50, taken: ["lot-1001"] });
    const bad = validateIssue({ code: "AB", value: 50, taken: [] });
    expect(dup.ok).toBe(false);
    expect(bad.ok).toBe(false);
    expect(dup.error).not.toBe(bad.error);
    expect(dup.error).toMatch(/already in use/i);
  });

  it("refuses a zero or negative amount", () => {
    expect(validateIssue({ code: "", value: 0, taken: [] }).ok).toBe(false);
    expect(validateIssue({ code: "", value: -5, taken: [] }).ok).toBe(false);
    expect(validateIssue({ code: "", value: "abc", taken: [] }).ok).toBe(false);
  });

  it("clamps a string amount rather than refusing it", () => {
    expect(validateIssue({ code: "", value: "50", taken: [] }).value).toBe(50);
  });

  it("never generates a number already taken, whatever its origin", () => {
    const taken = new Set();
    for (let i = 0; i < 60; i++) {
      const r = validateIssue({ code: "", value: 10, taken: taken });
      expect(r.ok).toBe(true);
      expect(taken.has(r.code)).toBe(false);
      taken.add(r.code);
    }
    expect(taken.size).toBe(60);
  });
});

// ── v18.0.0 session 8 (items 2b, 7) — a guest's vouchers follow them ────────
describe("guestOpenVouchers", () => {
  const NOW = 5000;
  const open = (code, value) => sanitizeVoucher({ value, remaining: value, issuedAt: 1000 }, code);
  const bk = (o) => Object.assign(
    { id: "b1", date: "2026-09-01", time: "20:00", status: "completed", voucherCode: "" }, o);

  it("offers a code the guest has used whose voucher is still open", () => {
    const idx = { ABCD2345: open("ABCD2345", 50) };
    const out = guestOpenVouchers([bk({ voucherCode: "ABCD2345" })], idx, [], NOW, null);
    expect(out.map((e) => e.code)).toEqual(["ABCD2345"]);
    expect(out[0].remaining).toBe(50);
  });

  it("skips a voucher that is spent or void — a dead end is not a suggestion", () => {
    const spent = applyRedemption(open("ABCD2345", 50), "bx", 50, 1000, "me");
    expect(guestOpenVouchers([bk({ voucherCode: "ABCD2345" })], { ABCD2345: spent }, [], NOW, null)).toEqual([]);
    const voided = sanitizeVoucher(Object.assign({}, open("BBBB2345", 50), { status: "void" }), "BBBB2345");
    expect(guestOpenVouchers([bk({ voucherCode: "BBBB2345" })], { BBBB2345: voided }, [], NOW, null)).toEqual([]);
  });

  it("skips one already on another LIVE booking — the one-live-booking rule", () => {
    const idx = { ABCD2345: open("ABCD2345", 50) };
    const live = [bk({ id: "other", status: "confirmed", voucherCode: "ABCD2345" })];
    expect(guestOpenVouchers([bk({ voucherCode: "ABCD2345" })], idx, live, NOW, null)).toEqual([]);
  });

  it("is newest use first, and names each code once", () => {
    const idx = { ABCD2345: open("ABCD2345", 50), BBBB2345: open("BBBB2345", 20) };
    const list = [
      bk({ id: "old", date: "2026-08-01", voucherCode: "ABCD2345" }),
      bk({ id: "new", date: "2026-09-10", voucherCode: "BBBB2345" }),
      bk({ id: "dup", date: "2026-07-01", voucherCode: "BBBB2345" }),
    ];
    expect(guestOpenVouchers(list, idx, [], NOW, null).map((e) => e.code)).toEqual(["BBBB2345", "ABCD2345"]);
  });

  it("flags a visit that completed without recording the voucher, rather than hiding it", () => {
    const idx = { ABCD2345: open("ABCD2345", 50) };
    const out = guestOpenVouchers([bk({ voucherCode: "ABCD2345" })], idx, [], NOW, null);
    expect(out[0].unsettled, "completed, carrying a code, no ledger entry").toBe(true);
  });

  it("excludes the booking being written, and survives nothing to say", () => {
    const idx = { ABCD2345: open("ABCD2345", 50) };
    expect(guestOpenVouchers([bk({ id: "me", voucherCode: "ABCD2345" })], idx, [], NOW, "me")).toEqual([]);
    expect(guestOpenVouchers(null, idx, [], NOW, null)).toEqual([]);
    expect(guestOpenVouchers([bk({ voucherCode: "ZZZZ9999" })], idx, [], NOW, null),
      "a code with no voucher behind it").toEqual([]);
  });
});

// ── v18.0.0 session 8 (item 7) — where a leftover balance goes next ─────────
describe("carryTarget", () => {
  const NOW = 5000;
  const open = (code, value) => sanitizeVoucher({ value, remaining: value, issuedAt: 1000 }, code);
  const idx = { ABCD2345: open("ABCD2345", 50) };
  const from = { id: "done", date: "2026-09-01", time: "20:00", status: "completed", voucherCode: "ABCD2345" };
  const bk = (o) => Object.assign(
    { id: "n1", date: "2026-09-18", time: "20:30", status: "confirmed", voucherCode: "" }, o);

  it("offers the guest's next live booking", () => {
    const t = carryTarget([from, bk({})], "ABCD2345", idx, [from, bk({})], NOW, from);
    expect(t && t.id).toBe("n1");
  });

  it("prefers the booking made BY Book Again from this visit", () => {
    const early = bk({ id: "early", date: "2026-09-05" });
    const again = bk({ id: "again", date: "2026-09-30", returnOf: "done" });
    const t = carryTarget([from, early, again], "ABCD2345", idx, [], NOW, from);
    expect(t && t.id, "the guest said 'again', and this is the again").toBe("again");
  });

  it("takes the earliest when no booking points back at this visit", () => {
    const later = bk({ id: "later", date: "2026-10-01" });
    const sooner = bk({ id: "sooner", date: "2026-09-05" });
    const t = carryTarget([from, later, sooner], "ABCD2345", idx, [], NOW, from);
    expect(t && t.id).toBe("sooner");
  });

  it("never targets a booking that already carries a voucher", () => {
    const taken = bk({ voucherCode: "BBBB2345" });
    expect(carryTarget([from, taken], "ABCD2345", idx, [], NOW, from),
      "two vouchers on one bill is a question this prompt cannot ask").toBe(null);
  });

  it("ignores cancelled, completed and earlier bookings", () => {
    expect(carryTarget([from, bk({ status: "cancelled" })], "ABCD2345", idx, [], NOW, from)).toBe(null);
    expect(carryTarget([from, bk({ status: "completed" })], "ABCD2345", idx, [], NOW, from)).toBe(null);
    expect(carryTarget([from, bk({ date: "2026-08-01" })], "ABCD2345", idx, [], NOW, from),
      "a visit before the one that just ended").toBe(null);
  });

  it("says nothing when the voucher is spent, void, or already following somebody", () => {
    const spent = applyRedemption(open("ABCD2345", 50), "bx", 50, 1000, "me");
    expect(carryTarget([from, bk({})], "ABCD2345", { ABCD2345: spent }, [], NOW, from)).toBe(null);
    const elsewhere = [bk({ id: "other", voucherCode: "ABCD2345" })];
    expect(carryTarget([from, bk({})], "ABCD2345", idx, elsewhere, NOW, from)).toBe(null);
  });

  it("survives having nothing to work with", () => {
    expect(carryTarget([], "ABCD2345", idx, [], NOW, from)).toBe(null);
    expect(carryTarget(null, "ABCD2345", idx, [], NOW, from)).toBe(null);
    expect(carryTarget([bk({})], "", idx, [], NOW, from)).toBe(null);
    expect(carryTarget([bk({})], "ABCD2345", idx, [], NOW, null)).toBe(null);
  });
});

describe("applyRedemption / removeRedemption", () => {
  const base = () => sanitizeVoucher({ value: 50, remaining: 50 }, "ABCD2345");

  it("records the entry and recomputes the balance", () => {
    const r = applyRedemption(base(), "b1", 20, 1000, "me@x");
    expect(r.remaining).toBe(30);
    expect(r.redemptions.b1).toEqual({ amount: 20, at: 1000, by: "me@x" });
    expect(voucherState(r, 2000)).toBe("open");
  });

  it("is IDEMPOTENT — a retry-queue replay cannot double-spend", () => {
    // The property the ledger-keyed-by-booking design was chosen for, and the
    // reason remaining is recomputed rather than decremented: a decrement
    // applied twice is wrong, a recompute applied twice is the same answer.
    const once = applyRedemption(base(), "b1", 20, 1000, "me");
    const twice = applyRedemption(once, "b1", 20, 2000, "me");
    expect(twice.remaining).toBe(30);
    expect(Object.keys(twice.redemptions)).toEqual(["b1"]);
  });

  it("two bookings both spend, and the total is the ledger's", () => {
    const a = applyRedemption(base(), "b1", 20, 1000, "me");
    const b = applyRedemption(a, "b2", 30, 2000, "me");
    expect(b.remaining).toBe(0);
    expect(redeemedTotal(b)).toBe(50);
    expect(voucherState(b, 3000)).toBe("spent");
  });

  it("never drives the balance negative", () => {
    const over = applyRedemption(base(), "b1", 999, 1000, "me");
    expect(over.remaining).toBe(0);
  });

  it("removeRedemption is the exact inverse", () => {
    const a = applyRedemption(base(), "b1", 20, 1000, "me");
    const b = applyRedemption(a, "b2", 30, 2000, "me");
    const back = removeRedemption(b, "b2");
    expect(back.remaining).toBe(30);
    expect(Object.keys(back.redemptions)).toEqual(["b1"]);
    expect(removeRedemption(back, "b1").remaining).toBe(50);
  });

  it("removing an entry that was never there changes nothing", () => {
    const v = base();
    expect(removeRedemption(v, "nope")).toBe(v);
    expect(applyRedemption(null, "b1", 5, 1, "me")).toBe(null);
  });

  // ── v18.0.0 session 8 (item 5a) — the reversal leaves a record ─────────────
  it("moves the entry into `reversals` instead of dropping it", () => {
    const a = applyRedemption(base(), "b1", 20, 1000, "her@x");
    const back = removeRedemption(a, "b1", 2000, "him@x");
    expect(Object.keys(back.redemptions), "gone from the ledger").toEqual([]);
    expect(back.reversals.b1_2000).toEqual({
      bookingId: "b1", amount: 20,
      redeemedAt: 1000, redeemedBy: "her@x",
      reversedAt: 2000, reversedBy: "him@x",
    });
  });

  it("keeps BOTH when a voucher is redeemed, reversed, redeemed and reversed again", () => {
    // Keyed per REVERSAL, not per booking — the same booking can do this twice.
    let v = applyRedemption(base(), "b1", 20, 1000, "me");
    v = removeRedemption(v, "b1", 2000, "me");
    v = applyRedemption(v, "b1", 25, 3000, "me");
    v = removeRedemption(v, "b1", 4000, "me");
    expect(Object.keys(v.reversals).sort()).toEqual(["b1_2000", "b1_4000"]);
    expect(v.reversals.b1_2000.amount).toBe(20);
    expect(v.reversals.b1_4000.amount).toBe(25);
  });

  it("leaves the balance derived from the LEDGER, not from the record", () => {
    const a = applyRedemption(base(), "b1", 20, 1000, "me");
    const back = removeRedemption(a, "b1", 2000, "me");
    expect(back.remaining, "the money came back in full").toBe(50);
    expect(redeemedTotal(back)).toBe(0);
  });

  // THE SILENT TRAP. sanitizeVoucher is a whitelist: a field missing from it is
  // deleted by the next write to that voucher, with no error anywhere.
  it("survives an unrelated write to the same voucher", () => {
    const a = applyRedemption(base(), "b1", 20, 1000, "me");
    const back = removeRedemption(a, "b1", 2000, "me");
    const later = sanitizeVoucher(Object.assign({}, back, { notes: "left a note" }), back.code);
    expect(later.notes).toBe("left a note");
    expect(later.reversals.b1_2000, "the trail is still there").toBeTruthy();
    expect(later.reversals.b1_2000.amount).toBe(20);
  });

  it("keeps the reversals' keys sorted, for contentKey's key-order compare", () => {
    let v = applyRedemption(base(), "b2", 10, 1000, "me");
    v = removeRedemption(v, "b2", 9000, "me");
    v = applyRedemption(v, "b1", 10, 1000, "me");
    v = removeRedemption(v, "b1", 3000, "me");
    expect(Object.keys(v.reversals)).toEqual(["b1_3000", "b2_9000"]);
  });

  it("keeps the ledger's keys SORTED, so the write-diff sees no phantom change", () => {
    // write-path.js's contentKey is a JSON.stringify compare and is key-order
    // sensitive. Without the sort, a ledger read back from RTDB could differ
    // from the one just written and the hook would write on every snapshot.
    const v = applyRedemption(applyRedemption(base(), "zz", 5, 1, "m"), "aa", 5, 2, "m");
    expect(Object.keys(v.redemptions)).toEqual(["aa", "zz"]);
    expect(JSON.stringify(v)).toBe(JSON.stringify(sanitizeVoucher(v, v.code)));
  });
});

describe("redeemableAmount", () => {
  it("is bounded by the balance and never negative", () => {
    const v = sanitizeVoucher({ value: 50, remaining: 20 }, "A1");
    expect(redeemableAmount(v, 100)).toBe(20);
    expect(redeemableAmount(v, 5)).toBe(5);
    expect(redeemableAmount(v, -5)).toBe(0);
    expect(redeemableAmount(sanitizeVoucher({ value: 0 }, "A1"), 10)).toBe(0);
  });
});

describe("attachRefusal", () => {
  const now = new Date(2026, 5, 1).getTime();
  const bk = (o) => Object.assign({ id: "b1", name: "Pau", date: "2026-06-01", status: "confirmed", voucherCode: "" }, o);

  it("an open voucher attaches with no refusal", () => {
    expect(attachRefusal(v(), "ABCD2345", [], "b2", now)).toBe("");
  });

  it("gives each refusal its OWN message — they are different problems", () => {
    // Collapsing these into "can't use that voucher" would tell staff nothing
    // they can act on: one is reissue, one is wait, one is go and find it.
    const missing = attachRefusal(null, "NOPE", [], "b2", now);
    const voided = attachRefusal(v({ status: "void" }), "ABCD2345", [], "b2", now);
    const spent = attachRefusal(v({ remaining: 0 }), "ABCD2345", [], "b2", now);
    const expired = attachRefusal(v({ expiresAt: now - 1 }), "ABCD2345", [], "b2", now);
    const elsewhere = attachRefusal(v(), "ABCD2345",
      [bk({ id: "b1", voucherCode: "ABCD2345" })], "b2", now);
    const all = [missing, voided, spent, expired, elsewhere];
    all.forEach((m) => expect(m).toBeTruthy());
    expect(new Set(all).size).toBe(5);
    expect(elsewhere).toMatch(/Pau/);
    expect(elsewhere).toMatch(/2026-06-01/);
  });

  it("a booking already settled against it keeps it, whatever the state says", () => {
    // Otherwise reopening the booking that spent the voucher would be refused
    // the link to the record of its own payment.
    const spentHere = v({ remaining: 0, redemptions: { b1: { amount: 50 } } });
    expect(attachRefusal(spentHere, "ABCD2345", [], "b1", now)).toBe("");
    expect(attachRefusal(spentHere, "ABCD2345", [], "b2", now)).toBeTruthy();
  });

  it("a TERMINAL booking's link does not block a new attach", () => {
    const done = [bk({ id: "b1", voucherCode: "ABCD2345", status: "completed" })];
    expect(attachRefusal(v(), "ABCD2345", done, "b2", now)).toBe("");
  });
});

describe("searchVouchers", () => {
  const mk = (o) => sanitizeVoucher(Object.assign({ value: 50, remaining: 50, issuedAt: 1 }, o), o.code);
  const list = [
    mk({ code: "ABCD2345", notes: "Birthday gift for Ana", issuedAt: 3 }),
    mk({ code: "LOT1001", notes: "", issuedAt: 2 }),
    mk({ code: "QRST6789", notes: "Anniversary", issuedAt: 1 }),
    mk({ code: "VOIDED11", status: "void", issuedAt: 9 }),
    mk({ code: "SPENT111", remaining: 0, issuedAt: 9 }),
    mk({ code: "EXPIRED1", expiresAt: 1, issuedAt: 9 }),
  ];

  it("offers ONLY open vouchers — a dropdown is a list of things you can pick", () => {
    // Void, spent and expired are all refused by attachRefusal a moment later,
    // so offering them is offering a dead end.
    const codes = searchVouchers(list, "").map((v) => v.code);
    expect(codes).toEqual(["ABCD2345", "LOT1001", "QRST6789"]);
  });

  it("an empty query lists them all, newest first", () => {
    expect(searchVouchers(list, "").map((v) => v.issuedAt)).toEqual([3, 2, 1]);
  });

  it("matches the code NORMALISED, so a typed spelling finds it", () => {
    expect(searchVouchers(list, "abcd 2345").map((v) => v.code)).toEqual(["ABCD2345"]);
    expect(searchVouchers(list, "ABCD-2345").map((v) => v.code)).toEqual(["ABCD2345"]);
    expect(searchVouchers(list, "LOT").map((v) => v.code)).toEqual(["LOT1001"]);
  });

  it("matches a note on the RAW text, because a note is prose", () => {
    // normalizeCode would strip the space out of "Birthday gift" and never match.
    expect(searchVouchers(list, "birthday gift").map((v) => v.code)).toEqual(["ABCD2345"]);
    expect(searchVouchers(list, "anniv").map((v) => v.code)).toEqual(["QRST6789"]);
  });

  it("caps the list and survives junk", () => {
    expect(searchVouchers(list, "", 2)).toHaveLength(2);
    expect(searchVouchers(null, "x")).toEqual([]);
    expect(searchVouchers(list, "zzzz")).toEqual([]);
  });
});
