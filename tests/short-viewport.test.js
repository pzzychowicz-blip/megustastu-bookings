// tests/short-viewport.test.js — v18.4.0, `useShortViewport`: the visible area
// is short enough that the WhatsApp inbox folds its chrome while somebody
// types. The numbers are the restaurant tablet's (Chrome 154, a DEV tab) and
// the iPhone Simulator's (v18.3.0).

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { stripComments } from "../scripts/strip-comments.mjs";
import { shortViewportOf, SHORT_VIEWPORT } from "../src/hooks/useShortViewport";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
const read = (rel) => stripComments(readFileSync(join(SRC, rel), "utf8")).join("\n");
const win = (height) => ({ visualViewport: { height } });

describe("shortViewportOf", () => {
  it("is false for the tablet with the keyboard down, true with it up", () => {
    expect(shortViewportOf(win(507.27))).toBe(false);
    expect(shortViewportOf(win(289))).toBe(true);
    // The same keyboard with Chrome's autofill strip above it.
    expect(shortViewportOf(win(231))).toBe(true);
  });

  it("is true for an iPhone with the keyboard up, false with it down", () => {
    expect(shortViewportOf(win(447))).toBe(true);
    expect(shortViewportOf(win(796))).toBe(false);
  });

  it("is false for an iPad in portrait with its keyboard up: there is room", () => {
    expect(shortViewportOf(win(670))).toBe(false);
  });

  it("is false with nothing to read, so nothing ever folds there", () => {
    expect(shortViewportOf(null)).toBe(false);
    expect(shortViewportOf({})).toBe(false);
    expect(shortViewportOf({ visualViewport: {} })).toBe(false);
  });

  it("puts the threshold between the tablet's two readings", () => {
    expect(SHORT_VIEWPORT).toBeGreaterThan(447);
    expect(SHORT_VIEWPORT).toBeLessThan(507);
  });

  it("does not read innerHeight, which moves with the page scroll on iOS", () => {
    expect(read("hooks/useShortViewport.js")).not.toMatch(/innerHeight/);
  });
});

