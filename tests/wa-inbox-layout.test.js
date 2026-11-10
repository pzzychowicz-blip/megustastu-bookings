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
import { conversationName, conversationSearchNames, windowState, windowOpen, WA_WINDOW_WARN_MS, WA_WINDOW_RECHECK_MAX_MS } from "../src/lib/whatsapp.js";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
const read = (rel) => stripComments(readFileSync(join(SRC, rel), "utf8")).join("\n");
const Draft = read("components/whatsapp/DraftCard.jsx");
const Inbox = read("components/whatsapp/InboxPanel.jsx");
const Composer = read("components/whatsapp/ReplyComposer.jsx");
const Shortcuts = read("components/Shortcuts.jsx");
const View = read("components/whatsapp/ConversationView.jsx");
const Row = read("components/whatsapp/ConversationRow.jsx");

describe("W1 — the draft bar never hides what it asks you to accept", () => {
  // v18.14.2 (Patryk): the full card's Accept & open and Dismiss sat on the left, and
  // the compact bar's on the right. One card, two places for the same two buttons.
  it("keeps Accept & open and Dismiss on the right, in the full card as in the bar", () => {
    expect(Draft).toMatch(/justifyContent: "flex-end", gap: 8, flexWrap: "wrap" \}\}>\s*<button\s+onClick=\{\(\) => onAccept\(\)\}/);
    expect(Draft).toMatch(/gap: 8, marginLeft: "auto", flexShrink: 0/);
  });
  it("gives the details a basis of their own content, and no shrink", () => {
    expect(Draft).toMatch(/gap: 8, flex: "1 0 auto", maxWidth: "100%", minWidth: 0, cursor: hasDetail \? "pointer" : "default"/);
    expect(Draft, "flex: 1 with min-width 0 is what let the controls squeeze it").not.toMatch(/gap: 8, flex: 1, minWidth: 0, cursor: hasDetail/);
  });

  it("wraps the controls as ONE group, pushed right, so Accept and Dismiss never split", () => {
    const i = Draft.indexOf('<div style={{ display: "flex", alignItems: "center", gap: 8, marginLeft: "auto", flexShrink: 0 }}>');
    expect(i).toBeGreaterThan(-1);
    const group = Draft.slice(i, Draft.indexOf("</div>", i));
    expect(group).toMatch(/<OutlineChip title=\{confTitle\} tone=\{confTone\} size="small">\{confSays\}<\/OutlineChip>/);
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
    // v18.16.0 (follow-up): a row of the WHATSAPP mark's menu, word and pencil.
    expect(Inbox).toContain('{ id: "templates", label: "Edit templates", icon: EditIcon, rule: !onOpenSim, title: "Edit templates (T)",');
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
    // v18.14.0 (correction 6): a row of the ⋯ menu, word and mark as before.
    expect(View).toMatch(/recheck: \{ label: running \? "Checking…" : "Re-check", icon: RecheckIcon,/);
    expect(View, "no longer a bare square").not.toMatch(/width: H\.chrome, height: H\.chrome, minHeight: H\.chrome, padding: 0, cursor: running/);
  });

  it("the header's Edit templates and Simulator carry their words", () => {
    // v18.16.0 (follow-up): rows of the WHATSAPP mark's menu, which draws a row's
    // icon before its word (ConversationMenu).
    expect(Inbox).toContain('{ id: "sim", label: "Simulator", icon: FlaskIcon, rule: true, title: "WhatsApp simulator (X)", onPick: onOpenSim }');
    expect(Inbox).not.toContain("HEAD_TEXT_BTN");
  });
});

