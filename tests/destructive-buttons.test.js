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
    expect(fn).toMatch(/: \{ background: ALERT_TONES\.danger\.tint, color: ALERT_TONES\.danger\.tone \},/);
  });

  // Phase 27 shipped the rest state WITH `--danger-border`: pale fill +
  // matching border + text in a third shade, the shape DESIGN.md bans. Found
  // in phase 28 by reading the ban before touching LayoutSettings' X_BTN, which
  // v17.8.0 had moved off that exact shape.
  it("takes no danger border at rest, which would be the banned three-encodings shape", () => {
    expect(fn).not.toMatch(/--danger-border/);
  });

  it("keeps mkBtn's geometry in both states, so arming never resizes it under the finger", () => {
    expect(fn).toMatch(/return mkBtn\(Object\.assign\(armed/);
  });

  it("paints only pairs the contrast registry measures, as a BUTTON at rest", () => {
    expect(Contrast).toMatch(/fill: "--danger-bg", alpha: null, ink: "--danger-text", role: "button"/);
    expect(Contrast).toMatch(/fill: "--app-danger-solid", alpha: null, ink: "--text-on-accent"/);
    expect(Contrast).toMatch(/fill: "--bg-stepper", alpha: null, ink: "--text-primary", role: "button"/);
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

// v18.2.0 phase 28 (S5 + S6). Measured on DEV (dark): Reminders' three Deletes
// in the tint with the glass rim; the paused reminder's text at 0.55 and its
// "Paused" tag, Edit and card at 1; Layout's 13 table ×s tinted and the rename
// Cancel × neutral; the Templates Delete armed as solid rgb(220, 38, 38)
// "Confirm — delete", disarmed by Edit and by "+ Add template".
const Reminders = read("components/Reminders.jsx");
const Templates = read("components/whatsapp/TemplatesEditor.jsx");
const Layout = read("components/LayoutSettings.jsx");
const Settings = read("components/Settings.jsx");

describe("the rows' deletes are quiet, and red only at the confirmation", () => {
  it("Reminders: Delete opens the in-app confirmation, so the row's is the tint", () => {
    expect(Reminders).toMatch(/style=\{mkDangerBtn\(false, \{ fontSize: T\.body, minHeight: 32, padding: "4px 12px" \}\)\}/);
    expect(Reminders).not.toMatch(/background: BTN\.del/);
  });

  it("Templates: Delete takes two taps, names its template, and any other action disarms it", () => {
    expect(Templates).toMatch(/onClick=\{\(\) => \{ if \(armed\) \{ setArmedId\(null\); removeT\(t\.id\); \} else setArmedId\(t\.id\); \}\}/);
    expect(Templates).toMatch(/aria-label=\{\(armed \? "Confirm — delete \(" : "Delete \("\) \+ name \+ "\)"\}/);
    expect(Templates).toMatch(/aria-label=\{"Edit \(" \+ name \+ "\)"\}/);
    expect(Templates).toMatch(/function openEdit\(t\) \{ setArmedId\(null\);/);
    expect(Templates).toMatch(/function openNew\(\) \{ setArmedId\(null\);/);
  });

  it("Layout: the row × is the tint, and Cancel is not red at all", () => {
    const x = Layout.slice(Layout.indexOf("const X_BTN = {"), Layout.indexOf("const X_BTN = {") + 400);
    expect(x).toMatch(/background: ALERT_TONES\.danger\.tint,/);
    expect(x).toMatch(/color: ALERT_TONES\.danger\.tone,/);
    expect(x).not.toMatch(/--btn-del/);
    expect(Layout).not.toMatch(/title="Cancel" style=\{X_BTN\}/);
    expect((Layout.match(/title="Cancel" style=\{CANCEL_X\}/g) || []).length).toBe(2);
  });

  it("Standing bookings: the same look, and the armed label says what the second tap does", () => {
    expect(Settings).toMatch(/style=\{mkDangerBtn\(armed, \{ fontSize: T\.body, minHeight: 32, padding: "4px 10px" \}\)\}>\{armed \? "Confirm — delete" : "Delete"\}/);
  });
});

describe("a paused reminder fades its text, never its buttons", () => {
  it("dims the words and says Paused, with the card at full strength", () => {
    expect(Reminders).not.toMatch(/opacity: r\.active \? 1 : 0\.55,\s*boxShadow/);
    expect(Reminders).toMatch(/<span style=\{\{ opacity: r\.active \? 1 : PAUSED_FADE \}\}>\{r\.text\}<\/span>/);
    expect(Reminders).toMatch(/\{r\.active \? null : <OutlineChip tone="neutral"[^>]*>Paused<\/OutlineChip>\}/);
  });
});
