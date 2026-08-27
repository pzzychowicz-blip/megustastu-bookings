// tests/a11y.test.js
//
// v17.13.0 — the gate behind v17.12.0.
//
// ── Why this file exists, stated precisely ──────────────────────────────────
// v17.12.0 shipped roughly forty individually-correct accessibility decisions,
// and **every one of them is invisible when it is removed**. Delete the `<main>`
// landmark, the `role="status"` on the toast layer, the `htmlFor` in `Fld`, the
// roving tab stop in `ListView` — the app looks identical, behaves identically
// to a mouse user, passes every other test in this directory, and ships.
//
// That is the same property that let all of it be missing for seventeen
// versions. `CLAUDE.md`'s own framing: every rule in this repo was earned by an
// OBSERVED failure, and accessibility defects cause no incident, so they never
// entered the loop. A fix with no gate behind it has a half-life.
//
// ── What this gate can and cannot claim ────────────────────────────────────
// It reads SOURCE. It cannot render, so it cannot claim the app is accessible,
// and it must not be read that way. What it asserts is narrower and worth
// more: that the specific wirings v17.12.0 established are still present, and
// that the three rules that version had to LEARN — twice by shipping their
// violation — have not been undone.
//
// Live measurement is still the method for anything new (the v17.12.0 entry in
// REFACTOR_LOG.md records two SVG facts that source review provably cannot
// catch: a browser paints no `outline` on a `<g>`, and `:focus-visible` never
// matches an SVG element in Chrome).
//
// ── The rule for adding to it ──────────────────────────────────────────────
// Every assertion here goes through `has()` / `hasnt()`, which THROW on a
// pattern that matches nothing in the file — so a check cannot rot into a
// tautology when a file is renamed or a shape is rewritten. The "grep proves
// the grep" cases at the bottom run the helpers against known-bad strings, for
// the reason `tests/style-check.test.js` exists: reading a checker does not
// catch a blind spot; running it against input that must fail does.

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { stripComments } from "../scripts/strip-comments.mjs";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src");

// COMMENTS ARE STRIPPED, and both false positives this file produced on its
// first run were comments. `ConnectionStatus.jsx` explains, in prose, that the
// popover is "NOT `aria-modal` and no focus trap" — so a grep for `aria-modal`
// reads a sentence as the opposite of what it says; and `ListView.jsx`'s card
// carries a comment reading "`role="listitem"`, NOT `role="button"`", which the
// window around the card matched. In a codebase commented this heavily, a
// source check that reads comments is measuring the documentation.
const read = (rel) => stripComments(readFileSync(join(SRC, rel), "utf8")).join("\n");

const App = read("App.jsx");
const Atoms = read("components/atoms.jsx");
const List = read("components/ListView.jsx");
const Timeline = read("components/TimelineView.jsx");
const Glyphs = read("components/FloorGlyphs.jsx");
const Plan = read("components/PlanView.jsx");
const Toasts = read("components/StatusToasts.jsx");
const Strip = read("components/NotificationStrip.jsx");
const BookingForm = read("components/BookingFormModal.jsx");
const Walkin = read("components/WalkinForm.jsx");
const Connection = read("components/ConnectionStatus.jsx");
const Reminder = read("components/ReminderEditor.jsx");
// v17.14.0: the skip link is half markup and half stylesheet, and the CSS half
// is where it can fail invisibly (hidden in a way that also makes it
// unfocusable). Read RAW — stripComments is for JS/JSX, and the point here is
// the declarations, not the prose around them.
// v17.15.1: the stylesheet moved to src/index.css. The rules this file
// asserts (.mgt-skip and friends) went with it, unchanged.
const HTML = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "src", "index.css"), "utf8");

// Assert a source shape is present, with a message saying what breaks without
// it. `why` is not decoration: a failure here is always someone tidying, and
// the sentence is the only thing standing between them and doing it anyway.
function has(src, name, re, why) {
  expect(re.test(src), `${name}: ${why}`).toBe(true);
}
function hasnt(src, name, re, why) {
  expect(re.test(src), `${name}: ${why}`).toBe(false);
}
function count(src, re) {
  return (src.match(re) || []).length;
}

// The full text of an element's OPENING tag, however long it is — JSX inline
// style objects here run to hundreds of characters and grow. It walks to the
// `>` that closes the tag, tracking brace depth and quotes so a `>` inside an
// expression container (`a > b`, an arrow function) does not end it early.
function openingTag(src, open, from = 0) {
  const start = src.indexOf(open, from);
  if (start < 0) throw new Error("a11y.test: no " + open + " found");
  let depth = 0, quote = null;
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    if (quote) { if (c === "\\") i++; else if (c === quote) quote = null; continue; }
    if (c === '"' || c === "'" || c === "`") { quote = c; continue; }
    if (c === "{") depth++;
    else if (c === "}") depth--;
    else if (c === ">" && depth === 0) return src.slice(start, i + 1);
  }
  throw new Error(
    "a11y.test: could not find the end of " + open + "'s opening tag. Fix this " +
    "rather than widening a window — a guard that stops seeing the attribute it " +
    "guards still passes."
  );
}

// Every `<Name ...>` opening tag in a file, whole. A LINE-based grep cannot do
// this job and the v17.15.2 entry says why: that version fixed eight alert
// panes with one and missed four whose two tokens sat on separate lines. Two of
// this version's own twenty call sites are multi-line, so a line grep would
// have reported them missing and a line grep aimed at the fixed shape would
// have reported them present. `[\s/>]` after the name so `<ToggleGroup` never
// answers for `<Toggle`.
function openingTagsOf(src, name) {
  const re = new RegExp("<" + name + "[\\s/>]", "g");
  const out = [];
  let m;
  while ((m = re.exec(src)) !== null) out.push(openingTag(src, "<" + name, m.index));
  return out;
}

describe("landmarks and headings (WCAG 1.3.1, 2.4.1)", () => {
  it("App renders header / nav / main", () => {
    has(App, "<header>", /<header\b/,
      "the app had ZERO landmarks before v17.12.0; a screen-reader user reaching " +
      "the timeline had to traverse every header control every time");
    has(App, '<nav aria-label>', /<nav\s+aria-label="Date"/,
      "the nav landmark is scoped to the three controls that navigate, not the " +
      "whole row — an unnamed or over-wide nav is worse than none");
    has(App, "<main>", /<main\b/, "the app's one main region");
  });

  it("there is exactly one <h1>, and it is in App", () => {
    expect(count(App, /<h1\b/g), "App must render exactly one <h1>").toBe(1);
    for (const [name, src] of Object.entries({ List, Timeline, Plan, Atoms, Strip })) {
      expect(count(src, /<h1\b/g), `${name} must not render an <h1> — one per page`).toBe(0);
    }
  });

  it("the <h1> carries margin:0, which ModalTitle depends on", () => {
    has(App, "<h1 margin", /<h1[^>]*margin:\s*0/,
      "v17.12.0 note: the restaurant name became an <h1>, and a UA default " +
      "margin on it moves the whole header");
  });
});

