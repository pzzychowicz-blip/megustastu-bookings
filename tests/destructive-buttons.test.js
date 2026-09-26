// tests/destructive-buttons.test.js — v18.2.0, the design critique's S4 (and
// the S5 + S6 phase after it): removing a person takes two taps, and a
// destructive button says so. Phases 27, 28 and 41 made a row's destructive
// button quiet until armed; phase 62 (Patryk, after the app's own buttons side
// by side) made EVERY destructive button one solid red at rest, with the trash
// mark on a Delete or a Remove. The editors' small × removers stay quiet.
//
// Measured on DEV before: Admin → People's Remove acted on ONE tap, in the same
// grey as the Capabilities button beside it, and on your own row it could only
// fail ("You can't remove your own admin access"). After: no Remove on your own
// row; Marta's and Rubén's read Remove in the danger tint, the first tap turns
// the button solid red as "Confirm — remove" with the sentence under the row,
// arming one row disarms the other, and opening Capabilities disarms it.

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { stripComments } from "../scripts/strip-comments.mjs";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
const read = (rel) => stripComments(readFileSync(join(SRC, rel), "utf8")).join("\n");
const Atoms = read("components/atoms.jsx");
const Admin = read("components/AdminSettings.jsx");
const Contrast = readFileSync(join(SRC, "..", "tests", "contrast.test.js"), "utf8");