describe("the inbox folds while a reply is typed on a short screen", () => {
  const Inbox = read("components/whatsapp/InboxPanel.jsx");
  const View = read("components/whatsapp/ConversationView.jsx");

  it("folds only for a text field of the OPEN CONVERSATION", () => {
    // `/code-review`: `typing` is the conversation's key, so a view unmounted
    // mid-reply (no blur fires) cannot leave the next conversation folded.
    expect(Inbox).toMatch(/const kbFold = !!activeConv && typing === activeConv\.phoneKey && short && !shown;/);
    expect(Inbox).toMatch(/if \(raisesKeyboard\(e\.target\)\) setTyping\(activeKey\);/);
    expect(Inbox).toMatch(/if \(shown && raisesKeyboard\(e\.target\)\) setShown\(false\);/);
    expect(Inbox).toMatch(/<div onFocus=\{onViewFocus\} onBlur=\{onViewBlur\} onPointerDown=\{onViewPointerDown\}/);
    // Send is inside the conversation: a blur towards it must not unfold the
    // pane under the finger.
    expect(Inbox).toMatch(/if \(!\(e\.relatedTarget && e\.currentTarget\.contains\(e\.relatedTarget\)\)\) setTyping\(null\);/);
  });

  it("lets the show button hold the fold open where no keyboard closes", () => {
    // A short window with a real keyboard: the blur changes nothing and the
    // focus trap refocuses the reply box, so the button sets its own state.
    expect(Inbox).toMatch(/function unfold\(\) \{\s*setShown\(true\);/);
    expect(Inbox).toMatch(/if \(shown && !short\) setShown\(false\);/);
  });

  it("folds the title bar, the toolbar and the list, each eased and inert", () => {
    expect(Inbox).toMatch(/<Reveal show=\{!kbFold\} inert=\{kbFold\}/);
    expect(Inbox).toMatch(/<Reveal show=\{selectMode && !kbFold\}>/);
    expect(Inbox).toMatch(/inert=\{twoPane && kbFold\}/);
    expect(Inbox).toMatch(/width: twoPane \? \(kbFold \? 0 : LIST_W\) : "100%"/);
    expect(Inbox).toMatch(/transition: twoPane \? "width " \+ M\.shift : undefined/);
  });

  it("swaps the header for one slim row, and folds the cards", () => {
    expect(View).toMatch(/<Reveal show=\{kbFold\} inert=\{!kbFold\}/);
    expect(View.match(/<Reveal show=\{!kbFold\} inert=\{kbFold\}/g)).toHaveLength(2);
    expect(View).toMatch(/<button onClick=\{onUnfold\}/);
    expect(View).toMatch(/show=\{isParsing\(conv\) && !kbFold\}/);
    expect(View).toMatch(/show=\{draftCardShows && !kbFold\}/);
    expect(View).toMatch(/show=\{histOpen && hasRegulars && !kbFold\}/);
  });

  it("keeps the thread on its last message through a resize", () => {
    expect(View).toMatch(/if \(atEnd\.current\) el\.scrollTop = el\.scrollHeight;/);
    // A scroll event arrives a frame late, at a height the observer has not
    // seen: it must not be read as "the user scrolled away".
    expect(View).toMatch(/if \(seenH\.current !== -1 && el\.clientHeight !== seenH\.current\) return;/);
  });
});

// v18.4.0 (Patryk): on a phone the linked booking and the request each start
// as one line. Measured at 375×664 with both open: the thread had 109px, and
// 260 with both collapsed to their title rows.
describe("on a phone the conversation's two cards start as one line", () => {
  const view = read("components/whatsapp/ConversationView.jsx");
  const linked = read("components/whatsapp/LinkedBookingCard.jsx");
  const intent = read("components/whatsapp/IntentBanner.jsx");
  it("the inbox says it is a phone, and both cards are told", () => {
    expect(read("components/whatsapp/InboxPanel.jsx")).toContain("phone={winW < 600}");
    expect(view.match(/narrow=\{phone\}/g)).toHaveLength(2);
  });
  it("both start collapsed there", () => {
    expect(linked).toContain('useCollapseState(phoneKey, "linked", !!defaultCollapsed || !!narrow)');
    expect(intent).toContain('useCollapseState(phoneKey, "intent", !!narrow)');
  });
  it("collapsed is the title row alone: the buttons are in the body, which eases open", () => {
    for (const card of [linked, intent]) {
      expect(card).toContain("{narrow ? null : actionBtns}");
      expect(card).toMatch(/\{narrow \? <AlertRow first style=\{\{ paddingBottom: 8 \}\}>\{actionBtns\}<\/AlertRow> : null\}\s*<\/Reveal>/);
    }
    expect(linked).toContain("{collapsed && !narrow ? <span");
  });
  it("the request is a toggle on a phone even with nothing else to disclose", () => {
    expect(intent).toContain("const opens = hasBody || !!narrow;");
    expect(intent).toContain("onHeaderClick={opens ? toggle : undefined}");
  });
});

// `/code-review`: the fold unmounts the title bar, and the dialog's name was
// the heading in it. Measured in Chromium's accessibility tree: "WHATSAPP"
// before, "" while folded and after.
describe("the inbox keeps its name while its title bar is folded", () => {
  const Inbox = read("components/whatsapp/InboxPanel.jsx");
  it("the title is an always-mounted heading above the folding bar, and the wordmark is not a second one", () => {
    const title = Inbox.indexOf('<h2 className="mgt-sr-only" {...{ [MODAL_TITLE_ATTR]: "" }}>WhatsApp</h2>');
    expect(title).toBeGreaterThan(-1);
    expect(title).toBeLessThan(Inbox.indexOf("<Reveal show={!kbFold} inert={kbFold}"));
    expect(Inbox.match(/<h2/g)).toHaveLength(1);
    expect(Inbox).toMatch(/<span aria-hidden="true" style=\{\{[^}]*\}\}>WHATSAPP<\/span>/);
  });
});