// v17.14.0. The landmarks are the PROGRAMMATIC bypass; this is the one a sighted
// keyboard user can take. Every assertion here is about a way the link can be
// present and useless — which is the whole risk with a control nobody sees.
describe("the skip link (WCAG 2.4.1)", () => {
  it("exists, and points at the main landmark", () => {
    has(App, "skip link", /className="mgt-skip"\s+href="#mgt-main"/,
      "the bypass a sighted keyboard user takes past the header");
    has(App, "<main id>", /<main\s+id="mgt-main"/, "the link's target");
  });

  it("<main> can HOLD focus, or the link only scrolls", () => {
    // Following a fragment link moves focus to the target only if the target is
    // focusable. Without this the page scrolls and the next Tab starts from the
    // header again — which looks exactly like the link working.
    has(App, "<main tabIndex={-1}>", /<main[^>]*tabIndex=\{-1\}/,
      "-1, not 0: the landmark must be able to RECEIVE focus without joining " +
      "the tab order");
  });

  it("is the FIRST thing in the shell, before <header>", () => {
    const skip = App.indexOf('className="mgt-skip"');
    const header = App.indexOf("<header");
    expect(skip, "the skip link must be in App").toBeGreaterThan(-1);
    expect(header, "App must render a <header>").toBeGreaterThan(-1);
    expect(skip, "a bypass that is not the first thing you reach is not a bypass")
      .toBeLessThan(header);
  });

  it("is OUTSIDE the subtree that goes inert with a modal", () => {
    // A skip link inside an inert subtree is silently unfocusable — the same
    // trap as a live region in one.
    //
    // /code-review: this was a fixed 400-character window sliced backwards from
    // the link, which is the guard shape v17.13.0's own review condemned ("the
    // <main>-never-inert guard read a fixed 400-char window of a 316-char
    // opening tag") — and it could not fail, because moving the link inside
    // <header inert={anyModal}> puts markup between the two that the regex
    // stops at. STRUCTURAL instead: every `inert={anyModal}` in the file is on
    // the header or inside <main>, so the link is outside all of them exactly
    // when its index precedes the first one. That comparison moves when the
    // markup moves.
    const skip = App.indexOf('className="mgt-skip"');
    const firstInert = App.indexOf("inert={anyModal}");
    expect(skip, "the skip link must be in App").toBeGreaterThan(-1);
    expect(firstInert, "App must mark something inert while a modal is open").toBeGreaterThan(-1);
    expect(skip, "the skip link must come before every inert-marked element")
      .toBeLessThan(firstInert);
  });

  it("is hidden by TRANSLATION, not by display/visibility", () => {
    // `display:none` and `visibility:hidden` both make an element unfocusable,
    // so the link could never be reached while looking correct in the source.
    const rule = HTML.slice(HTML.indexOf(".mgt-skip {"), HTML.indexOf(".mgt-skip:focus"));
    expect(rule.length, "could not find the .mgt-skip rule").toBeGreaterThan(50);
    expect(rule, "hidden by transform, so the link stays focusable").toMatch(/transform:\s*translateY\(-/);
    expect(rule).not.toMatch(/display:\s*none/);
    expect(rule).not.toMatch(/visibility:\s*hidden/);
    has(HTML, ".mgt-skip:focus reveals it", /\.mgt-skip:focus\s*\{[^}]*transform:\s*translateY\(0\)/,
      "focus is what brings it back");
  });
});

describe("live regions (WCAG 4.1.3)", () => {
  // THE rule, and the reason each of these lives where it does: a live region
  // must ALREADY be in the DOM when its content changes. One that arrives
  // holding its first message announces nothing.
  it("StatusToasts' always-mounted container is the transient live region", () => {
    has(Toasts, 'role="status"', /role="status"/,
      "the toast container has been always-mounted since v15.8.0 for an " +
      "unrelated reason, which is exactly the property an announcement needs");
    has(Toasts, 'aria-live="polite"', /aria-live="polite"/, "polite, not assertive — a toast is not an interruption");
  });

  it("App owns the notification announcer, and it sits OUTSIDE <main>", () => {
    has(App, "notifAnnounce region", /className="mgt-sr-only"\s+role="status"\s+aria-live="polite"/,
      "NotificationStrip mounts WITH its first message, so it cannot announce " +
      "its own arrival; App's always-mounted hidden region does the talking");
    const main = App.indexOf("<main");
    const close = App.indexOf("</main>");
    const announcer = App.search(/className="mgt-sr-only"\s+role="status"/);
    expect(main, "no <main> in App").toBeGreaterThan(-1);
    expect(
      announcer > close || announcer < main,
      "the announcer must sit OUTSIDE <main>: `inert` removes a subtree from " +
      "the ACCESSIBILITY tree as well as the tab order, so a live region inside " +
      "an inert region goes silent"
    ).toBe(true);
  });

  it("the strip is a landmark, deliberately not a live region", () => {
    has(Strip, 'role="region"', /role="region"\s+aria-label="Notifications"/,
      "marking the pane live would re-read every section on each dismissal, and " +
      "it mounts with its first message so it would announce nothing anyway");
    hasnt(Strip, "aria-live", /aria-live=/,
      "if the strip ever becomes a live region, App's notifAnnounce is now " +
      "duplicating it — decide which one speaks, do not ship both");
  });

  it("both forms keep a permanently-mounted role=alert wrapper", () => {
    for (const [name, src] of Object.entries({ BookingForm, Walkin })) {
      has(src, `${name} role=alert`, /role="alert"/,
        "clicking Save on an empty form rendered good, specific copy that was " +
        "announced by nothing; the wrapper is always rendered and only its " +
        "CHILD is conditional, or it announces nothing on the first error");
    }
  });
});

// v17.14.0. The strip and the toasts have spoken since v17.12.0; the VIEW did
// not, so arrow-key navigation moved a screen-reader user through the week in
// silence.
describe("the day announcer (WCAG 4.1.3)", () => {
  it("is a THIRD region, not a share of the notification one", () => {
    // They answer different questions and can change in the same commit — a date
    // change that also brings a clash into view. One region would have had the
    // two overwrite each other, with the winner decided by render order.
    expect(
      count(App, /className="mgt-sr-only" role="status" aria-live="polite"/g),
      "App must mount both hidden live regions"
    ).toBe(2);
    has(App, "dayAnnounce region", /aria-live="polite">\{dayAnnounce\}/,
      "the day summary needs its own region");
  });

  it("is keyed on the DATE alone, through a ref mirror", () => {
    // A memo over `bookings` would recompute on every write, and a write that
    // changes the COUNT — a cancellation, a walk-in — would re-announce the whole
    // day at a moment nobody navigated. The ref is what makes "date change only"
    // literal rather than approximate.
    const at = App.indexOf("const [dayAnnounce");
    expect(at, "dayAnnounce must exist").toBeGreaterThan(-1);
    const body = App.slice(at, at + 1400);
    has(body, "ref mirror", /bookingsForAnnounceRef\.current/,
      "the count is read from a ref, not from a dependency");
    has(body, "[viewDate] only", /\},\s*\[viewDate\]\);/,
      "the effect must depend on viewDate and nothing else");
  });

  it("says what navigation changed: the day, and what is on it", () => {
    const at = App.indexOf("const [dayAnnounce");
    expect(at, "dayAnnounce must exist").toBeGreaterThan(-1);
    const body = App.slice(at, at + 1400);
    has(body, "weekday + date", /weekday:\s*"long"/, "the weekday is the part you navigate by");
    has(body, "UTC", /timeZone:\s*"UTC"/,
      "a local weekday against a UTC date string shifts a day in UTC+ zones");
    has(body, "closed days", /Closed/, "a closed day is what the summary must say");
    has(body, "empty days", /Nothing booked/, "…and so is an empty one");
  });
});

// v17.14.0 (/code-review). The empty-day prompt and the list container are
// siblings, so on a cancelled-only day the second contradicts the first.
describe("an empty list does not announce itself", () => {
  it("ListView's Bookings role is conditional on there being bookings", () => {
    has(List, "conditional list role", /role=\{active\.length \? "list" : undefined\}/,
      "an empty role=\"list\" under \"Nothing booked for this day yet\" announces " +
      "\"Bookings, list, 0 items\" — a contradiction, not information");
    has(List, "conditional list name", /aria-label=\{active\.length \? "Bookings" : undefined\}/,
      "a name on a list with no items is the same defect one attribute along");
  });

  it("…but the element stays mounted, because useFlip needs the container", () => {
    // `useFlip`'s layout effect returns early on a null container, so unmounting
    // this div would silently kill the list-reorder animation.
    has(List, "flipRef still on a mounted div", /<div ref=\{flipRef\} role=/,
      "the role is what is conditional, not the element");
  });
});