describe("mkDangerBtn — one solid red, at rest and armed (phase 62)", () => {
  const fn = Atoms.slice(Atoms.indexOf("export function mkDangerBtn"), Atoms.indexOf("export function mkDangerBtn") + 600);

  it("is the solid danger fill in every state, with no armed parameter left", () => {
    expect(fn).toMatch(/export function mkDangerBtn\(extra\) \{/);
    expect(fn).toMatch(/background: "var\(--app-danger-solid\)", color: "var\(--text-on-accent\)", border: RIM_SOLID, boxShadow: "var\(--shadow-btn-solid\)",/);
    expect(fn, "the phase-28 tint is back").not.toMatch(/ALERT_TONES\.danger/);
  });

  it("gives a confirm dialog the same red on mkSolidBtn's geometry", () => {
    expect(Atoms).toMatch(/export function mkDangerConfirm\(extra\) \{\s*return mkSolidBtn\("var\(--app-danger-solid\)", /);
  });

  // Phase 27 shipped the rest state WITH `--danger-border`: pale fill +
  // matching border + text in a third shade, the shape DESIGN.md bans. Found
  // in phase 28 by reading the ban before touching LayoutSettings' X_BTN, which
  // v17.8.0 had moved off that exact shape.
  it("takes no danger border at rest, which would be the banned three-encodings shape", () => {
    expect(fn).not.toMatch(/--danger-border/);
  });

  // Its height and padding. The LABEL sets the width (Delete 61 → 126px), which
  // is why a row reserves the armed width (phase 51, below).
  it("keeps mkBtn's geometry, so arming never changes its height", () => {
    expect(fn).toMatch(/return mkBtn\(Object\.assign\(\{/);
  });

  // The tint pair stays registered as a button: the editors' quiet × wear it.
  it("paints only pairs the contrast registry measures", () => {
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
    expect(Admin).toMatch(/><TrashIcon size=\{IC\.control\} \/>\{armed \? "Confirm — remove" : "Remove"\}<\/button>/);
    expect(Admin).toMatch(/style=\{mkDangerBtn\(\)\}/);
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

describe("the rows' deletes: one red, and the trash mark", () => {
  it("Reminders: Delete opens the in-app confirmation, in the one red", () => {
    expect(Reminders).toMatch(/style=\{mkDangerBtn\(\{ fontSize: T\.body, minHeight: 32, padding: "4px 12px" \}\)\}\s*>\s*<TrashIcon size=\{IC\.control\} \/>Delete/);
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
    expect(Settings).toMatch(/style=\{mkDangerBtn\(\{ fontSize: T\.body, minHeight: 32, padding: "4px 10px" \}\)\}><TrashIcon size=\{IC\.control\} \/>\{armed \? "Confirm — delete" : "Delete"\}/);
  });

  // v18.2.0 phase 42: measured on DEV with two rules, both Deletes were named
  // "Delete". The switch beside each already carried the rule's identity; the
  // two now read ONE expression, so they cannot name different rules.
  it("Standing bookings: Delete names its rule, from the same string as its switch", () => {
    expect(Settings).toMatch(/const ruleWho = \(r\.name \|\| "\(no name\)"\) \+ ", every " \+ \(RULE_WD\[r\.weekday\] \|\| "\?"\) \+ " at " \+ r\.time;/);
    expect(Settings).toMatch(/label=\{"Standing booking: " \+ ruleWho\}/);
    expect(Settings).toMatch(/aria-label=\{\(armed \? "Confirm — delete \(" : "Delete \("\) \+ ruleWho \+ "\)"\}/);
  });

  // Phase 51 (round 3's L-2): the text had a zero basis, so on a 375px phone the
  // armed "Confirm — delete" took the name down to 97px and two lines. The text
  // takes a basis and the switch + Delete wrap under it as ONE group reserving
  // the armed width (the waitlist panel's reason, below).
  it("Standing bookings: the text has a basis, and the switch + Delete reserve the armed width", () => {
    expect(Settings).toMatch(/<div style=\{\{ flex: "1 1 200px", minWidth: 0 \}\}>/);
    expect(Settings).toMatch(/<div style=\{\{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 8, flexShrink: 0, marginLeft: "auto", minWidth: RULE_ACTIONS_W \}\}>[\s{}]*<Toggle\s+label=\{"Standing booking: " \+ ruleWho\}/);
    // The switch 48 + 8 + "Confirm — delete" with its trash mark 145.5 (phase
    // 62; 125.5 without it), measured.
    expect(Number((Settings.match(/const RULE_ACTIONS_W = (\d+);/) || [])[1])).toBeGreaterThanOrEqual(202);
  });
});

// v18.2.0 phase 41 (S6, reached live at last): the waitlist panel only opens
// while a party waits, which DEV had not had. Measured there: every row's
// Remove solid rgba(211, 58, 58, 0.75), and arming it changed only the word —
// `BTN.cancel` and `BTN.del` are two tokens with one value.
const Waitlist = read("components/WaitlistPanel.jsx");

describe("the waitlist panel: Remove", () => {
  it("wears mkDangerBtn, and no other red token", () => {
    expect(Waitlist).toMatch(/style=\{mkDangerBtn\(\{fontSize: T\.body,minHeight:36\}\)\}/);
    expect(Waitlist).not.toMatch(/BTN\.(cancel|del)/);
  });

  // v18.2.0 phase 59 (round 3's T-1): with the waitlist off it, BTN.cancel had
  // no users, so the token went — the key, the CSS variable and its contrast
  // registration. Its lesson (a dialog's go-back is slate, not a red) is in
  // DESIGN.md's "Red means destructive" rule.
  it("BTN.cancel is gone, key, variable and registration", () => {
    expect(read("lib/constants.js")).not.toMatch(/cancel:"var\(--btn-cancel\)"/);
    expect(readFileSync(join(SRC, "index.css"), "utf8")).not.toMatch(/--btn-cancel\s*:/);
    expect(Contrast).not.toMatch(/fill: "--btn-cancel"/);
  });

  it("says what the second tap does, as People's Remove does", () => {
    expect(Waitlist).toMatch(/><TrashIcon size=\{IC\.control\} \/>\{arming\?"Confirm — remove":"Remove"\}<\/button>/);
    expect(Waitlist).not.toMatch(/"Confirm\?"/);
  });

  it("names the party on Book and Remove, the visible word leading", () => {
    expect(Waitlist).toMatch(/const party=who\+", "\+guestsLabel\(w\.size\);/);
    expect(Waitlist).toMatch(/aria-label=\{"Book \("\+party\+"\)"\}/);
    expect(Waitlist).toMatch(/aria-label=\{\(arming\?"Confirm — remove \(":"Remove \("\)\+party\+"\)"\}/);
  });

  // Measured on a 375px phone: with a zero basis the buttons took their width
  // out of the text — 129px of it, 67px once "Confirm — remove" widened the
  // group. With the basis they drop under the text (283px) and stay right.
  // Phase 51: and the group reserves its ARMED width. With the basis alone a
  // 430px phone held the resting group beside the text and wrapped the armed
  // one 27px down (measured), so the second tap missed Remove.
  it("gives the row's text a basis and the buttons their armed width, so arming moves nothing", () => {
    expect(Waitlist).toMatch(/<div style=\{\{flex:"1 1 160px",minWidth:0\}\}>/);
    expect(Waitlist).toMatch(/<div style=\{\{display:"flex",gap:6,flexShrink:0,marginLeft:"auto",justifyContent:"flex-end",minWidth:ACTIONS_W\}\}>/);
    // Book 60.3 + 6 + "Confirm — remove" with its trash mark 160.1 (phase 62;
    // 140.1 without it), measured. Below it, arming widens the group again and
    // the wrap window reopens.
    expect(Number((Waitlist.match(/const ACTIONS_W = (\d+);/) || [])[1])).toBeGreaterThanOrEqual(227);
  });
});

describe("a paused reminder fades its text, never its buttons", () => {
  it("dims the words and says Paused, with the card at full strength", () => {
    expect(Reminders).not.toMatch(/opacity: r\.active \? 1 : 0\.55,\s*boxShadow/);
    expect(Reminders).toMatch(/<span style=\{\{ opacity: r\.active \? 1 : PAUSED_FADE \}\}>\{r\.text\}<\/span>/);
    expect(Reminders).toMatch(/\{r\.active \? null : <OutlineChip tone="neutral"[^>]*>Paused<\/OutlineChip>\}/);
  });

  // v18.2.0 phase 55 (round 3's L-3): a paused standing booking faded its name
  // alone (to 0.5) and appended " · paused" — a second look for the same state
  // one tab away. It takes the reminder's, from ONE constant in atoms.
  it("a paused standing booking looks the same: both lines faded, and the tag", () => {
    expect(Atoms).toMatch(/export const PAUSED_FADE = 0\.55;/);
    expect(Settings).toMatch(/<span style=\{\{ opacity: r\.active !== false \? 1 : PAUSED_FADE \}\}>\{\(r\.name \|\| "\(no name\)"\) \+ " · " \+ guestsLabel\(r\.size\)\}<\/span>/);
    expect(Settings).toMatch(/\{r\.active !== false \? null : <OutlineChip tone="neutral"[^>]*>Paused<\/OutlineChip>\}/);
    expect(Settings).toMatch(/opacity: r\.active !== false \? 1 : PAUSED_FADE \}\}>\{"Every " \+ \(RULE_WD\[r\.weekday\] \|\| "\?"\) \+ " at " \+ r\.time\}/);
    expect(Settings).not.toMatch(/" · paused"/);
    // Phase 28 had typed the constant between `export` and the card.
    expect(Reminders).not.toMatch(/const PAUSED_FADE/);
    expect(Reminders).toMatch(/export function ReminderListItem\(/);
  });
});

// v18.2.0 phase 36 (X5): "Clear" empties a table selection and destroys
// nothing, but wore the delete red. Measured on DEV: the walk-in form's Clear
// now reads rgb(100, 116, 139), exactly --app-btn-slate, as Dismiss does.
describe("X5 — Clear is not red", () => {
  const CSS = readFileSync(join(SRC, "index.css"), "utf8");
  it("aliases the dialog slate, as Dismiss does, in every theme", () => {
    expect(CSS).toMatch(/--btn-clear: var\(--app-btn-slate\);/);
    expect(CSS).toMatch(/--btn-dismiss: var\(--app-btn-slate\);/);
    expect((CSS.match(/--btn-clear:/g) || []).length, "no theme block overrides it back").toBe(1);
  });
});

// v18.2.0 phase 62 (Patryk's item 3): "Delete" in Templates, "Remove" in
// People, "Delete customer & all data", "Delete" in Reminders, "Void voucher",
// "Clear this range" and the booking form's "Delete" do one job and had three
// looks and four reds — the tint that turned solid when armed, the translucent
// `--btn-del`, `--app-danger-solid` and the inbox's `--wa-btn-cancel`. Shown the
// options drawn by the real atoms, he chose one solid red at rest plus the
// trash mark on a Delete or a Remove. Measured on DEV: every one of them
// rgb(220, 38, 38) at rest and armed.
describe("phase 62 — one red for every destructive control, and the trash mark", () => {
  const files = [
    ...readdirSync(join(SRC, "components")).filter((f) => f.endsWith(".jsx")).map((f) => "components/" + f),
    ...readdirSync(join(SRC, "components", "whatsapp")).filter((f) => f.endsWith(".jsx")).map((f) => "components/whatsapp/" + f),
    "App.jsx",
  ];

  // What may still paint an old red, and why. Everything else is a failure.
  const ALLOWED = {
    "components/TableGrid.jsx": 1,      // a BLOCKED table's fill: a status, not a button
    "components/whatsapp/WaSimulator.jsx": 1, // "Make next staff reply fail": sandbox-only, destroys nothing
    "components/ReminderEditor.jsx": 1, // its remove-time ×: phase 63, the editors' quiet ×s
  };
  it("no control is left on BTN.del, --btn-del or --wa-btn-cancel", () => {
    for (const f of files) {
      const hits = (read(f).match(/BTN\.del\b|var\(--btn-del\)|--wa-btn-cancel/g) || []).length;
      expect(hits, f).toBe(ALLOWED[f] || 0);
    }
    expect(readFileSync(join(SRC, "index.css"), "utf8"), "the inbox's own red is gone").not.toMatch(/--wa-btn-cancel\s*:/);
    expect(Contrast).not.toMatch(/fill: "--wa-btn-cancel"/);
  });

  it("every Delete and Remove carries the trash mark before its word", () => {
    const sites = [
      ["components/whatsapp/TemplatesEditor.jsx", /<TrashIcon size=\{IC\.inline\} \/>\{armed \? "Confirm — delete" : "Delete"\}/],
      ["components/BookingFormModal.jsx", /style=\{mkDangerBtn\(\{fontSize: T\.body,padding:"8px 16px",minHeight:36\}\)\}><TrashIcon size=\{IC\.control\} \/>Delete<\/button>/],
      ["components/QuickStatusPopup.jsx", /<TrashIcon size=\{IC\.control\} \/>Delete\s*<\/button>/],
      ["components/CustomersSettings.jsx", /<TrashIcon size=\{IC\.control\} \/>\{armed \? "Confirm — delete" : "Delete customer & all data"\}/],
      ["components/FloorPlanEditor.jsx", /<TrashIcon size=\{IC\.control\} \/>Delete door<\/button>/],
      ["components/FloorPlanEditor.jsx", /<TrashIcon size=\{IC\.control\} \/>Delete wall<\/button>/],
      ["components/LayoutSettings.jsx", /<TrashIcon size=\{IC\.control\} \/>\{orph > 0 \? "Remove anyway" : "Remove"\}/],
      ["components/whatsapp/ConversationView.jsx", /style=\{mkDangerBtn\(\{ gap: 4, padding: "8px 12px", minHeight: H\.chrome, fontSize: T\.small \}\)\} ><TrashIcon size=\{IC\.inline\} \/>Delete<\/button>/],
      ["components/whatsapp/InboxPanel.jsx", /<TrashIcon size=\{IC\.inline\} \/>Delete<\/button>/],
      ["components/whatsapp/InboxPanel.jsx", /style=\{mkDangerBtn\(\)\}><TrashIcon size=\{IC\.control\} \/>Delete \{selected\.size\}<\/button>/],
    ];
    for (const [f, re] of sites) expect(read(f), f).toMatch(re);
  });

  it("the confirm dialogs: one red on the dialog's geometry, the mark on Delete, not on Discard", () => {
    const App = read("App.jsx");
    for (const title of ["Delete booking?", "Delete reminder?", "Delete conversation?"]) {
      const at = App.indexOf(">" + title + "<");
      expect(at, title).toBeGreaterThan(-1);
      expect(App.slice(at - 200, at), title).toMatch(/style=\{mkDangerConfirm\(\)\}><TrashIcon size=\{IC\.control\} \/>Delete<\/button>/);
    }
    expect(App).toMatch(/style=\{mkDangerConfirm\(\)\}>Discard<\/button>/);
    expect(App).not.toMatch(/mkSolidBtn\(BTN\.del/);
  });

  // Not deletions of a thing, so the red without the bin.
  it("Void voucher, Unblock and Clear this range wear the red and no mark", () => {
    expect(read("components/VouchersSettings.jsx")).toMatch(/: mkDangerBtn\(\{ fontSize: T\.body, minHeight: 36 \}\)\}>\s*\{state === "void" \? "Reinstate voucher" : "Void voucher"\}/);
    expect(read("components/BlockModal.jsx")).toMatch(/style=\{mkDangerBtn\(\{ fontSize: T\.body, flexShrink: 0 \}\)\}\s*>\s*Unblock/);
    expect(read("components/ActivityLogModal.jsx")).toMatch(/style=\{mkDangerBtn\(\{[\s\S]{0,300}?\}\)\}\s*>\{clearBusy \? "Clearing…" : armed \? "Confirm — delete this range" : "Clear this range"\}/);
  });

  // The Customers delete put its armed sentence IN FRONT of the button, in a
  // wrapping right-aligned row, so arming could push the button out from under
  // the second tap. It goes under the button, tied by aria-describedby while it
  // exists, as People's Remove and the Activity log's Clear do.
  it("Customers: the armed sentence sits UNDER the button, and says it with a dash", () => {
    const Cust = read("components/CustomersSettings.jsx");
    expect(Cust).toMatch(/aria-describedby=\{armed \? DELETE_WARN_ID : undefined\}/);
    const btn = Cust.indexOf('"Delete customer & all data"');
    const warn = Cust.indexOf("<div id={DELETE_WARN_ID}");
    expect(warn).toBeGreaterThan(btn);
    expect(Cust).not.toMatch(/"Confirm delete"/);
  });

  it("the trash mark is ONE drawing, in the app's icon set", () => {
    expect(read("components/Icons.jsx")).toMatch(/export function TrashIcon\(props\)/);
    expect(read("components/whatsapp/WaIcons.jsx")).not.toMatch(/export function TrashIcon/);
  });
});

// Phase 62, found by measuring the change: the Customers delete's ARMED label is
// the shorter one, so the right-aligned button shrank from its left edge when
// armed (209 → 154px) and a first tap there missed on the second. It keeps its
// resting width (208.8 measured, with the trash mark); armed and at rest it
// measures x 792, 210px wide, on DEV at 1280×800.
describe("phase 62 — the Customers delete keeps its width when armed", () => {
  it("reserves the resting label's measured width", () => {
    const Cust = read("components/CustomersSettings.jsx");
    expect(Cust).toMatch(/style=\{mkDangerBtn\(\{ fontSize: T\.body, minHeight: 36, minWidth: DELETE_W \}\)\}/);
    expect(Number((Cust.match(/const DELETE_W = (\d+);/) || [])[1])).toBeGreaterThanOrEqual(209);
  });
});
