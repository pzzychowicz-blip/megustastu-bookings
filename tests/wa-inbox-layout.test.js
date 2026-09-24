// tests/wa-inbox-layout.test.js — v18.2.0, the design critique's WhatsApp
// inbox findings (W1–W5), one phase each.
//
// W1, measured on DEV at 375×812: the compact draft bar read "2 pax · 202…",
// the date and time cut off by HIGH / Accept / Dismiss. After: line one is
// "2 pax · 2026-09-25 · 14:00" whole, line two is HIGH, Accept and Dismiss
// together, right-aligned; at 1280×800 (compact too, the tablet is 800 tall)
// it is still one line.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { stripComments } from "../scripts/strip-comments.mjs";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
const read = (rel) => stripComments(readFileSync(join(SRC, rel), "utf8")).join("\n");
const Draft = read("components/whatsapp/DraftCard.jsx");
const Inbox = read("components/whatsapp/InboxPanel.jsx");
const Composer = read("components/whatsapp/ReplyComposer.jsx");
const Shortcuts = read("components/Shortcuts.jsx");
const View = read("components/whatsapp/ConversationView.jsx");
const Row = read("components/whatsapp/ConversationRow.jsx");

describe("W1 — the draft bar never hides what it asks you to accept", () => {
  it("gives the details a basis of their own content, and no shrink", () => {
    expect(Draft).toMatch(/gap: 8, flex: "1 0 auto", maxWidth: "100%", minWidth: 0, cursor: hasDetail \? "pointer" : "default"/);
    expect(Draft, "flex: 1 with min-width 0 is what let the controls squeeze it").not.toMatch(/gap: 8, flex: 1, minWidth: 0, cursor: hasDetail/);
  });

  it("wraps the controls as ONE group, pushed right, so Accept and Dismiss never split", () => {
    const i = Draft.indexOf('<div style={{ display: "flex", alignItems: "center", gap: 8, marginLeft: "auto", flexShrink: 0 }}>');
    expect(i).toBeGreaterThan(-1);
    const group = Draft.slice(i, Draft.indexOf("</div>", i));
    expect(group).toMatch(/title=\{confLbl \+ " confidence"\}/);
    expect(group).toMatch(/>Accept<\/button>/);
    expect(group).toMatch(/>Dismiss<\/OutlineChip>/);
  });
});

// W2, measured on DEV: the header's button and the composer's were both
// "Templates" with the same document icon; one opens the editor, the other
// shows the chips that insert one. After: "Edit templates" with the app's edit
// pencil, and "Insert template" with the document.
describe("W2 — two jobs, two names, two marks", () => {
  it("the header's button edits the templates, under the edit pencil", () => {
    // Since W3 it also SAYS so, which is where its name now comes from.
    expect(Inbox).toMatch(/title="Edit templates \(T\)"[^>]*><EditIcon size=\{IC\.inline\} \/>Edit templates<\/button>/);
    expect(Inbox).not.toMatch(/title="Templates"/);
  });

  it("the composer's button inserts one, under the document mark", () => {
    expect(Composer).toMatch(/aria-label="Insert template"\s*title="Insert template \(E\)"/);
    expect(Composer).toMatch(/><TemplatesIcon size=\{IC\.chrome\} \/><\/button>/);
    expect(Composer).not.toMatch(/title="Templates"/);
  });

  it("the keyboard list uses the same two names", () => {
    expect(Shortcuts).toMatch(/\{ keys: \["T"\],\s*label: "Edit templates" \}/);
    expect(Shortcuts).toMatch(/\{ keys: \["E"\],\s*label: "Insert a template \(show or hide\)" \}/);
  });
});

// W3: the simulator flask, Templates and Re-check were icon-only, named by
// `title` alone. That is an accessible name, but the tablets never show a
// tooltip, so a finger never learned what they do. After: icon and word,
// the shape of Archive beside Re-check.
describe("W3 — the words are on the buttons, not in a tooltip", () => {
  it("Re-check says Re-check, and Checking… while it runs", () => {
    expect(View).toMatch(/<RecheckIcon size=\{IC\.inline\} \/><\/span>\s*\{running \? "Checking…" : "Re-check"\}\s*<\/button>/);
    expect(View, "no longer a bare square").not.toMatch(/width: H\.chrome, height: H\.chrome, minHeight: H\.chrome, padding: 0, cursor: running/);
  });

  it("the header's Edit templates and Simulator carry their words", () => {
    expect(Inbox).toMatch(/<FlaskIcon size=\{IC\.inline\} \/>Simulator<\/button>/);
    expect(Inbox).toMatch(/const HEAD_TEXT_BTN = \{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 4, padding: "8px 12px", minHeight: H\.chrome, fontSize: T\.small, flexShrink: 0, lineHeight: 1 \};/);
  });
});

// W4 + W5, measured on DEV with the mobile preset (375×812, touch): Close in
// the top corner (320–356, top 18) beside the badge, Simulator and Edit
// templates on line two; "Search…"; the unknown sender "+44 7811223344" in the
// list and ONCE in its conversation; no list toolbar over an open
// conversation; the composer's placeholder "Type a reply…". At 1280×800 the
// header is still one line and the placeholder is the long one.
describe("W4 — an unknown sender's number, once and formatted", () => {
  it("the row and the conversation title use the formatted number, and a nameless match falls through to it", () => {
    for (const src of [Row, View]) {
      expect(src).toMatch(/const named = !!\(match && match\.name\);/);
      expect(src).toMatch(/const displayName = named \? match\.name : formatPhone\(conv\.phone \|\| conv\.phoneKey\);/);
    }
  });

  it("the grey number beside the title appears only under a name", () => {
    expect(View).toMatch(/const phoneDisplay = named \? formatPhone\(conv\.phone \|\| conv\.phoneKey\) : null;/);
    expect(View).toMatch(/\{phoneDisplay \? <span/);
  });
});

describe("W5 — the phone's inbox", () => {
  it("keeps Close in the top corner, with the text buttons on a line of their own", () => {
    expect(Inbox).toMatch(/<div style=\{\{ display: "flex", gap: 6, marginLeft: "auto", order: twoPane \? 0 : 2, flexBasis: twoPane \? "auto" : "100%" \}\}>/);
    expect(Inbox).toMatch(/order: twoPane \? 0 : 1, marginLeft: twoPane \? 0 : "auto" \}\)\}><CloseIcon size=\{IC\.chrome\} \/><\/button>/);
  });

  it("hides the LIST's toolbar while a conversation replaces the list", () => {
    expect(Inbox).toMatch(/\{twoPane \|\| !activeKey \? \(\s*<div style=\{\{ padding: "8px 14px"/);
  });

  it("shortens the search placeholder where the long one was cut", () => {
    expect(Inbox).toMatch(/placeholder=\{twoPane \? "Search name, number or message…" : "Search…"\}/);
  });

  it("offers Enter / Shift+Enter only where there is a keyboard", () => {
    expect(Composer).toMatch(/const TOUCH = typeof window !== "undefined" && !!window\.matchMedia && window\.matchMedia\("\(hover: none\), \(pointer: coarse\)"\)\.matches;/);
    expect(Composer).toMatch(/\(TOUCH \? "Type a reply…" : "Type a reply\.\.\. \(Enter to send, Shift\+Enter for new line\)"\)/);
  });
});