describe("inert marks the page BEHIND the dialog, not <main>", () => {
  // v17.12.0 shipped this wrong and its own /code-review caught it. <main> also
  // holds StatusToasts — the app's OTHER live region — and the Undo pill, so
  // `inert` there silenced every toast behind every modal and made Undo
  // unclickable. The test is not "is this in the DOM behind the dialog" but
  // "is this the PAGE behind the dialog".
  // /code-review: this used to slice a fixed 400 characters and split on the
  // first `>`. <main>'s opening tag is 316 characters of inline style — 79% of
  // that budget — so one more conditional branch in the style object would push
  // the closing `>` past the window, and the guard against exactly one attribute
  // would silently stop covering the end of the tag that attribute would be
  // added to. `openingTag` finds the real end instead, and THROWS if it cannot,
  // which is the failure mode to prefer over a quiet pass.
  it("<main> itself is never inert", () => {
    const tag = openingTag(App, "<main");
    expect(
      /\binert\b/.test(tag),
      "`inert` is on <main>'s opening tag. It must sit on the two CONTENT " +
      "children instead — <main> also contains StatusToasts (a live region) and " +
      "the Undo pill, and inert would silence and disable both."
    ).toBe(false);
  });

  it("anyModal is one derivation, not an expression written out per reader", () => {
    has(App, "anyModal", /\banyModal\s*=/,
      "it replaced a 17-term expression written twice in useKeyboardShortcuts; " +
      "`inert` would have made it three");
  });
});

describe("form fields are named (WCAG 1.3.1, 3.3.2, 4.1.2)", () => {
  // Measured before v17.10.2: the booking form had 9 <label>s, 0 associated,
  // and 7 of 7 fields unnamed — markup that looks perfectly labelled and isn't.
  it("Fld associates a single control by useId + htmlFor", () => {
    has(Atoms, "useId", /const id = useId\(\)/, "implicit association needs the control INSIDE the label; there was neither that nor an id pair");
    has(Atoms, "htmlFor", /htmlFor=\{single \? id : undefined\}/,
      "htmlFor is deliberately NOT rendered on the composite path — a `for` " +
      "aimed at an id that is not in the tree is a dangling reference");
  });

  it("Fld names a composite field as a group instead", () => {
    has(Atoms, 'role="group"', /role=\{single \? undefined : "group"\}/,
      "a stepper pair, a chip row or a list of times has no single control to " +
      "point at, so the wrapper is named by the label");
    has(Atoms, "aria-labelledby", /aria-labelledby=\{single \? undefined : id \+ "-l"\}/,
      "the group path is named by the label element, the single path by htmlFor");
  });

  it("Fld carries validity on BOTH shapes", () => {
    has(Atoms, "aria-invalid", /a\["aria-invalid"\] = "true"/,
      "building the state attrs only for the function shape made `invalid` a " +
      "silently ignored prop on half the atom's surface (v17.12.0 /code-review)");
    has(Atoms, "aria-describedby guarded", /if \(describedBy\) a\["aria-describedby"\] = describedBy;/,
      "describedBy is emitted ONLY alongside aria-invalid: an id that is not in " +
      "the tree is a dangling reference, the same trade Overlay refuses");
  });

  it("aria-required stays on the control, never on the group", () => {
    has(Atoms, "aria-required single-only", /if \(req && single\) a\["aria-required"\] = "true"/,
      "aria-invalid and aria-describedby are global attributes and may sit on a " +
      "group; aria-required belongs on a control");
  });
});

