// tests/destructive-buttons.test.js — v18.2.0, the design critique's S4 (and
// the S5 + S6 phase after it): a row's destructive button is quiet until it is
// armed, and removing a person takes two taps.
//
// Measured on DEV before: Admin → People's Remove acted on ONE tap, in the same
// grey as the Capabilities button beside it, and on your own row it could only
// fail ("You can't remove your own admin access"). After: no Remove on your own
// row; Marta's and Rubén's read Remove in the danger tint, the first tap turns
// the button solid red as "Confirm — remove" with the sentence under the row,
// arming one row disarms the other, and opening Capabilities disarms it.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { stripComments } from "../scripts/strip-comments.mjs";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
const read = (rel) => stripComments(readFileSync(join(SRC, rel), "utf8")).join("\n");
const Atoms = read("components/atoms.jsx");
const Admin = read("components/AdminSettings.jsx");
const Contrast = readFileSync(join(SRC, "..", "tests", "contrast.test.js"), "utf8");

describe("mkDangerBtn — quiet until armed", () => {
  const fn = Atoms.slice(Atoms.indexOf("export function mkDangerBtn"), Atoms.indexOf("export function mkDangerBtn") + 600);

  it("is the danger tint at rest and the solid danger fill when armed", () => {
    expect(fn).toMatch(/\{ background: "var\(--app-danger-solid\)", color: "var\(--text-on-accent\)", border: RIM_SOLID, boxShadow: "var\(--shadow-btn-solid\)" \}/);
    expect(fn).toMatch(/\{ background: ALERT_TONES\.danger\.tint, color: ALERT_TONES\.danger\.tone, border: "1px solid var\(--danger-border\)" \}/);
  });

  it("keeps mkBtn's geometry in both states, so arming never resizes it under the finger", () => {
    expect(fn).toMatch(/return mkBtn\(Object\.assign\(armed/);
  });

  it("paints only pairs the contrast registry already measures", () => {
    expect(Contrast).toMatch(/fill: "--danger-bg", alpha: null, ink: "--danger-text"/);
    expect(Contrast).toMatch(/fill: "--app-danger-solid", alpha: null, ink: "--text-on-accent"/);
  });
});

describe("Admin → People: Remove", () => {
  it("is not offered on your own row, where it could only fail", () => {
    expect(Admin).toMatch(/\{self \? null : <button className="mgt-hover-scale"/);
  });

  it("acts on the second tap only", () => {
    expect(Admin).toMatch(/if \(armed\) \{ setArmedUid\(null\); say\(onRemoveUser\(r\.uid\)\); \}\s*else \{ setMsg\(null\); setArmedUid\(r\.uid\); \}/);
    expect(Admin).not.toMatch(/onClick=\{function \(\) \{ say\(onRemoveUser\(r\.uid\)\); \}\}/);
  });

  it("names what the second tap does, with the visible label leading", () => {
    expect(Admin).toMatch(/aria-label=\{\(armed \? "Confirm — remove " : "Remove "\) \+ displayName\(r\)\}/);
    expect(Admin).toMatch(/>\{armed \? "Confirm — remove" : "Remove"\}<\/button>/);
    expect(Admin).toMatch(/style=\{mkDangerBtn\(armed\)\}/);
  });

  it("puts the sentence UNDER the row, tied to the button only while it exists", () => {
    expect(Admin).toMatch(/aria-describedby=\{armed \? removeWarnId : undefined\}/);
    expect(Admin).toMatch(/<div id=\{removeWarnId\} style=\{\{ flexBasis: "100%"/);
  });

  it("is disarmed by every other action in People", () => {
    for (const site of [
      /onClick=\{function \(\) \{ setArmedUid\(null\); onWithdrawInvite\(r\.inviteId\); \}\}/,
      /onClick=\{function \(\) \{ setArmedUid\(null\); say\(onApplyInvite\(r\.uid, r\.invite\)\); \}\}/,
      /onChange=\{function \(e\) \{ setArmedUid\(null\); say\(onSetRole\(r\.uid, \{ role: e\.target\.value \|\| null \}\)\); \}\}/,
      /onClick=\{function \(\) \{ setArmedUid\(null\); onOpenCapabilities\(r\.uid\); \}\}/,
    ]) expect(Admin).toMatch(site);
  });
});