// W4 + W5, measured on DEV with the mobile preset (375×812, touch): Close in
// the top corner (320–356, top 18) beside the badge, Simulator and Edit
// templates on line two; "Search…"; the unknown sender "+44 7811223344" in the
// list and ONCE in its conversation; no list toolbar over an open
// conversation; the composer's placeholder "Type a reply…". At 1280×800 the
// header is still one line and the placeholder is the long one.
describe("W4 — an unknown sender's number, once and formatted", () => {
  // v18.9.0: the rule is `conversationName` (lib/whatsapp.js) now, read by the
  // row, the open conversation and `describeConversation`, so it is RUN here
  // and the two components are held to calling it.
  const conv = { phoneKey: "+447811223344", phone: "+447811223344" };
  it("the row and the conversation title use the formatted number, and a nameless match falls through to it", () => {
    expect(conversationName(conv, [], {})).toEqual({ title: "+44 7811223344", phoneLine: null, source: "phone" });
    const walkIn = [{ id: "b1", name: "", phone: "+447811223344", date: "2026-01-01", time: "13:00", status: "completed" }];
    expect(conversationName(conv, walkIn, {}).title).toBe("+44 7811223344");
    expect(Row).toMatch(/const \{ title: displayName, phoneLine \} = conversationName\(conv, bookings, contacts\);/);
    expect(View).toMatch(/const \{ title: displayName, phoneLine: phoneDisplay \} = conversationName\(conv, bookings, contacts\);/);
  });

  it("the grey number beside the title appears only under a name", () => {
    const named = [{ id: "b1", name: "Ana", phone: "+447811223344", date: "2026-01-01", time: "13:00", status: "completed" }];
    expect(conversationName(conv, named, {})).toEqual({ title: "Ana", phoneLine: "+44 7811223344", source: "booking" });
    expect(View).toMatch(/\{phoneDisplay && !hideNumber \? <span/);
  });

  it("v18.9.0: the phone's contact names it first, then the booking, then the WhatsApp profile", () => {
    const named = [{ id: "b1", name: "Ana", phone: "+447811223344", date: "2026-01-01", time: "13:00", status: "completed" }];
    const contacts = { "+447811223344": { name: "Ana (terrace)", at: 1 } };
    expect(conversationName(conv, named, contacts)).toEqual({ title: "Ana (terrace)", phoneLine: "+44 7811223344", source: "contact" });
    // A contact saved with no name is still saved, and names nothing.
    expect(conversationName(conv, named, { "+447811223344": { name: "", at: 1 } }).source).toBe("booking");
    const prof = Object.assign({ profileName: " Annie " }, conv);
    expect(conversationName(prof, [], {})).toEqual({ title: "Annie", phoneLine: "+44 7811223344", source: "profile" });
    expect(conversationName(prof, named, {}).source).toBe("booking");
    // The search finds a thread by every name it has.
    expect(conversationSearchNames(prof, named, contacts)).toEqual(["Ana (terrace)", "Ana", " Annie "]);
    expect(Inbox).toMatch(/conversationSearchNames\(c, bookings, contacts\)\.some/);
  });
});

// v18.14.0 (correction 9, Patryk). At 998 × 507 the thread's box was its own 28px of
// padding, and Send ended 13px past the panel. What the three changes give back takes
// a browser, and the log has it. This holds what would undo them without a word.
describe("a conversation on a short screen", () => {
  it("is the compact layout's own test, and both panes only", () => {
    expect(Inbox).toMatch(/const shortScreen = twoPane && isCompact\(openedAt, false\);/);
  });
  it("reads the height once: the keyboard moves it on Android, and the search box remounts in its other parent", () => {
    expect(Inbox).toMatch(/const \[openedAt\] = useState\(winH\);/);
    expect(Inbox, "a live winH turns this on while the search box has focus").not.toMatch(/isCompact\(winH/);
  });
  it("gives the panel the screen, keeping 8px of the day above and below", () => {
    expect(Inbox).toMatch(/const INBOX_PANEL_SHORT_SCREEN = \{ \.\.\.INBOX_PANEL, height: "calc\(100dvh - " \+ 2 \* SP\.base \+ "px\)" \};/);
    expect(Inbox).toMatch(/panel=\{shortScreen \? INBOX_PANEL_SHORT_SCREEN : INBOX_PANEL\}/);
  });
  it("draws the filter controls in one place at a time, from one element", () => {
    expect(Inbox.match(/\{filterControls\}/g)).toHaveLength(2);
    expect(Inbox).toMatch(/\{shortScreen \? <div [^\n]*\{filterControls\}<\/div> : null\}/);
  });
  it("hands the conversation the one thing it needs to know", () => {
    expect(Inbox).toMatch(/hideNumber=\{shortScreen\}/);
  });
});

describe("W5 — the phone's inbox", () => {
  it("keeps Close in the top corner", () => {
    // v18.16.0 (follow-up): the text buttons went into the mark's menu, so there is
    // no second line to keep Close off.
    expect(Inbox).toMatch(/marginLeft: "auto" \}\)\}><CloseIcon size=\{IC\.chrome\} \/><\/button>/);
  });

  it("hides the LIST's toolbar while a conversation replaces the list", () => {
    expect(Inbox).toMatch(/\{!shortScreen && \(twoPane \|\| !activeKey\) \? \(\s*<div style=\{\{ padding: "8px 14px"/);
  });

  it("shortens the search placeholder where the long one was cut", () => {
    expect(Inbox).toMatch(/placeholder=\{twoPane && !shortScreen \? "Search name, number or message…" : "Search…"\}/);
  });

  it("offers Enter / Shift+Enter only where there is a keyboard", () => {
    expect(Composer).toMatch(/const TOUCH = typeof window !== "undefined" && !!window\.matchMedia && window\.matchMedia\("\(hover: none\), \(pointer: coarse\)"\)\.matches;/);
    expect(Composer).toMatch(/\(TOUCH \? "Type a reply…" : "Type a reply\.\.\. \(Enter to send, Shift\+Enter for new line\)"\)/);
  });
});

// v18.2.0 phase 46 (round 3's W-1). Measured on a 375px phone: the linked
// booking card's title was 28px wide and "Open booking" was drawn over its
// label and its status badge ("✓ Co"). A wrapping header's title takes its
// content as its basis, so the actions drop under it; after, on the phone the
// label and badge share line one and Open booking starts at y 263 against a
// title ending at 255, while the tablet's header is still one line.
describe("W-1 — a wrapping pane header never draws its actions over its title", () => {
  const Panel = read("components/AlertPanel.jsx");
  it("gives the title its content as basis when the header wraps", () => {
    expect(Panel).toMatch(/flex: wraps \? "1 1 auto" : 1, minWidth: 0 \}\}>\{title\}<\/span>/);
    // v18.16.0: a toggle always wraps, and a fixed header wraps when its caller asks
    // (`wrapHeader`); only a toggle takes the pointer.
    expect(Panel).toContain("const wraps = !!onHeaderClick || wrapHeader;");
    expect(Panel, "the header wraps only when it is a toggle or was asked to").toMatch(/\.\.\.\(wraps \? \{ flexWrap: "wrap" \} : null\)/);
    expect(Panel).toMatch(/\.\.\.\(onHeaderClick \? \{ cursor: "pointer" \} : null\),/);
  });
  it("is the header the linked card uses, and the intent banner whenever it has a body (phase 49)", () => {
    // v18.16.0 (Patryk): the linked card is a toggle on a phone only. On a tablet it is
    // a fixed strip that keeps the wrap, since its line still shares a row with buttons.
    const Linked = read("components/whatsapp/LinkedBookingCard.jsx");
    expect(Linked).toMatch(/onHeaderClick=\{narrow \? toggle : undefined\}/);
    expect(Linked).toContain("wrapHeader={!narrow}");
    expect(read("components/whatsapp/IntentBanner.jsx")).toMatch(/onHeaderClick=\{opens \? toggle : undefined\}/);
  });
});

// v18.2.0 phase 49 (round 3's W-2 + W-3), measured on DEV: the intent banner
// repeated "Linked to: Sun 27.09 · 20:30 · 4 guests" under the linked card that
// says exactly that, and every past-bookings row ended "· completed".
describe("W-2 + W-3 — the conversation says each thing once", () => {
  const Banner = read("components/whatsapp/IntentBanner.jsx");
  it("drops the Linked-to line, and says so only when there is no link", () => {
    expect(Banner).toMatch(/const subtitle = linkedBooking \? null : "No linked booking found";/);
  });
  it("is not a toggle when it has nothing to disclose", () => {
    expect(Banner).toMatch(/const hasBody = !!subtitle \|\| !!showApply;/);
    // v18.4.0: `opens` is `hasBody` everywhere but on a phone, where the
    // buttons are in the body and the banner always opens onto them.
    expect(Banner).toMatch(/const opens = hasBody \|\| !!narrow;/);
    expect(Banner).toMatch(/onHeaderClick=\{opens \? toggle : undefined\}/);
    expect(Banner).toMatch(/\{opens \? <span style=\{\{ color, flexShrink: 0/);
  });
  it("past bookings end at the party's size", () => {
    expect(View).not.toMatch(/guestsLabel\(b\.size\) \+ " · " \+ b\.status/);
  });
});

// v18.9.0 phase 7 — the disconnection banner reads `waLink.status`, and its
// live region stays mounted outside the Reveal (a region mounted with its
// message announces nothing). It eases on `move`: a webhook raises it, not a
// press (/find-animation-opportunities found it on the 520ms disclosure clock).
describe("the inbox's disconnection banner (v18.9.0)", () => {
  it("shows while waLink says disconnected, with the server's reason in words", () => {
    expect(Inbox).toMatch(/const linkDown = !!\(waLink && waLink\.status === "disconnected"\);/);
    expect(Inbox).toMatch(/<div role="alert">\s*<Reveal show=\{linkDown\} speed="move">/);
    expect(Inbox).toMatch(/disconnectSentence\(waLink && waLink\.disconnect\)/);
  });
});

// v18.9.0 follow-up, measured on DEV at 375×812: an archived thread had four actions,
// and they ran 40px past the screen, so the group was made to wrap. v18.14.0 (correction
// 6, Patryk): it has two, Archive or Restore and the ⋯, which fit (Archive 235–318, ⋯
// 324–360 at 375), so the wrapping went with the other three.
// v18.16.0 (Patryk): Archive and Restore are rows of the ⋯ as well, so the header's
// one control is the ⋯, and the "Booking confirmed" chip beside the name is gone: the
// linked booking's own status badge, one row down, says it.
describe("the conversation header has the ⋯ and nothing else", () => {
  const header = View.slice(View.indexOf("const headerActionBtns"), View.indexOf("const disabled = "));
  it("no button of its own, whichever state the thread is in", () => {
    expect(header).toContain("<ConversationMenu");
    expect(header).not.toMatch(/<button|<RestoreIcon|<ArchiveIcon/);
  });
  it("Archive and Restore are rows of the menu, and Restore reads Customer again on a muted thread", () => {
    expect(View).toMatch(/archive: \{ label: "Archive", icon: ArchiveIcon,/);
    expect(View).toMatch(/restore: \{ label: conv\.muted \? "Customer again" : "Restore", icon: RestoreIcon,/);
  });
  it("the rest are not buttons of the header any more", () => {
    expect(header).not.toMatch(/Not a customer<\/button>|Delete<\/button>|Re-check/);
    expect(View).not.toMatch(/mkDangerBtn/);
  });
  it("the header no longer says Booking confirmed: the linked booking's badge does", () => {
    expect(View).not.toMatch(/\bacceptedBadge\b|>Booking confirmed</);
  });
  it("sits at the header's right, unwrapped", () => {
    expect(View).toContain('<div style={{ marginLeft: "auto", flexShrink: 0 }}>{headerActionBtns}</div>');
    expect(header).toContain('<div style={{ display: "flex", gap: 6, flexShrink: 0, justifyContent: "flex-end" }}>');
  });
});

// v18.14.0 (correction 7, Patryk): the draft card's Add to waitlist goes right, on the
// compact bar's wrapping row (`marginLeft`) and in the tall card's column (`alignSelf`).
// `justifyContent` is for Suggest beside it: a group that wraps fills its line, and its
// rows would otherwise start at the left again.
describe("Add to waitlist sits at the draft card's right", () => {
  it("in both shapes of the card, and inside itself", () => {
    expect(Draft).toContain('<div style={Object.assign({}, row, { marginLeft: "auto", alignSelf: "flex-end", justifyContent: "flex-end" })}>');
  });
});

// v18.16.0 (Patryk): "Window: 23h 57m left" stood in green on every open chat. The
// chip is drawn only in the window's last four hours, amber, and red once it has
// closed. `now` is passed in, so nothing here reads a clock.
describe("the window chip shows only when it matters", () => {
  const NOW = 1_800_000_000_000;
  const MIN = 60000, H = 3600000;
  it("four hours is the line he chose", () => {
    expect(WA_WINDOW_WARN_MS).toBe(4 * H);
  });
  it("with more than four hours left there is no chip, and the next change is the start of the warning", () => {
    expect(windowState(NOW + 23 * H + 57 * MIN, NOW)).toEqual({ expired: false, chip: null, nextIn: 19 * H + 57 * MIN });
    expect(windowState(NOW + 4 * H + MIN, NOW)).toEqual({ expired: false, chip: null, nextIn: MIN });
  });
  // v18.16.0 (/code-review): a timer's delay is a 32-bit integer. Past 2^31-1 ms it
  // wraps, and a wrapped negative fires at once (measured in the Browser pane:
  // `setTimeout(fn, 2 ** 31 + 1000)` ran after 0 ms), so the view's self-re-arming
  // timer spun on a stamp weeks ahead. A real window is a day long; this is for the
  // stamp that is not.
  it("the wait it hands the view's timer is one a timer can hold, with room for the view's own 50ms", () => {
    expect(WA_WINDOW_RECHECK_MAX_MS + 50).toBeLessThan(2 ** 31 - 1);
    for (const days of [25, 30, 49, 400, 365 * 3112]) {
      const s = windowState(NOW + days * 24 * H, NOW);
      expect(s, days + " days").toEqual({ expired: false, chip: null, nextIn: WA_WINDOW_RECHECK_MAX_MS });
    }
    expect(windowState(Infinity, NOW).nextIn).toBe(WA_WINDOW_RECHECK_MAX_MS);
    // …and a real window's wait is untouched
    expect(windowState(NOW + 24 * H, NOW).nextIn).toBe(20 * H);
    expect(View).toMatch(/setTimeout\(\(\) => setWinBeat\(\(n\) => n \+ 1\), next \+ 50\);/);
  });
  it("inside four hours it is amber and counts down by the minute", () => {
    expect(windowState(NOW + 4 * H, NOW)).toEqual({ expired: false, chip: { label: "Window: 4h 0m left", tone: "warn" }, nextIn: MIN });
    expect(windowState(NOW + 3 * H + 59 * MIN + 30000, NOW)).toEqual({ expired: false, chip: { label: "Window: 3h 59m left", tone: "warn" }, nextIn: 30000 });
    expect(windowState(NOW + 40 * MIN + 1, NOW)).toEqual({ expired: false, chip: { label: "Window: 40m left", tone: "warn" }, nextIn: 1 });
  });
  it("closed is red, and nothing changes after that", () => {
    expect(windowState(NOW, NOW)).toEqual({ expired: true, chip: { label: "Window expired", tone: "danger" }, nextIn: null });
    expect(windowState(NOW - 5 * H, NOW)).toEqual({ expired: true, chip: { label: "Window expired", tone: "danger" }, nextIn: null });
  });
  it("a conversation with no window has no chip", () => {
    expect(windowState(undefined, NOW)).toEqual({ expired: false, chip: null, nextIn: null });
    expect(windowState(0, NOW)).toEqual({ expired: false, chip: null, nextIn: null });
  });
  it("the open chat arms one timer to the next change, and re-arms on its own beat", () => {
    expect(View).toContain("const win = windowState(conv.windowExpiresAt);");
    expect(View).toMatch(/const next = windowState\(conv\.windowExpiresAt\)\.nextIn;\s*if \(next == null\) return undefined;/);
    expect(View).toContain("}, [conv.phoneKey, conv.windowExpiresAt, winBeat]);");
    expect(View).toContain("<OutlineChip tone={win.chip.tone} size=\"small\">{win.chip.label}</OutlineChip>");
  });
});

// v18.16.0 (follow-up, Patryk): the reply box closes on the SERVER's question.
// `windowState().expired` is false for a chat with no window at all, whose box
// stayed live while api/wa-send.js and api/wa-media.js answered 410 for it.
describe("the reply box is closed whenever the server would refuse the send", () => {
  it("it asks windowOpen, the server's question, and says which of the two it is", () => {
    expect(View).toContain("const disabled = !windowOpen(conv.windowExpiresAt);");
    expect(View).toContain("const noWindow = !Number(conv.windowExpiresAt);");
    expect(View).toContain("disabled={disabled} noWindow={noWindow}");
    expect(Composer).toContain('const NO_WINDOW_PLACEHOLDER = "The guest hasn\'t written yet, so a reply can\'t be sent";');
    expect(Composer).toContain('placeholder={disabled ? (noWindow ? NO_WINDOW_PLACEHOLDER : "Conversation closed") :');
  });
  it("windowOpen is closed for no window, a past one and now; open only for a future one", () => {
    const NOW = 1_800_000_000_000, H = 3600000;
    expect(windowOpen(undefined, NOW)).toBe(false);
    expect(windowOpen(0, NOW)).toBe(false);
    expect(windowOpen(NOW, NOW)).toBe(false);
    expect(windowOpen(NOW - H, NOW)).toBe(false);
    expect(windowOpen(NOW + 1, NOW)).toBe(true);
  });
});
