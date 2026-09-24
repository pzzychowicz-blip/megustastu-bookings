// tests/voucher-picker.test.js — v18.2.0 round 3, the booking form's Gift
// voucher field (VoucherPicker.jsx), reached live for the first time.
//
// Measured on DEV before phase 47, tablet: the suggestion list opened under
// the form's last field and dropped into the pinned footer — half of the first
// of 15 rows showed (menu top 647, scroll port bottom 682). And picking a
// voucher already on another live booking put its refusal ("That voucher is
// already on Voucher Probe on Fri 25.09.") UNDER the still-open list, so the
// tap seemed to do nothing.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { stripComments } from "../scripts/strip-comments.mjs";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
const read = (rel) => stripComments(readFileSync(join(SRC, rel), "utf8")).join("\n");
const Picker = read("components/VoucherPicker.jsx");

describe("V-1 — the list scrolls itself into view when it opens", () => {
  it("computes the list above the attached-state return, where a hook may read it", () => {
    const hook = Picker.indexOf("useEffect(function () {");
    const early = Picker.indexOf("if (code) {");
    expect(hook).toBeGreaterThan(0);
    expect(early).toBeGreaterThan(hook);
    expect(Picker).toMatch(/const matches = !code && focus \? searchVouchers\(vouchers, typed, 20, now\) : \[\];/);
  });

  it("scrolls the NEAREST way, on open only, and without a glide under Reduce animations", () => {
    expect(Picker).toMatch(/menuRef\.current\.scrollIntoView\(\{ block: "nearest", behavior: reduceMotionOn\(\) \? "auto" : "smooth" \}\);\s*\}, \[menuOpen\]\);/);
    expect(Picker).toMatch(/<div ref=\{menuRef\} style=\{AC_MENU\}>/);
  });
});

describe("V-2 — a voucher on another booking says so, and its refusal is seen", () => {
  it("marks it in the list from the same predicate the refusal uses", () => {
    expect(Picker).toMatch(/const other = attachedElsewhere\(bookings, v\.code, bookingId\);/);
    expect(Picker).toMatch(/"Already on " \+ \(other\.name \|\| "another booking"\) \+ " · " \+ formatDay\(other\.date\)/);
  });

  it("closes the list on a refusal, and typing opens it again", () => {
    expect(Picker).toMatch(/if \(refusal\) \{ setErr\(refusal\); setFocus\(false\); return; \}/);
    expect(Picker).toMatch(/onChange=\{function \(e\) \{ setTyped\(e\.target\.value\); setErr\(""\); setFocus\(true\); \}\}/);
  });
});