describe("the bookings themselves are reachable (WCAG 2.1.1, 4.1.2)", () => {
  // Before v17.12.0: 13 timeline blocks, 27 plan shapes and 10 list cards, all
  // `tabIndex -1`, no role. The tab order held 21 chrome controls and not one
  // booking — in the one app here that is explicitly keyboard-driven.
  it("List cards are listitems in a list, with a roving tab stop", () => {
    has(List, 'role="list"', /role="list"/, "a real list, and the finished cards need their own — a list must hold its items directly");
    has(List, 'role="listitem"', /role="listitem"/, "the card holds six controls; see the next test");
    has(List, "roving tab stop", /tabIndex=\{rovingId === b\.id \? 0 : -1\}/,
      "ten cards x six controls would put ~70 tab stops between the top of List " +
      "and anything after it");
    has(List, "Enter/Space", /onKeyDown=/, "the card opens the edit form, so it must be operable from the keyboard");
  });

  it("the List card is NOT a button", () => {
    // ARIA makes a button's children presentational. The card holds Assign,
    // four status changers and Delete — labelling it a button trades one
    // unreachable card for six unreachable controls.
    const cardTag = List.slice(List.indexOf('role="listitem"') - 600, List.indexOf('role="listitem"') + 200);
    expect(
      /role="button"/.test(cardTag),
      "the List card must not be role=button — a button's children are " +
      "PRESENTATIONAL, and this card contains six controls"
    ).toBe(false);
  });

  it("timeline blocks and waitlist ghosts are operable", () => {
    // The block's role is unconditional. The ghost's is gated on `leaving`
    // (v17.15.3) — a departing ghost is held mounted purely so its fade can
    // finish, and must not stay a focusable "Book this table" button for a
    // party that may have just left the waitlist. Same shape as the floor-plan
    // glyph's `activatable` gate below.
    const roles = count(Timeline, /role="button"/g)
      + count(Timeline, /role=\{leaving \? undefined : "button"\}/g);
    expect(roles, "the block and the ghost").toBeGreaterThanOrEqual(2);
    has(Timeline, "Enter/Space", /if \(e\.key !== "Enter" && e\.key !== " "\) return;/,
      "routed through the same handler as a click so they inherit its didLong guard");
  });

  it("a DEPARTING waitlist ghost is inert, not merely invisible", () => {
    // It outlives its own fade by design (useRevealRows prunes at
    // REVEAL_EXIT_MS). All four have to hold together: without aria-hidden a
    // screen reader still meets it, without tabIndex -1 Tab still lands on it,
    // without dropping onClick a tap still books, and without pointerEvents
    // none it still swallows a press aimed at the block behind it.
    has(Timeline, "aria-hidden while leaving", /aria-hidden=\{leaving \? true : undefined\}/,
      "removed from the a11y tree for the length of its hold");
    has(Timeline, "not tabbable while leaving", /tabIndex=\{leaving \? -1 : 0\}/,
      "Tab must not land on a ghost that is on its way out");
    has(Timeline, "no click while leaving", /onClick=\{leaving \? undefined :/,
      "a departing ghost must not book a party that already left the waitlist");
    has(Timeline, "no pointer events while leaving", /pointerEvents: leaving \? "none" : undefined/,
      "so it cannot swallow a press aimed at whatever is behind it");
  });

  it("a ghost that leaves while HOLDING focus hands it back", () => {
    // /code-review: going inert means aria-hidden, and focused + hidden is a
    // state assistive tech need not make sense of; then it unmounts and focus
    // drops to <body>. Target is the grid scroller, tabIndex -1 (the
    // `<main tabIndex={-1}>` skip-link pattern), with preventScroll because
    // focusing otherwise yanks a horizontal scroller sideways.
    has(Timeline, "focus escape", /document\.activeElement !== el/,
      "only acts when this ghost is the focused element");
    has(Timeline, "preventScroll", /focus\(\{ preventScroll: true \}\)/,
      "focusing a scroller without it drags the grid under the user");
    has(Timeline, "scroller is a programmatic focus target", /tabIndex=\{-1\}\n\s*className="mgt-tl-scroll"/,
      "reachable by script, never by Tab");
  });

  it("the ghost's `leaving` means ABSENT, not merely un-opened", () => {
    // /code-review: useRevealRows adds a NEWCOMER to renderIds one commit
    // before its rAF opener adds it to openIds, so deriving `leaving` from
    // openIds called an ARRIVING ghost leaving for a frame — painting it at
    // full opacity on the exit keyframe, inert and aria-hidden, before the
    // entrance restarted it from 0.
    has(Timeline, "leaving={!cell}", /leaving=\{!cell\}/,
      "absence from the live cell map is what departure means");
    expect(
      /leaving=\{!ghostOpenIds\.has/.test(Timeline),
      "must not derive `leaving` from openIds — a newcomer is not in it either"
    ).toBe(false);
  });

  it("floor-plan tables are operable and NAMED by their caller", () => {
    has(Glyphs, "role", /role=\{activatable \? "button" : undefined\}|role=\{activatable/,
      "gated on onClick, not the wider `live` flag: the editor's onPointerDown " +
      "is a drag, which has no keyboard equivalent to offer");
    has(Glyphs, "ariaLabel prop", /ariaLabel/, "only PlanView knows a table's state");
    has(Plan, "PlanView supplies the label", /ariaLabel=/,
      "on this view the FILL is the state — without a name a screen reader " +
      "meets a room of identical buttons");
  });
});

describe("focusable content must not scroll under the finger", () => {
  // The one regression v17.12.0 shipped and had to fix. A browser focuses an
  // element on MOUSEDOWN, and scrolling it into view is part of focusing —
  // measured at 40px on a plan table, 1000-2000px sideways on a timeline block.
  // The element leaves from under the finger between press and release, so the
  // click lands elsewhere and the popover never opens.
  it("timeline blocks and ghosts suppress pointer focus", () => {
    expect(
      count(Timeline, /onMouseDown=\{\(e\) => \{ e\.preventDefault\(\); \}\}/g),
      "both the block and the waitlist ghost need it. preventDefault on " +
      "mousedown suppresses ONLY focus — not the click, not pointer events — " +
      "so drags and holds are unaffected."
    ).toBeGreaterThanOrEqual(2);
  });

  it("the List card focuses itself with preventScroll instead", () => {
    has(List, "preventScroll", /preventScroll:\s*true/,
      "the card cannot use preventDefault — that would kill the phone-number " +
      "text selection staff use to ring a party — so it focuses ITSELF without " +
      "the scroll. Leaving pointer focus alone moved the card 297px.");
  });
});

describe("the connection popover claims only what it is", () => {
  it("the dot announces its popover", () => {
    has(Connection, "aria-haspopup", /aria-haspopup="dialog"/, "it opens status, identity, the device list and Log out");
    has(Connection, "aria-expanded", /aria-expanded=/, "it carried null before and after opening");
    has(Connection, 'role="dialog"', /role="dialog"/, "named 'Connection and account'");
  });

  it("it does NOT claim aria-modal", () => {
    hasnt(Connection, "aria-modal", /aria-modal/,
      "the popover has no focus trap, so it must not claim one — the same " +
      "trade Overlay makes in the other direction by resolving its name from " +
      "the DOM rather than promising one it might not have");
  });
});

describe("every modal is Overlay's modal (WCAG 4.1.2, 2.4.3)", () => {
  // v17.15.0. `Overlay` carries five things no modal can be correct without —
  // `role="dialog"`, `aria-modal`, an accessible name resolved from the DOM, a
  // focus trap, and focus restore on close. A component that builds its own
  // scrim and card gets NONE of them, and there is nothing on screen to say so.
  //
  // ReminderEditor did exactly that for eleven versions. Its stated reason was
  // that it renders at z-index 250 while Overlay's scrim is 200 — which was
  // false the whole time, because the discard confirm sits at 260 using Overlay
  // and gets there by WRAPPING it in a positioned div. The lesson is not "don't
  // forget the roles"; it is that a plausible-sounding structural excuse is how
  // a modal ends up outside the atom, so the check is on the STRUCTURE.
  //
  // `var(--scrim)` is the tell, and it is a precise one. It is the modal scrim
  // specifically — the popups (SplitMenu, QuickStatusPopup) paint
  // `--tl-popup-scrim`, a different token, because a popup is not a dialog and
  // must not claim to be one. So: exactly one file may reference `--scrim`, and
  // it is the file that owns the behaviour.
  const MODAL_SCRIM = /var\(--scrim\)/;

  it("only atoms.jsx paints the modal scrim", () => {
    has(Atoms, "Overlay", MODAL_SCRIM, "Overlay is the one place the modal scrim is drawn");
    const dir = join(SRC, "components");
    const offenders = readdirSync(dir)
      .filter((f) => /\.jsx?$/.test(f) && f !== "atoms.jsx")
      .filter((f) => MODAL_SCRIM.test(stripComments(readFileSync(join(dir, f), "utf8")).join("\n")));
    expect(
      offenders,
      "a component painting var(--scrim) is building a second Overlay, and it " +
      "gets no dialog role, no focus trap and no accessible name. Use Overlay; " +
      "if it must sit above another modal, wrap it in a positioned div with a " +
      "higher z-index (ReminderEditor at 250, the discard confirm at 260) " +
      "rather than reimplementing the surface."
    ).toEqual([]);
    // App.jsx renders its confirm dialogs INLINE, so it is checked too.
    hasnt(App, "App.jsx", MODAL_SCRIM, "App's confirm dialogs go through Overlay");
  });

  it("ReminderEditor is on Overlay, at z=250, and owns no scrim of its own", () => {
    has(Reminder, "Overlay import", /import\s*\{[^}]*\bOverlay\b[^}]*\}\s*from\s*"\.\/atoms"/,
      "it was the last modal outside the atom");
    has(Reminder, "<Overlay", /<Overlay\b/, "the shell is Overlay's, not hand-written");
    has(Reminder, "z=250 wrapper", /position:\s*"relative",\s*zIndex:\s*250/,
      "it must render ABOVE Settings (z=200). A wrapper with position + z-index " +
      "makes a stacking context, so the subtree stacks at 250 whatever the " +
      "fixed children inside it declare — remove it and the editor paints " +
      "UNDER the modal that opened it, which no test but this one would notice");
    hasnt(Reminder, "hand-written scrim/card classes", /mgt-(scrim|card)-(in|out)/,
      "Overlay owns the open/close animation now; a second copy would fight it");
    hasnt(Reminder, "useModalPresence", /useModalPresence/,
      "Overlay reads the wrapping ModalPresence itself");
  });
});

describe("the Toggle atom is a switch, and every one of them is named (WCAG 1.3.1, 4.1.2)", () => {
  // v17.15.4. `Toggle` was a bare <button> whose entire content was two
  // coloured divs — no text, no role, no state — so every on/off control in
  // the app announced as "button", twenty of them, indistinguishable from each
  // other and from the buttons around them. Settings is almost entirely built
  // out of it.
  //
  // It survived v17.12.0 AND v17.13.0's gate, and the reason is worth stating
  // because it is how the next one will survive too: both passes went after the
  // surfaces that hold BOOKINGS — the card, the block, the floor-plan table,
  // the form field — and an atom that draws a 48×26 pill is not where anyone
  // looks for a missing name. The generalisation is not "check the atoms"; it
  // is that **a control with no text content has no name unless someone gives
  // it one**, and nothing about looking at it says so.
  //
  // These assertions are deliberately in two halves. The atom half is one
  // shape in one file. The call-site half is a SWEEP, because `label` has no
  // default: the atom cannot make a caller name it, so the build has to.
  // /code-review: this read `src/components` only, while its own failure
  // message claimed "every <Toggle> in the app" — the repo's recorded fault
  // class, a guard NARROWER than the rule it gates. `Toggle` is a plain export
  // importable from anywhere, and `App.jsx` already renders its own inline
  // confirm dialogs and header controls; a switch added there would have
  // shipped unnamed with the build green, which is exactly the defect this
  // version exists to remove, walking past the gate built to stop it. It walks
  // all of `src/` now. `atoms.jsx` is NOT excluded either — an atom composing
  // Toggle has the same obligation as any other caller.
  const jsxFilesUnder = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? jsxFilesUnder(join(dir, e.name))
      : /\.jsx?$/.test(e.name) ? [join(dir, e.name)] : []);
  const withToggle = jsxFilesUnder(SRC)
    .map((f) => [f.slice(SRC.length + 1), stripComments(readFileSync(f, "utf8")).join("\n")])
    .filter(([, src]) => /<Toggle[\s/>]/.test(src));

  // atoms.jsx is a multi-export file and `Collapsible`'s header button comes
  // FIRST, so a file-wide search here measures the wrong control — which is
  // what the first version of this block did, and it failed loudly only
  // because `Collapsible` happens to have a button too. Scope to the function.
  const toggleStart = Atoms.indexOf("export function Toggle(");
  const nextExport = Atoms.indexOf("export function", toggleStart + 10);
  const ToggleFn = Atoms.slice(toggleStart, nextExport < 0 ? Atoms.length : nextExport);

  it("the atom's own button carries role=switch, aria-checked and aria-label", () => {
    expect(toggleStart, "atoms.jsx must export a Toggle").toBeGreaterThan(-1);
    const tag = openingTag(ToggleFn, "<button");
    expect(tag, "the role goes on the control, not on a wrapper").toMatch(/role="switch"/);
    expect(tag, "aria-checked publishes the state").toMatch(/aria-checked=\{!!on\}/);
    // The coercion is not decoration: `on` arrives as `r.active`, `draft.active`
    // and `bd.lateEnabled`, any of which can be undefined — and a bare
    // `aria-checked={on}` then omits the attribute entirely, leaving a switch
    // that renders as off and reports no state at all.
    expect(tag, "the name the caller supplies").toMatch(/aria-label=\{label\}/);
    has(ToggleFn, "label in the signature", /function Toggle\(\{[^}]*\blabel\b/,
      "a prop read but not destructured is a silent undefined");
  });

  it("it is a switch, NOT aria-pressed", () => {
    hasnt(ToggleFn, "aria-pressed", /aria-pressed/,
      "a toggle button reports an action you took; a switch reports a state " +
      "that stays. Every one of these writes a setting");
  });

  it("it stays a <button> element, so the stylesheet's button rules still reach it", () => {
    // The v17.12.0 lesson in its other direction. A role SUBSCRIBES an element
    // to the rules written for it — and src/index.css has no `[role="switch"]`
    // rule, which was checked before the role went on. What the role must not
    // do is cost the element the rules it already had: `user-select: none`, the
    // 0.96 press dip and the transform transition are all written against the
    // `button` ELEMENT selector, which a <div role="switch"> would not match.
    expect(openingTag(ToggleFn, "<button"), "Toggle must remain a real <button>")
      .toMatch(/^<button\b/);
  });

  it("every <Toggle> in the app passes a label", () => {
    const unnamed = [];
    for (const [file, src] of withToggle) {
      for (const tag of openingTagsOf(src, "Toggle")) {
        if (!/\blabel=/.test(tag)) unnamed.push(file + ": " + tag.slice(0, 90));
      }
    }
    expect(
      unnamed,
      "a Toggle with no `label` announces as an unnamed switch — which is most " +
      "of what this version exists to fix. Name what the switch CONTROLS, never " +
      "its state: the state is aria-checked's job, and a name that flips with " +
      "the value makes one control read as two."
    ).toEqual([]);
  });

  it("a Toggle rendered from a list names the ITEM, not the control", () => {
    // The half of this that source review misses and the live page shows in
    // one line. Three of the twenty switches are rendered inside a `.map` —
    // one per reminder, one per standing-booking rule, one per party-size band
    // — so a static label there is not one name, it is N identical names, and
    // it is precisely the defect this version exists to fix, reappearing one
    // level down. The size-band one nearly shipped that way; what caught it
    // was reading the rendered names out of the running app, where the
    // repetition is three identical strings, rather than out of the source,
    // where it is one string inside a loop.
    //
    // A regex cannot reliably tell "inside a .map" from "beside one", so this
    // does not try. It pins the three known list-rendered call sites to a
    // DYNAMIC label, which is the property that makes them per-item.
    for (const [file, marker] of [
      ["components/Reminders.jsx", /<Toggle\s+label=\{"Reminder: "/],
      ["components/Settings.jsx", /<Toggle\s+label=\{"Standing booking: "/],
      ["components/LayoutSettings.jsx", /<Toggle label=\{bandName\(b, i\)/],
    ]) {
      const src = withToggle.find(([f]) => f === file);
      expect(src, file + " must still render a Toggle").toBeTruthy();
      has(src[1], file + " list Toggle", marker,
        "this switch is rendered once per item, so its label must carry the " +
        "item's own identity — a string literal here gives every row in the " +
        "list the same name");
    }
  });

  it("no two Toggles in one file share a literal label", () => {
    // The copy-paste case the rule above cannot see. Settings alone holds
    // fourteen of these and they are edited by duplicating the row above.
    const clashes = [];
    for (const [file, src] of withToggle) {
      const seen = new Map();
      for (const tag of openingTagsOf(src, "Toggle")) {
        const m = /\blabel="([^"]+)"/.exec(tag);
        if (!m) continue;
        if (seen.has(m[1])) clashes.push(file + ': two switches both named "' + m[1] + '"');
        seen.set(m[1], true);
      }
    }
    expect(clashes, "two switches with one name is one switch as far as a " +
      "screen reader is concerned").toEqual([]);
  });

  it("the sweep is actually finding call sites", () => {
    // Without this the assertion above passes triumphantly on zero files the
    // day someone renames the atom.
    const total = withToggle.reduce((n, [, src]) => n + openingTagsOf(src, "Toggle").length, 0);
    expect(withToggle.length, "several components use Toggle").toBeGreaterThanOrEqual(5);
    expect(total, "and there are ~20 switches between them").toBeGreaterThanOrEqual(15);
  });

  it("every Stepper call site names what it steps", () => {
    // v17.15.5. The `Stepper` in LayoutSettings renders two buttons whose entire
    // content is `−` and `+`. Thirteen call sites, so twenty-six controls all
    // announcing as one of two characters — the Toggle defect one control over,
    // and bigger, because seven of the thirteen are inside a `.map`.
    //
    // `label` is required and has no default, so the atom itself is what makes
    // an unnamed stepper unreachable; this guards the CALL SITES, which is the
    // half a required prop cannot enforce in plain JS.
    const src = read("components/LayoutSettings.jsx");
    const tags = openingTagsOf(src, "Stepper").filter((t) => !/^<Stepper\b[^>]*\bvalue=\{value\}/.test(t));
    expect(tags.length, "LayoutSettings should still render ~13 steppers")
      .toBeGreaterThanOrEqual(12);
    const unlabelled = tags.filter((t) => !/\blabel=/.test(t));
    expect(unlabelled, "a Stepper with no `label` announces as \u2212 and + — name " +
      "what it steps, and carry the item's identity where it repeats")
      .toEqual([]);
  });

  it("a Stepper rendered from a list names the ITEM", () => {
    // Same rule as the list-rendered Toggle above, and the same reason a regex
    // cannot decide "inside a .map": these are pinned by name. Each of the four
    // repeating groups must build its label from the ROW, not from a literal —
    // `bandName` / `comboName` / `swapName` / the table id.
    const src = read("components/LayoutSettings.jsx");
    // COUNTED, not merely present. `has()` is satisfied by a single match, so
    // reverting ONE of a pair to a literal would slip through — proven: with
    // the size band's "smallest party size" made static, its sibling "largest"
    // still matched and the assertion passed. Each row-namer is pinned to how
    // many steppers it must label.
    for (const [what, re, n] of [
      ["per-table capacity", /label=\{"seats at table " \+ t\.id\}/g, 1],
      ["size-band party size", /label=\{bandName\(b, i\) \+ ": (?:smallest|largest) party size"\}/g, 2],
      ["combo-rule party size", /label=\{comboName\(r, i\) \+ ": /g, 3],
      ["swap-rule party size", /label=\{swapName\(r, i\) \+ ": /g, 2],
    ]) {
      expect(count(src, re),
        "LayoutSettings " + what + ": this stepper is rendered once per row, so " +
        "every one of them must build its label from the row's own identity — a " +
        "literal gives every row in the list the same name").toBe(n);
    }
  });

  it("the priorities editor's repeating buttons carry their row's identity", () => {
    // The ROADMAP entry v17.15.4 left behind. Three bands ship by default, so
    // each of these was one string in the source and three identical names on
    // the page: the \u2715, the Table order / Indoor / Outdoor segmented buttons,
    // the Prefer/Avoid chips' move and remove controls, and the two <select>s.
    const src = read("components/LayoutSettings.jsx");
    for (const [what, re] of [
      ["band remove", /aria-label=\{"Remove " \+ bandName\(b, i\)\}/],
      ["zone-order segment", /aria-label=\{opt\[1\] \+ " \(" \+ bandName\(b, i\) \+ "\)"\}/],
      ["combo rule remove", /aria-label=\{"Remove " \+ comboName\(r, i\)\}/],
      ["combo select", /aria-label=\{"Combo for rule " \+ \(i \+ 1\)\}/],
      ["swap select", /aria-label=\{"Table to free, swap rule " \+ \(i \+ 1\)\}/],
      ["swap remove", /aria-label=\{"Remove " \+ swapName\(r, i\)\}/],
      ["chip move up", /aria-label=\{"Move " \+ id \+ " up in " \+ label \+ rowIn\}/],
      ["chip remove", /aria-label=\{"Remove " \+ id \+ " from " \+ label \+ rowIn\}/],
    ]) {
      has(src, "priorities " + what, re,
        "rendered once per rule/band, so the name must identify which one");
    }
  });

  it("a priorities row is named by its ORDINAL, not by its contents alone", () => {
    // /code-review, v17.15.5. `addBand`, `addRule` and `addSwap` each append a
    // FIXED default — {min:2,max:2}, declared[0].key with 2-8, tables[0].id
    // with 4->2 — so pressing "+ Add size rule" twice yields two rows that are
    // character-for-character identical. A name built from row CONTENT then
    // gives every control in one row the same name as its twin, which is this
    // whole sweep's defect one level down, reachable in two clicks.
    const src = read("components/LayoutSettings.jsx");
    for (const [what, re] of [
      ["bandName", /const bandName = \(b, i\) =>[^;]*\(i \+ 1\)/],
      ["comboName", /const comboName = \(r, i\) =>[^;]*\(i \+ 1\)/],
      ["swapName", /const swapName = \(r, i\) =>[^;]*\(i \+ 1\)/],
    ]) {
      has(src, what, re,
        "must take its row index and put it in the name — two rows with the " +
        "same contents are two rows, and every add button creates one");
    }
  });

  it("the zone-order segments lead with their VISIBLE text", () => {
    // WCAG 2.5.3 (Label in Name), which v17.15.4's own /code-review caught this
    // repo breaking while it thought it was fixing something. These three
    // buttons DO have words — "Table order", "Indoor", "Outdoor" — so a name
    // like "Try first: Indoor (party of 2 to 2)" would stop "click Indoor"
    // working. `opt[1]` must come FIRST, with the band in parentheses after it.
    const src = read("components/LayoutSettings.jsx");
    has(src, "zone-order segment", /aria-label=\{opt\[1\] \+ " \("/,
      "the visible label leads and the disambiguator follows — never a " +
      "paraphrase, and never the disambiguator first");
  });

  it("the Opening-hours row names its buttons per weekday", () => {
    // The same fault one control over, and the reason the sweep did not stop at
    // `<Toggle`: these two buttons HAVE text, so they read as named. But an
    // element with content is named BY that content, and the weekday is a
    // sibling <span> — seven rows announcing "Open" and seven announcing
    // "copy → all", with nothing saying which day either belongs to.
    const Settings = read("components/Settings.jsx");
    has(Settings, "Open/Closed pill", /aria-label=\{label \+ ": " \+ \(closed \? "Closed" : "Open"\)\}/,
      "the day is what distinguishes one of these seven from the next");
    // /code-review: the first version of this name was the sentence "Copy Mon's
    // hours to all days", which fixed the ambiguity and broke WCAG 2.5.3 in the
    // same stroke — the button's visible text is "copy → all", voice control
    // matches on the NAME, and the old name-from-content was exactly that
    // string, so "click copy all" worked BEFORE the fix and not after. The
    // visible label leads; the weekday only disambiguates.
    has(Settings, "copy → all", /aria-label=\{"copy → all \(" \+ label \+ "\)"\}/,
      "the visible text must stay INSIDE the accessible name, or a voice-control " +
      "user can read the button and not say it");
  });

  it("no accessible name in the app hides its own visible text", () => {
    // The general form of the finding above, for the two buttons whose visible
    // text and aria-label are both literals in the source. A name that replaces
    // the visible text rather than extending it is a 2.5.3 failure, and it
    // looks like an improvement in review — which is how it shipped.
    const Settings = read("components/Settings.jsx");
    for (const [visible, tag] of [["Open", /aria-label=\{label \+ ": " \+ \(closed \? "Closed" : "Open"\)\}/],
                                  ["copy → all", /aria-label=\{"copy → all \(/]]) {
      has(Settings, '"' + visible + '" stays in its name', tag,
        "the accessible name must contain the visible label, not paraphrase it");
    }
    // ReminderEditor's switch has no text of its own; its only visible
    // labelling is a sibling reading "Active" or "Inactive", so a name
    // containing either word matches one state and contradicts the other.
    hasnt(Reminder, "state word in the name", /label="Reminder (active|inactive)"/i,
      "a name that contains neither word is sayable in both states — and " +
      "aria-checked is what carries the state, never the name");
    has(Reminder, "Reminder status", /label="Reminder status"/, "the name that works in both states");
  });
});

describe("LayoutSettings' Tables and Combos name their rows (v17.15.6)", () => {
  // The other half of the ROADMAP entry v17.15.5 opened. v17.15.5 closed the
  // priorities editor at the bottom of this file; these sit ABOVE it and were
  // untouched — the same file, the same defect, one scroll apart.
  //
  // These buttons are ICON-ONLY with a `title`, so `title` was their entire
  // accessible name. That is what made them invisible to the earlier sweeps:
  // a control with a `title` does not LOOK unnamed the way `<Toggle>` did.
  const src = read("components/LayoutSettings.jsx");

  it("every repeating Tables/Combos control carries its row", () => {
    for (const [what, re] of [
      ["rename table", /aria-label=\{"Rename table " \+ t\.id\}/],
      ["remove table", /aria-label=\{"Remove table " \+ t\.id\}/],
      ["chip move left", /aria-label=\{"Move " \+ id \+ " left in its joined group"\}/],
      ["chip move right", /aria-label=\{"Move " \+ id \+ " right in its joined group"\}/],
      ["chip remove", /aria-label=\{"Remove " \+ id \+ " from its joined group"\}/],
      ["add to group", /aria-label=\{"Add a table to the group " \+ group\.join\(" \+ "\)\}/],
      ["remove group", /aria-label=\{"Remove the group " \+ group\.join\(" \+ "\)\}/],
      ["remove mega combo", /aria-label=\{"Remove the cross-group combo " \+ mc\.ids\.join\(" \+ "\)\}/],
    ]) {
      has(src, what, re,
        "rendered once per table / group / combo, so the name must say WHICH — " +
        "`title` alone gave thirteen buttons one name and looked named doing it");
    }
  });

  it("the zone toggle leads with its visible text (WCAG 2.5.3)", () => {
    // The one control in these two sections that HAS words. Its visible text is
    // "Indoor" or "Outdoor", so a name like "Change zone for table 3" would fix
    // the ambiguity and break voice control in the same stroke.
    has(src, "zone toggle", /aria-label=\{\(indoor \? "Indoor" : "Outdoor"\) \+ " \(table " \+ t\.id \+ "\)"\}/,
      "the visible word leads and the table only disambiguates");
  });

  it("a name says what a control IS, never what it does next", () => {
    // The zone toggle flips between two real values. Naming it for the ACTION
    // ("Make table 3 indoor") would mean the name contradicts the screen in one
    // of its two states — the same reason ReminderEditor's switch is called
    // "Reminder status" rather than "Reminder active".
    hasnt(src, "action-shaped zone name", /aria-label=\{"(Make|Change|Set|Switch) /,
      "name the state, not the transition — a name that describes the NEXT " +
      "state disagrees with the visible label in one of the two states");
  });

  it("the three PICK_CHIP lists say what tapping the id DOES", () => {
    // Found by reading computed names out of the running page — the only thing
    // that shows it, and the rule this whole ROADMAP entry keeps re-proving.
    //
    // Three lists render the same table ids as a bare `<button>7</button>`:
    // add-to-this-group, start-a-new-group, and add-to-a-prefer/avoid-list. The
    // "Ungrouped" row is ALWAYS rendered, so opening either picker puts two
    // buttons named "7" on screen **doing different things**. That is worse than
    // the ambiguity the other cases have — those repeat one action, these
    // collide across actions — and it is one click away.
    const chips = openingTagsOf(src, "button").filter((t) => /\bstyle=\{PICK_CHIP\}/.test(t));
    expect(chips.length, "there should still be three PICK_CHIP lists").toBe(3);
    const unnamed = chips.filter((t) => !/\baria-label=/.test(t));
    expect(unnamed, "a bare table id is the SAME name in all three lists, and " +
      "two of them can be on screen at once doing different things").toEqual([]);
    // The visible id leads (2.5.3), then what the tap does.
    for (const [what, re] of [
      ["add to group", /aria-label=\{id \+ " — add to the group " \+ group\.join\(" \+ "\)\}/],
      ["new group", /aria-label=\{id \+ " — start a new joined group"\}/],
      ["priorities add", /aria-label=\{id \+ " — add to " \+ label \+ rowIn\}/],
    ]) {
      has(src, "PICK_CHIP " + what, re,
        "the visible id leads and the ACTION follows — these three collide on " +
        "the id, so the action is the only thing that separates them");
    }
  });

  it("the two table multi-selects carry both a name AND a state", () => {
    // The last bare-id lists, both 13 buttons, both on screen at once — so
    // "Add a combo"'s 1A and "Require"'s 1A announced identically.
    //
    // "Add a combo" was missing its STATE too: selection is carried by an
    // accent fill and nothing else, so without `aria-pressed` you cannot tell
    // which tables you have picked, and picking tables IS the control.
    // v17.15.5 had already answered this for `Require` and stopped there.
    for (const [what, re] of [
      ["add-combo name", /aria-label=\{t\.id \+ " — include in the new combo"\}/],
      ["require name", /aria-label=\{id \+ " — require in cross-zone combos"\}/],
    ]) {
      has(src, what, re, "two 13-button lists share the ids and the screen");
    }
    // Not a magic count — the actual invariant. In this file a SELECTED control
    // is drawn as `on ? "var(--accent)" : …`, and that fill is the only signal
    // it has. So: every button that paints itself selected must SAY it is.
    // A count would have to be bumped whenever a segmented control is added,
    // which is the moment the guard stops meaning anything (there is already a
    // third `aria-pressed` here — v17.15.5's zone-order segments — and an
    // earlier draft of this test asserted 2 and failed on it).
    const selectors = openingTagsOf(src, "button")
      .filter((t) => /\bon \? "var\(--accent\)"/.test(t));
    expect(selectors.length, "the file should still have selection buttons")
      .toBeGreaterThanOrEqual(3);
    const mute = selectors.filter((t) => !/\baria-pressed=/.test(t));
    expect(mute, "a button that paints itself selected must SAY it is — the " +
      "accent fill is the only other signal, and colour alone is not a state")
      .toEqual([]);
  });

  it("a single-instance control is deliberately left static", () => {
    // Not everything in a `.map` repeats on screen. `editId` and
    // `pendingRemove` are single-valued, so Save name / Cancel / Remove anyway
    // are one-at-a-time and a literal is CORRECT there. Pinned so a later sweep
    // does not "finish the job" by adding names that say nothing.
    for (const [what, re] of [
      ["save name", /title="Save name"/],
      ["cancel rename", /title="Cancel"/],
    ]) {
      has(src, what, re,
        "gated on a single-valued state, so exactly one is ever on screen — " +
        "a static name is right, and adding an id would be noise");
    }
  });
});

describe("a banner row's controls carry their row (v17.15.6)", () => {
  // The ROADMAP entry v17.15.5 left behind, for the four notification-strip
  // banners. Each renders one dismiss ✕ per row with a single static
  // `aria-label` — one string in the source, and on a busy evening six
  // identically-named buttons on the page.
  //
  // These are the case with NO fallback, which is why they are decided the
  // opposite way to ListView's card actions two describes below: a `BannerRows`
  // row is a bare <div> with no role and no name, so a control inside it
  // inherits nothing. A List card is a named `role="listitem"`, and that is the
  // entire difference between the two decisions.
  const Late = read("components/LateBanner.jsx");
  const Overlap = read("components/OverlapBanner.jsx");
  const Wait = read("components/WaitAvailBanner.jsx");
  const Clash = read("components/ClashBanner.jsx");

  it("no banner names a control with a bare literal any more", () => {
    for (const [name, src] of [["LateBanner", Late], ["OverlapBanner", Overlap],
                               ["WaitAvailBanner", Wait], ["ClashBanner", Clash]]) {
      hasnt(src, name + " static dismiss", /aria-label="Dismiss this/,
        "one row per late booking / warning / waiting party, so a literal here " +
        "is not one name — it is N identical ones, and a banner row has no " +
        "named ancestor to fall back on the way a List card does");
    }
  });

  it("every banner's ✕ builds its name from the row", () => {
    for (const [what, src, re] of [
      ["late", Late, /aria-label=\{"Dismiss the running-late alert for " \+ who\}/],
      ["overlap", Overlap, /aria-label=\{"Dismiss the overstay warning for " \+ \(sb\.name/],
      ["wait", Wait, /aria-label=\{"Dismiss the table-free alert for " \+ who\}/],
      // The clash ✕ names the PAIR, matching clashRowId's own identity — the
      // dismissal Set is keyed by pair for exactly this reason, so a name
      // mentioning one booking would describe a different thing from the one
      // the button dismisses.
      ["clash", Clash, /aria-label=\{"Dismiss the double-booking warning for " \+ first\.name \+ " and " \+ later\.name\}/],
    ]) {
      has(src, what + " dismiss", re, "the row's subject must be in the name");
    }
  });

  it("a banner ACTION with visible text leads with it (WCAG 2.5.3)", () => {
    // The sweep does not stop at the ✕. `LateBanner`'s "No show" and
    // `WaitAvailBanner`'s "Book" are also one per row — but they HAVE words, so
    // they read as named and the fix is shaped differently: the visible label
    // must come FIRST and the party only disambiguate, or a voice-control user
    // can read the button and not say it. Same finding v17.15.4's own
    // /code-review made against "copy → all".
    has(Late, "No show", /aria-label=\{"No show \(" \+ who \+ "\)"\}/,
      "the visible text leads; the guest follows in parentheses");
    has(Wait, "Book", /aria-label=\{"Book \(" \+ who \+ ", " \+ w\.size \+ " pax\)"\}/,
      "the visible text leads; the party follows in parentheses");
    // Overlap's Reassign and Clash's Assign are deliberately untouched: their
    // visible text already contains a name, so it differs per row on its own.
    // Pinned so a later "consistency" pass does not add a redundant label that
    // would then be free to drift from the text beside it.
    for (const [what, src, re] of [
      ["Reassign", Overlap, /\{"Reassign " \+ w\.next\}<\/button>/],
      ["Assign", Clash, /\{"Assign " \+ later\.name\}<\/button>/],
    ]) {
      has(src, what + " names itself", re,
        "this button's VISIBLE text is already per-row, so it needs no label");
    }
  });

  it("the name comes from ONE expression, not a second copy", () => {
    // `who` exists so the sentence in the row and the name on the button cannot
    // disagree about what the party is called — including the "(no name)"
    // fallback, which a waitlist really does produce.
    for (const [what, src] of [["LateBanner", Late], ["WaitAvailBanner", Wait]]) {
      has(src, what + " who", /const who = \w+\.name \|\| "\(no name\)";/,
        "derive the display name once per row and read it everywhere in that row");
    }
    has(Wait, "the row sentence reads `who` too", /\{who \+ " · " \+ w\.size \+ " pax/,
      "the visible sentence must read the same expression the button's name does");
  });
});

describe("a reminder row's three controls share one name (v17.15.6)", () => {
  // v17.15.4 named the switch in this row and stopped there, so five reminders
  // still offered five buttons called "Edit" and five called "Delete" — and
  // Delete is the one control here where the wrong target cannot be undone.
  const src = read("components/Reminders.jsx");

  it("the reminder's display name is derived ONCE", () => {
    has(src, "rname", /const rname = String\(r\.text \|\| "\(no text\)"\)\.replace\(\/\\s\+\/g, " "\)\.trim\(\);/,
      "three controls in this row name the same reminder; a second copy of the " +
      "expression is a second answer, and the two would drift");
    expect(count(src, /String\(r\.text \|\| "\(no text\)"\)/g),
      "exactly one copy of the guarded expression").toBe(1);
  });

  it("all three controls read it", () => {
    for (const [what, re] of [
      ["toggle", /label=\{"Reminder: " \+ rname\}/],
      ["edit", /aria-label=\{"Edit \(" \+ rname \+ "\)"\}/],
      ["delete", /aria-label=\{"Delete \(" \+ rname \+ "\)"\}/],
    ]) {
      has(src, what, re, "rendered once per reminder, so it must say which one");
    }
  });

  it("Edit and Delete lead with their visible text (WCAG 2.5.3)", () => {
    // Both have words on them, so the name extends the visible label rather
    // than replacing it — "Delete the 09:00 prep reminder" would read as an
    // improvement and stop "click Delete" working.
    hasnt(src, "paraphrased action name", /aria-label=\{"(Remove|Modify|Change|Open) /,
      "the visible word leads and the reminder follows in parentheses");
  });
});

describe("the List card's actions stay named by their ancestor (v17.15.6)", () => {
  // A DECISION pin, not a fix — the only one in this file, and it is here
  // because the alternative is invisible: nothing about six statically-named
  // buttons says somebody weighed them and chose to leave them.
  //
  // Measured live on a 10-booking day: Assign x10, Delete x10, cancelled x10,
  // completed x9, seated x8. Sixty controls, five names.
  //
  // They are LEFT, and the whole argument is one structural fact: the card is a
  // `role="listitem"` carrying `describeBooking(b)`, so a screen-reader user
  // has already been told whose booking this is before reaching any button.
  // Renaming all sixty would repeat the guest on every control — measurably
  // more verbose in the app's most-used view, for exactly the users the change
  // would be for. No WCAG SC is failed either way (2.5.3 is satisfied: the
  // visible text IS the name), and voice control falls back to numbered
  // overlays when names collide.
  //
  // The contrast with the four banners two describes up is the entire rule, and
  // it is worth stating as one sentence: **a repeated control inside a NAMED
  // listitem may rely on that ancestor; a control in a bare row may not.**
  it("the card is what carries the booking's identity", () => {
    has(List, "card aria-label", /aria-label=\{describeBooking\(b\)\}/,
      "this is what the action buttons rely on instead of naming themselves — " +
      "remove it and sixty controls lose their context at once");
    has(List, "card is a listitem", /role="listitem"/,
      "the ancestor must be a real list item, or there is no context to inherit");
  });

  it("the action buttons are deliberately NOT renamed", () => {
    // If a later pass adds per-card labels, this fails and sends the reader to
    // the reasoning rather than letting a 60-control rename land unexamined.
    // Scoped to the action row's own shapes so an unrelated label elsewhere in
    // the file does not trip it.
    for (const [what, re] of [
      ["assign", /aria-label=\{"Assign[^}]*\+ b\.name/],
      ["delete", /aria-label=\{"Delete[^}]*\+ b\.name/],
      ["status", /aria-label=\{"?\{?s\}?[^}]*\+ b\.name/],
    ]) {
      hasnt(List, what, re,
        "DECIDED in v17.15.6, not overlooked: the card is a named listitem, so " +
        "these inherit the booking. Renaming all sixty repeats the guest on " +
        "every control and is measurably more verbose for the users it is for. " +
        "Change it only deliberately — and update this test's reasoning if so");
    }
  });
});

describe("the gate proves itself", () => {
  // tests/style-check.test.js's lesson, applied here: reading a checker does
  // not catch a blind spot. These run the helpers against strings that MUST
  // fail, so a future edit that turns `has()` into a no-op is visible.
  it("has() fails on a missing shape", () => {
    expect(() => has("<div />", "fixture", /<main\b/, "why")).toThrow();
  });

  it("hasnt() fails on a present shape", () => {
    expect(() => hasnt('<div aria-modal="true" />', "fixture", /aria-modal/, "why")).toThrow();
  });

  it("openingTag() reads past a `>` inside an expression container", () => {
    const src = 'x <main style={{a: n > 2 ? 1 : 0}} inert={m}>body</main>';
    expect(openingTag(src, "<main")).toBe('<main style={{a: n > 2 ? 1 : 0}} inert={m}>');
    expect(/\binert\b/.test(openingTag(src, "<main"))).toBe(true);
  });

  it("openingTag() throws rather than returning a truncated tag", () => {
    expect(() => openingTag("x <main style={{a: 1}", "<main")).toThrow();
  });

  // v17.15.4. The Toggle sweep is the first check here that walks a whole file
  // looking for MISSING attributes rather than asserting one present shape, so
  // it has two ways to rot into a tautology: find nothing, or read only part of
  // each tag. Both are exercised against input that must fail.
  it("openingTagsOf() finds EVERY tag, not just the first", () => {
    const src = '<Toggle label="a" /> x <Toggle on={b} /> y <Toggle label={c} />';
    const tags = openingTagsOf(src, "Toggle");
    expect(tags.length).toBe(3);
    expect(tags.filter((t) => !/\blabel=/.test(t)).length, "the middle one is unnamed").toBe(1);
  });

  it("openingTagsOf() reads a MULTI-LINE tag whole", () => {
    // The v17.15.2 miss, reproduced: a line-based grep for `<Toggle.*label`
    // calls this one unnamed. Two of the app's real call sites are this shape.
    const src = '<Toggle\n  label="Swap busy"\n  on={x}\n/>';
    const tags = openingTagsOf(src, "Toggle");
    expect(tags.length).toBe(1);
    expect(/\blabel=/.test(tags[0]), "the label is on line 2").toBe(true);
    expect(/<Toggle.*label=/.test(src), "a line-based grep would have missed it").toBe(false);
  });

  it("openingTagsOf() does not let <ToggleGroup answer for <Toggle", () => {
    expect(openingTagsOf('<ToggleGroup on={x} />', "Toggle").length).toBe(0);
  });

  it("count() distinguishes one heading from two", () => {
    expect(count("<h1>a</h1><h1>b</h1>", /<h1\b/g)).toBe(2);
    expect(count("<h2>a</h2>", /<h1\b/g)).toBe(0);
  });
});
