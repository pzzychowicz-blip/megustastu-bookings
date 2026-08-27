// src/components/atoms.jsx
// Tiny UI primitives used across the app: modal Overlay, form Fld, Section
// container, status / table / small badges, Toggle switch, Kbd keycap, and
// AvailBanner. Plus the style-builder helpers mkInp / mkBtn.
//
// Phase B1 (v15-refactor): extracted from App.jsx and converted RC() → JSX.
// First file in the codebase using JSX syntax — proves the build pipeline
// handles JSX cleanly. Subsequent component extractions (B2–B5) follow this
// same modern style: JSX, destructured props, const/spread.
//
// Behaviour, output markup, and all inline styles are byte-identical to the
// original `RC()` versions in v14.1. No visual or behavioural changes.

import { createContext, useContext, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { BLOCK_BG, BLOCK_INK, TBL, S, R, M, T, FW, H, IC, SP, RIM_SOLID, EXIT_MS, exitHold } from "../lib/constants";
import { isIn } from "../lib/booking-logic";
import { AlertIcon, ChevronRightIcon } from "./Icons";

// ── Style-builder helpers ─────────────────────────────────────────────────────
// Return inline-style objects. Used wherever an `<input>` or `<button>` needs
// the standard MGT look. mkBtn accepts an `extra` object that overrides any
// of the base properties.
export function mkInp() {
  return {
    width: "100%",
    boxSizing: "border-box",
    background: "var(--bg-input)",
    border: "1px solid var(--border-input)",
    borderRadius: R.pill,
    padding: "10px 12px",
    fontSize: T.title,
    color: S.text,
    fontWeight: FW.medium,
    boxShadow: "var(--shadow-input)"
  };
}

// Multi-line variant of mkInp (v17.7.0). All three textareas in the app — the
// booking form's Notes, the walk-in Notes, the reminder Text — were
// `{...mkInp(), resize:"vertical"}` copy-pasted; this is that shape, once.
//
// ── Why this does NOT inherit mkInp's pill (v17.7.1 fix) ─────────────────────
// A rounded box is NARROWEST at its top edge, which is exactly where a textarea
// starts its text — so a radius wider than the horizontal padding eats the
// first characters ("Allergies…" rendering as ".gies…").
//
// v17.7.0 shipped `alignContent:"center"` as the answer: centring pushes short
// content down to the box's widest point. That is a real improvement, but it is
// only half the fix, and the half it misses is the common one. alignContent has
// nothing to distribute once the content is TALLER than the box — and every
// caller is rows={2} with the text areas people actually write paragraphs in
// (allergies, special requests, a reminder note). The moment a third line is
// typed the field scrolls, the text returns to the top edge, and on --r-pill
// (999px, clamped by CSS to half the ~60px box = 30px) the corner reaches ~30px
// inward against 12px of padding — so the topmost VISIBLE line is sliced at
// every scroll position. The v17.7.0 note reasoned that a full field is
// "unaffected" by the centring; correct, but that is precisely when the
// clipping comes back.
//
// So the radius, not the alignment, has to be the guarantee: R.inset (10px)
// sits inside mkInp's 12px horizontal padding, so no line can be clipped at any
// height, scroll position, or resize the user drags it to. `alignContent` stays
// for the balance it gives short content — it is now a nicety, not a load-
// bearing fix, and a browser without it simply renders top-aligned.
export function mkArea() {
  return { ...mkInp(), borderRadius: R.inset, resize: "vertical", alignContent: "center" };
}

// v17.8.0 — the dropdown mkInp. A <select> renders its disclosure arrow inside
// its own padding box, hard against padding-right; mkInp's 12px puts that arrow
// deep inside a pill's right CAP, which on a 43px-tall control is 21.5px wide
// (`--r-pill` is 999px and CSS clamps a radius to half the box). The arrow then
// reads as shoved into the curve rather than sitting in the control.
// A single small glyph at the end of a pill wants padding ~= the radius, so it
// lands where the cap is flattest. Text doesn't need this — it spans enough
// height that the curve has already receded behind it, which is why the LEFT
// 12px looks right and the right 12px doesn't.
export function mkSel() {
  return { ...mkInp(), paddingRight: 18, cursor: "pointer" };
}

// v17.8.0 — the +/- stepper button. Settings.jsx (MINI_STEP_BTN) and
// LayoutSettings.jsx (STEP_BTN) held byte-identical private copies of this, and
// Settings held a THIRD at a larger size (HOUR_STEP_BTN). One definition, one
// size argument.
//
// `--shadow-btn`, not `--shadow-input`: this is a RAISED control. The two
// tokens exist precisely to separate a recessed field from a raised button
// (--shadow-input leads with an INSET highlight), and every stepper, segmented
// button and action button in Settings was wearing the field one — which is why
// Settings never quite looked like the rest of the app despite using the same
// palette. Inputs there keep --shadow-input, correctly.
export function mkStep(size) {
  const d = size || H.compact;
  return {
    background: "var(--bg-stepper)", border: "1px solid var(--border-soft)",
    borderRadius: R.pill, width: d, height: d,
    fontSize: d >= 36 ? T.display : T.title, fontWeight: FW.semi,
    color: "var(--text-primary)",
    display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
    boxShadow: "var(--shadow-btn)"
  };
}

export function mkBtn(extra) {
  return {
    border: "1px solid var(--border-glass)",
    background: "var(--btn-default)",
    borderRadius: R.pill,
    padding: "8px 14px",
    cursor: "pointer",
    fontSize: T.body,
    color: "var(--text-on-accent)",
    fontWeight: FW.semi,
    // The app-wide standard, and the reason H.control exists as a named step:
    // v17.8.0 deliberately left mkBtn at 40 while lifting decision surfaces to
    // 44, because 44 is a floor for controls where a mis-tap costs something,
    // not a target for every button.
    minHeight: H.control,
    boxShadow: "var(--shadow-btn)",
    letterSpacing: "0.01em",
    ...(extra || {})
  };
}

// ── mkSolidBtn — the SOLID decision button (v17.15.0) ────────────────────────
// `mkBtn`'s counterpart for a button that commits or destroys something: Save
// booking, Seat, Block, Delete, Discard, Cancel booking, No show, Confirm. It
// differs from `mkBtn` in four ways, and each one is a decision rather than
// drift — `RIM_SOLID` instead of the glass rim (the fill underneath is a
// saturated theme-invariant solid, so a translucent white rim reads as a smear
// on it), `--shadow-btn-solid` to match, `T.lead` and `H.touch` because 44 is
// the floor for a control where a mis-tap costs something (v17.8.0's sizing
// rule), and `background` REQUIRED with no default, for `ModalTitle`'s reason:
// a default would be a silent thirteenth answer to "what colour is this
// action".
//
// It existed as twelve hand-written copies before this. They agreed, which is
// exactly the condition that produces the next disagreement — and one had
// already appeared: the "No show" in the Cancel-booking overlay was
// `--app-warn-solid` (#9a3412) while the same button in ListView, LateBanner
// and QuickStatusPopup is `--btn-orange` (rgba(210,91,28,.8)). Two oranges for
// one action, told apart only by which surface you happened to be looking at.
//
// A disabled button passes its own fill, ink and shadow through `extra`; those
// are three coupled values (see index.html on --btn-disabled-ink) and belong at
// the call site that knows the condition, not in a boolean here.
export function mkSolidBtn(background, extra) {
  return {
    background,
    border: RIM_SOLID,
    borderRadius: R.pill,
    padding: "10px 18px",
    cursor: "pointer",
    fontSize: T.lead,
    fontWeight: FW.semi,
    color: "var(--text-on-accent)",
    minHeight: H.touch,
    boxShadow: "var(--shadow-btn-solid)",
    ...(extra || {})
  };
}

// ── Modal overlay (mobile = full-screen sheet, desktop = centered card) ──────
// Optional `footer` (v14.4.1): when provided, the action buttons render PINNED
// to the modal bottom while `children` scroll above them — so Save/Cancel stay
// reachable on tall forms without scrolling to the end. When omitted, behaviour
// is byte-identical to before (one scroll region), keeping back-compat for
// read-only popups (e.g. HistoryPopup) that have no action row.
// Blur budget unchanged: exactly one card renders (ternary), so a footer modal
// is still scrim blur(8px) + card blur(20px) = 2 instances (≤4 rule holds).
// ── Overlay's scroll port, exposed to its children (v17.9.1) ─────────────────
// A modal that REPLACES its whole body — Settings switching tabs — has to put the
// scroll back to the top in the same commit, or the browser does it later and
// worse. Measured: with the body scrolled 400px in a 2226px-tall tab, switching
// to a 321px tab left `scrollTop` pinned at 400 for ~270ms while the height
// animated, and then, the moment `scrollHeight` fell below `scrollTop +
// clientHeight`, the browser FORCE-CLAMPED it 400 → 281 → 34 → 0. That late,
// involuntary clamp is the "jump", and it is why it reads as arriving after the
// content rather than with it.
//
// It is a context rather than a prop because the tab lives in `SettingsContent`,
// which Overlay receives as opaque `children` — App could not pass it down
// without lifting that state. And it lives on Overlay rather than in the caller
// because Overlay has FOUR scroll ports (mobile/desktop × footer/no-footer) and
// is the only thing that knows which one is mounted. Same shape as
// PresenceContext above.
const OverlayScrollContext = createContext(null);
export function useOverlayScroll() { return useContext(OverlayScrollContext); }

export function Overlay({ onClose, children, footer }) {
  const mob = typeof window !== "undefined" && window.innerWidth < 600;
  const lockRef = useRef(false);
  const scrollRef = useRef(null);
  const scrollApi = useRef({ scrollToTop: function () { if (scrollRef.current) scrollRef.current.scrollTop = 0; } });
  // v15.8.0: symmetric open/close animation. `leaving` comes from the wrapping
  // <ModalPresence> (default false when there's no provider → enter-only). Mobile
  // = slide-up/down sheet; desktop = scrim fade + card fade/scale. See index.html.
  const { leaving } = useModalPresence();
  const sheetCls = leaving ? "mgt-sheet-out" : "mgt-sheet-in";
  const scrimCls = leaving ? "mgt-scrim-out" : "mgt-scrim-in";
  const cardCls = leaving ? "mgt-card-out" : "mgt-card-in";

  useEffect(() => {
    if (!mob) return;
    const orig = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    lockRef.current = true;
    return () => {
      document.body.style.overflow = orig;
      lockRef.current = false;
    };
  }, [mob]);

  // ── v17.9.1 (audit P1): dialog semantics ───────────────────────────────────
  // Measured in the live DOM before this: no role, no aria-modal, no accessible
  // name, and focus left sitting on <body> when a modal opened. A screen-reader
  // or keyboard user got no announcement that anything had happened and no way
  // into the dialog except tabbing through the entire page behind it.
  //
  // The accessible NAME is resolved from the DOM rather than from a prop. Seven
  // modals render a <ModalTitle> and five (the confirm dialogs, WeekView,
  // BlockModal, HistoryPopup) render their own heading text instead, and a prop
  // would have to be kept correct at twelve call sites forever. Pointing
  // `aria-labelledby` at an id that is not in the tree leaves the dialog
  // NAMELESS — strictly worse than not trying — so this checks. Falling back to
  // the first heading means the untitled modals get a real name too.
  const dialogRef = useRef(null);
  const restoreRef = useRef(null);
  const uid = useId();
  useEffect(() => {
    restoreRef.current = document.activeElement;
    const el = dialogRef.current;
    if (el) {
      // Scoped to THIS dialog's subtree, then given an id unique to this
      // instance — two modals can be mounted at once (a sub-modal opened from
      // the booking form), and a shared id makes both point at the first one in
      // document order. See MODAL_TITLE_ATTR.
      const titled = el.querySelector("[" + MODAL_TITLE_ATTR + "]") || el.querySelector("h1,h2,h3");
      if (titled) {
        if (!titled.id) titled.id = "mgt-modal-title-" + uid;
        el.setAttribute("aria-labelledby", titled.id);
      } else {
        el.setAttribute("aria-label", "Dialog");
      }
      // Focus the dialog itself, not its first control: focusing a text input
      // pops the keyboard on a tablet before the user has decided to type, and
      // focusing the first BUTTON puts a destructive action one Enter away.
      // tabIndex -1 makes the container focusable without adding a tab stop.
      el.focus({ preventScroll: true });
    }
    return () => {
      const prev = restoreRef.current;
      // Return focus to whatever opened the modal, so the keyboard lands back
      // where the user left it instead of at the top of the document.
      if (prev && typeof prev.focus === "function" && document.contains(prev)) {
        prev.focus({ preventScroll: true });
      }
    };
  }, []);

  // Focus trap. Esc is NOT handled here on purpose — useKeyboardShortcuts owns
  // the app-wide Escape z-order chain, and a second handler would race it.
  function onKeyDown(e) {
    if (e.key !== "Tab") return;
    const el = dialogRef.current;
    if (!el) return;
    const items = [...el.querySelectorAll(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )].filter((n) => n.offsetParent !== null || n === document.activeElement);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && (document.activeElement === first || document.activeElement === el)) {
      e.preventDefault(); last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault(); first.focus();
    }
  }

  // NB: no `ref` in here. The desktop no-footer card is BOTH the dialog and the
  // scroll port, and one node cannot take two refs — that branch assigns both
  // through a callback ref instead.
  const dialogProps = {
    role: "dialog",
    "aria-modal": "true",
    tabIndex: -1,
    onKeyDown,
  };

  // One provider around every branch, so a child can reset the scroll port that
  // actually mounted without knowing which of the four it is.
  const wrap = (el) => (
    <OverlayScrollContext.Provider value={scrollApi.current}>{el}</OverlayScrollContext.Provider>
  );

  if (mob) {
    // Footer pinned to the viewport bottom; body scrolls between top and footer.
    // (minHeight:0 lets the flex body actually scroll instead of growing the column.)
    if (footer) {
      return wrap(
        <div ref={dialogRef} {...dialogProps} className={sheetCls} style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, zIndex: 200, background: "var(--bg-sheet-mobile)", display: "flex", flexDirection: "column" }}>
          <div ref={scrollRef} style={{ flex: "1 1 auto", minHeight: 0, overflowY: "scroll", WebkitOverflowScrolling: "touch", padding: "16px 18px", paddingTop: "max(16px, env(safe-area-inset-top))", boxSizing: "border-box" }}>
            {children}
          </div>
          <div style={{ flexShrink: 0, padding: "12px 18px", paddingBottom: "max(12px, env(safe-area-inset-bottom))", borderTop: "1px solid var(--border-sheet)", background: "var(--bg-sheet-mobile)", boxSizing: "border-box" }}>
            {footer}
          </div>
        </div>
      );
    }
    return wrap(
      <div ref={dialogRef} {...dialogProps} className={sheetCls} style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, zIndex: 200 }}>
        <div ref={scrollRef} style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, background: "var(--bg-sheet-mobile)", overflowY: "scroll", WebkitOverflowScrolling: "touch" }}>
          <div style={{ minHeight: "100%", padding: "16px 18px", paddingTop: "max(16px, env(safe-area-inset-top))", paddingBottom: "max(80px, calc(40px + env(safe-area-inset-bottom)))",   /* @canvas */ boxSizing: "border-box" }}>
            {children}
          </div>
        </div>
      </div>
    );
  }

  // Desktop centered card. With a footer, the card is a flex column: body
  // scrolls (minHeight:0), footer stays pinned. Without, the whole card scrolls
  // (exactly as before).
  return wrap(
    <div
      className={scrimCls}
      style={{ position: "fixed", inset: 0, background: "var(--scrim)", backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200, padding: 12 }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      {footer ? (
        <div ref={dialogRef} {...dialogProps} className={cardCls} style={{ background: "var(--bg-sheet)", backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)", borderRadius: R.sheet, border: "1px solid var(--border-sheet)", width: "100%", maxWidth: 580, maxHeight: "90dvh", display: "flex", flexDirection: "column", overflow: "hidden", boxSizing: "border-box", boxShadow: "var(--shadow-sheet)" }}>
          <div ref={scrollRef} style={{ flex: "1 1 auto", minHeight: 0, overflowY: "auto", padding: "24px", boxSizing: "border-box" }}>
            {children}
          </div>
          <div style={{ flexShrink: 0, padding: "16px 24px", borderTop: "1px solid var(--border-sheet)", boxSizing: "border-box" }}>
            {footer}
          </div>
        </div>
      ) : (
        <div ref={(n) => { scrollRef.current = n; dialogRef.current = n; }} {...dialogProps} className={cardCls} style={{ background: "var(--bg-sheet)", backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)", borderRadius: R.sheet, border: "1px solid var(--border-sheet)", padding: "24px", width: "100%", maxWidth: 580, maxHeight: "90dvh", overflowY: "auto", boxSizing: "border-box", boxShadow: "var(--shadow-sheet)" }}>
          {children}
        </div>
      )}
    </div>
  );
}

// ── ModalTitle — the pill at the top of a modal (v17.9.1) ────────────────────
// Seven hand-written copies before this: BookingFormModal, WalkinForm,
// WaitlistPanel, SearchPanel, PrefPickerModal, ManualModal, and the Settings
// title in App.jsx. Identical in every respect except the fill — and except the
// SHADOW, where four had drifted onto `var(--shadow-btn)` and three still
// carried a hand-written `0 1px 4px rgba(0,0,0,0.1), inset 0 1px 1px
// rgba(255,255,255,0.15)`. Those three are exactly the v17.8.0 white-inset trap:
// a literal light-mode highlight shipped into dark, 3–8× too bright. They pass
// `check:style` because the fills under them (`--app-new`, `--accent`,
// `--app-btn-grey-strong`) are theme-invariant solids, so this was a
// consistency defect rather than a live bug — but it was three copies of a value
// nobody could retune, which is the condition that produces the live bug next
// time. One definition, one token.
//
// ── The colour rule (ROADMAP: "Modal title pills have no colour rule") ───────
// The convention, written down here because it had never been stated anywhere:
//
//   • A surface where you CREATE or ACT wears that action's own colour —
//     `--app-new` (new booking), `--app-walkin` (walk-in), `--accent` (assign
//     tables), `--btn-tables` (preferred tables). It is the same colour as the
//     button that opened it, so the modal reads as that button expanded.
//   • A surface where you CONFIGURE or READ wears a neutral —
//     `--app-btn-grey-strong` (Settings).
//
// The extraction commit deliberately changed no pill's colour; `Waitlist` and
// `Find a booking` were the two the rule left arguable (you book from the
// waitlist; you jump to a booking from search), and Patryk then decided both on
// their own merits: Waitlist wears the colour of the button that opens it, and
// Find a booking joined Settings on the neutral, because searching is a read.
// This atom exists so that judgement has one place to land instead of seven.
//
// v17.10.0: Waitlist's pill is now `BLOCK_BG.pending`, because the badge that
// opens it moved to the pending amber — the rule did the work, the pill just
// followed. Note what that means for anyone retuning this: the pill's colour is
// NOT an independent choice, so change the opener first.
//
// `background` is required and has no default on purpose: a default would be a
// silent seventh answer to the question above.
// v17.9.1 (audit P1): this renders an <h2>, not a <div>. Before it, the app
// contained ZERO headings — measured in the live DOM — so a screen-reader user
// had no document structure to navigate at all, and every modal announced itself
// as an unlabelled group. Because all seven titles come through here, one element
// change fixes all seven. `MODAL_TITLE_ATTR` is the anchor Overlay points its
// `aria-labelledby` at — an attribute rather than a shared id, because more than
// one modal CAN be mounted at once (see below); Overlay stamps a per-instance id
// on whatever it finds, so the two sides still cannot drift apart through a prop.
//
// It stays visually identical: the pill is the h2's own box, `margin: 0` kills
// the UA heading margin, and the size comes from T.title as before — a heading
// element is a semantic claim, not a typographic one.
// v17.9.1 review fix: this is a DATA ATTRIBUTE, not a fixed `id`. The original
// pinned a constant id on every title, on the stated grounds that "only one
// modal is ever mounted at a time" — which is false, and CLAUDE.md says so in
// as many words: sub-modals stay in the parent's render tree, so opening
// "Assign tables" from the booking form mounts TWO Overlays as siblings.
// Measured: two elements sharing `id="mgt-modal-title"`, and because
// `aria-labelledby` resolves through `getElementById` — document-wide, first
// match wins — BOTH dialogs announced "New booking", including the one actually
// in front and holding focus. Overlay assigns a unique id per instance instead.
export const MODAL_TITLE_ATTR = "data-mgt-modal-title";

export function ModalTitle({ background, marginBottom = 14, children }) {
  return (
    <div style={{ textAlign: "center", marginBottom }}>
      <h2 {...{ [MODAL_TITLE_ATTR]: "" }} style={{
        fontSize: T.title, fontWeight: FW.bold, color: "var(--text-on-accent)",
        display: "inline-block", padding: "8px 16px", borderRadius: R.pill,
        background, margin: 0,
        border: RIM_SOLID,
        boxShadow: "var(--shadow-btn)"
      }}>{children}</h2>
    </div>
  );
}

// ── InlineAlert — a notification-strip section, inside a modal (v17.15.0) ────
// The message a form shows when it refuses to save: "Text is required.", "No
// free table for that time", the walk-in capacity error. There were three
// copies, in ReminderEditor, BookingFormModal and WalkinForm, differing only in
// padding (8px 12px vs 10px 14px) and margin (12 vs 14) — and all three wore the
// one label shape DESIGN.md bans outright: a pale semantic fill PLUS a border in
// the matching hue PLUS bold text in a third shade of it, which encodes one
// signal three times and is the stock badge every framework ships.
//
// So it takes the shape the app already uses to report a fault: a notification
// strip section. Tinted pane, the section's mark in the tone colour, the message
// in the same tone. A fault now looks the same whether it fires on the main
// screen or inside a modal, which is the point — `AppBanners`' "Couldn't save"
// and a form's "Text is required" are the same kind of statement.
//
// It is a one-line section, with no separate title, on the strip's OWN
// precedent: with exactly one section live the strip drops the generic lid and
// takes that section's title rather than rendering a redundant sub-header. Here
// the message IS the section.
//
// ── Why the tone is --danger-text and not --status-offline ───────────────────
// The strip's danger sections use `tone: --status-offline`, and copying that
// verbatim was the obvious move. Measured first, per the rule that a colour
// token may only sit on a surface that flips with it — and --status-offline is
// #ff3b30 in BOTH themes while --danger-bg inverts:
//
//   --status-offline on --danger-bg   light 3.03:1   dark 4.31:1
//   --danger-text    on --danger-bg   light 7.09:1   dark 8.05:1
//
// 3.03:1 is below AA for body text, and a 42% swing between themes is exactly
// the light/dark inconsistency this version was asked to remove. --danger-text
// is the token that flips with the fill it sits on, so it is the one that can
// be trusted on it. `AppBanners` was corrected to match in the same commit —
// its two danger sections had been shipping the 3.03:1.
// ── v17.15.2: the four roles, named once ─────────────────────────────────────
// A semantic pane needs a tone AND a tint, and the pairing is the thing that
// goes wrong: `--status-offline` on `--danger-bg` looked entirely reasonable at
// three separate call sites and was below AA at all three, because one token
// flips with the theme and the other does not. Nothing in the repo can see a
// bad PAIRING — `check:style` reads literals, and the contrast registry's
// coverage guard matches token PREFIXES that these names miss.
//
// So a pane picks a ROLE and gets both halves, the move `CHIP_TONES` made for
// `OutlineChip` one release earlier and for the identical reason: two values
// that must agree are one decision, not two. Every pairing here is registered
// in `tests/contrast.test.js` and measured in both themes.
//
// `offline` is a role rather than a shade of warn because its fill is its own
// (`--app-offline-bg`, more saturated than the overlap wash) and the message
// is not a warning about the restaurant — it is a statement about this device.
export const ALERT_TONES = {
  danger:  { tone: "var(--danger-text)",      tint: "var(--danger-bg)" },
  warn:    { tone: "var(--warn-text)",        tint: "var(--warn-bg)" },
  success: { tone: "var(--success-text)",     tint: "var(--suggest-bg)" },
  offline: { tone: "var(--app-offline-text)", tint: "var(--app-offline-bg)" }
};

// Kept as its own export: `InlineAlert`'s default parameters read it, and a
// default is the one place a rename would fail silently rather than loudly.
export const ALERT_DANGER = ALERT_TONES.danger;

export function InlineAlert({ tone = ALERT_DANGER.tone, tint = ALERT_DANGER.tint, icon: Icon = AlertIcon, id, style, children }) {
  return (
    <div id={id} style={{
      // `alignItems: center` and the mark-to-text gap both mirror the strip's
      // own section header. The gap there is a module const of 9 that this file
      // cannot import without a cycle (NotificationStrip imports from atoms), so
      // it takes the nearest step on the shared scale — SP snaps DOWNWARD, and a
      // pixel between a modal alert and a strip section is not something anyone
      // can see, whereas an off-scale literal here is something check:style can.
      display: "flex", alignItems: "center", gap: SP.base,
      padding: "10px 14px", borderRadius: R.card,
      background: tint,
      ...(style || {})
    }}>
      {/* `icon={null}` renders the message alone. The explicit guard is also
          what makes the reference visible to eslint here: this config does not
          count a JSX element reference as a use, so a component read ONLY as
          `<Icon />` reports as unused (`SectionMark` in NotificationStrip
          passes only because its own `if (!Icon)` happens to read it). */}
      {Icon ? (
        <span aria-hidden="true" style={{ display: "inline-flex", alignItems: "center", color: tone, flexShrink: 0 }}>
          <Icon size={IC.control} />
        </span>
      ) : null}
      <span style={{ fontSize: T.body, fontWeight: FW.bold, color: tone, flex: 1, minWidth: 0 }}>{children}</span>
    </div>
  );
}

// ── Form field (label + child control) ───────────────────────────────────────
// v17.10.2: the label is ASSOCIATED with its control. Before this, Fld rendered
// a real <label> and then rendered the control as its SIBLING — which names
// nothing: implicit association requires the control INSIDE the label, and
// there was no htmlFor/id pair. Measured live, every one of the app's ~20 form
// fields was unnamed to a screen reader while looking perfectly labelled.
//
// TWO shapes, because half of these fields are not a single control:
//
//   • children as a FUNCTION — called with a generated id, which the call site
//     puts on its control. The label then carries `htmlFor`, so the control has
//     a real accessible name. Use this shape whenever there IS one control.
//
//   • children as ELEMENTS — a stepper pair, a chip row, a list of times. There
//     is no single control to point at, so the wrapper becomes a `role="group"`
//     named by the label instead. `htmlFor` is deliberately NOT rendered on this
//     path: a `for` aimed at an id that is not in the tree is a DANGLING
//     reference, which is strictly worse than not trying — the same reasoning
//     Overlay uses when it resolves its own `aria-labelledby` from the DOM
//     rather than taking it as a prop.
//
// The `*` is `aria-hidden` — a screen reader announcing "star" is noise. The
// CONTROL says it instead, via `aria-required`, and the ATOM applies that
// (/code-review): the first version left it to the call site, which is a
// convention with nothing enforcing it — one of twenty call sites actually did
// it, and the next `<Fld req>` would have got a visible `*` that is hidden from
// assistive technology and no programmatic signal at all, i.e. a field that
// reads as OPTIONAL. On the function path the atom already hands the call site
// an id, so it hands it the required flag the same way.
export function Fld({ label, req, invalid, describedBy, style, children }) {
  const id = useId();
  const single = typeof children === "function";
  // v17.12.0: the second callback argument grew from "the required attrs" into
  // "the state attrs" — same channel, so a call site that already spreads it
  // gets validity for free and one that doesn't is unaffected.
  //
  // `aria-describedby` is emitted ONLY alongside `aria-invalid`, and both only
  // when the caller says the field is invalid — which in practice means an
  // error message is on screen. That ordering is deliberate: a describedby
  // pointing at an id that is not in the tree is a dangling reference, the
  // exact failure Overlay refuses when it resolves its own name from the DOM
  // rather than taking a prop. Better no description than a broken one.
  //
  // /code-review: the state attrs are built for BOTH shapes. They used to be
  // built only when `single`, so passing `invalid` to a composite field — a
  // stepper pair, a chip row — was silently ignored: no error, no lint warning,
  // no test, and a field that reports VALID to assistive technology while a red
  // banner sits above it. Nothing does that today, which is exactly why it had
  // to be fixed now rather than found later. On the group path they land on the
  // wrapper, which is the element carrying the role and the name; both
  // attributes are global, so a `group` may hold them. `aria-required` stays
  // single-only on purpose — it belongs on a control, not on a wrapper, and the
  // composite path already signals required with the `*` in its label.
  const stateAttrs = (function () {
    const a = {};
    if (req && single) a["aria-required"] = "true";
    if (invalid) {
      a["aria-invalid"] = "true";
      if (describedBy) a["aria-describedby"] = describedBy;
    }
    return Object.keys(a).length ? a : null;
  })();
  const attrs = single ? stateAttrs : null;
  return (
    <div
      role={single ? undefined : "group"}
      aria-labelledby={single ? undefined : id + "-l"}
      {...(single ? null : stateAttrs)}
      style={{ display: "flex", flexDirection: "column", gap: 4, ...(style || {}) }}>
      <label
        id={id + "-l"}
        htmlFor={single ? id : undefined}
        style={{ fontSize: T.body, color: "var(--text-secondary)", fontWeight: FW.medium, letterSpacing: "0.01em" }}>
        {label}
        {req ? <span aria-hidden="true" style={{ color: "var(--text-required)" }}>*</span> : null}
      </label>
      {single ? children(id, attrs) : children}
    </div>
  );
}

// ── Card-like content section ─────────────────────────────────────────────────
export function Section({ style, children }) {
  return (
    <div style={{
      background: "var(--bg-soft)",
      border: "1px solid var(--border-soft)",
      borderRadius: R.card,
      padding: "14px",
      marginBottom: 14,
      boxShadow: "var(--shadow-soft)",
      ...(style || {})
    }}>
      {children}
    </div>
  );
}

// ── Collapsible disclosure section (card header + expandable body) ────────────
// v15.0.0: a Section whose title row is a tap-to-toggle disclosure. Used to keep
// long Settings lists (opening hours, tables) compact — collapsed by default
// (`defaultOpen`), with an optional one-line `summary` shown on the right while
// collapsed so the section stays scannable without expanding. The `subtitle` only
// shows when open, keeping the collapsed header a single line. Uncontrolled (owns
// its open state) — settings disclosures don't need the state lifted to a parent.
//
// v15.1.0: optional CONTROLLED mode — pass a boolean `open` + `onToggle` and the
// parent owns the state (the internal useState is ignored). Needed by ListView's
// "Completed & cancelled" disclosure, whose open state must live in BookingApp so
// the List keyboard model (↑/↓ over listDaySorted) can exclude hidden cards.
// Omitting `open` keeps the original uncontrolled behaviour (all Settings call
// sites unchanged).
//
// No `.mgt-hover-scale` on the header: it's a full-width row and the Settings
// modal card is overflow:hidden, so a 1.08 scale would clip at the card edge.
// The rotating chevron + pointer cursor carry the affordance instead.
export function Collapsible({ title, subtitle, summary, defaultOpen = false, open: openProp, onToggle, children, style }) {
  const [openState, setOpen] = useState(defaultOpen === true);
  const controlled = typeof openProp === "boolean";
  const open = controlled ? openProp : openState;
  return (
    <Section style={{ marginBottom: 18, ...(style || {}) }}>
      {/* v17.10.0: the header answers the pointer. It is a full-width row that
          holds a click target, which is exactly what `.mgt-ac-row` is for — the
          v17.9.1 rule that the 1.08 hover LIFT is for controls and a tint is for
          containers of controls (a lift here would also clip against the
          Settings card's overflow, which is what the note above already said).
          Every collapsible header gets it, List's "Completed & cancelled" fold
          and all ~15 Settings sections alike, so there is one kind of header.

          `--row-bg-hover` is `--bg-veil`, NOT the class default `--bg-ac-hover`:
          the header sits on Section's own `--bg-soft` fill, and an accent wash
          would recolour that rather than lighten it (the v17.9.1
          NotificationStrip finding — a class with a default is only
          half-configured until you check what the default means on your
          surface).

          The padding is what makes a tint read as a row rather than a hairline
          band; the matching negative margin is what keeps the RESTING layout
          identical, verified by measuring rather than by arithmetic — the gap
          between consecutive headers is 64.5px before and after.

          The width needs `calc(100% + 20px)` and it is worth knowing why, since
          the obvious two spellings both fail. `width:100%` with negative
          horizontal margins is OVER-CONSTRAINED, so the browser silently drops
          one side. Dropping `width` altogether looks safe — `display:flex` makes
          a block-level flex container, which normally fills its parent — but a
          <button> keeps its shrink-to-fit intrinsic sizing, so the header
          collapsed to its text and the chevron left the right edge (measured:
          213px instead of 337px). Explicit width + `border-box` means the CONTENT
          box is exactly the container width and the 10px bleed lands inside
          Section's 14px padding.

          And note there is NO inline `background` here any more. The header used
          to carry `background:"transparent"`, and an inline background beats a
          stylesheet `background-color` outright — so the hover rule matched, the
          element reported `:hover`, and the computed fill stayed
          `rgba(0,0,0,0)`. That is the exact trap this class's own comment in
          index.html warns about, walked into anyway; only measuring the computed
          style caught it. The resting fill comes through `--row-bg`, which is
          why the class takes it as a custom property in the first place. */}
      <button
        type="button"
        aria-expanded={open}
        className="mgt-ac-row"
        onClick={() => { if (controlled) { if (onToggle) onToggle(!open); } else { setOpen((o) => !o); } }}
        style={{
          "--row-bg": "transparent", "--row-bg-hover": "var(--bg-veil)",
          width: "calc(100% + 20px)", boxSizing: "border-box",
          display: "flex", alignItems: "center", justifyContent: "space-between",
          gap: 12, border: "none",
          padding: "6px 10px", margin: "-6px -10px", borderRadius: R.inset,
          cursor: "pointer", textAlign: "left", color: "inherit"
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: T.lead, fontWeight: FW.semi, color: "var(--text-primary)" }}>{title}</div>
          {open && subtitle ? (
            <div style={{ fontSize: T.body, fontWeight: FW.regular, color: "var(--text-faint)", marginTop: 2 }}>{subtitle}</div>
          ) : null}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          {!open && summary ? (
            <span style={{ fontSize: T.body, fontWeight: FW.medium, color: "var(--text-muted)", whiteSpace: "nowrap" }}>{summary}</span>
          ) : null}
          <span style={{
            fontSize: T.title, fontWeight: FW.bold, color: "var(--text-muted)", lineHeight: 1,
            display: "inline-block", transform: open ? "rotate(90deg)" : "rotate(0deg)",
            transition: "transform " + M.tap
          }}><ChevronRightIcon size={IC.control} /></span>
        </div>
      </button>
      {/* v15.8.0: body eases open/closed via Reveal (the Summary effect) — used
          by the ListView "Completed & cancelled" fold and every Settings section. */}
      <Reveal show={open}><div style={{ marginTop: 12 }}>{children}</div></Reveal>
    </Section>
  );
}

// ── Reveal — graceful height animation for show/hide content (v15.8.0) ────────
// Wraps in-flow content (banners, the Summary body) so it eases open/closed
// instead of snapping — the fix for the grid "jumping" when a notification
// appears/disappears. Pass `show` (boolean) + children; on show→false the
// content stays mounted, collapses (grid-template-rows 1fr→0fr + fade), then
// unmounts after the transition. The last truthy `children` is cached so the
// exit collapse still animates even when the source expression becomes null
// (e.g. the final reminder clears → reminderBanners → null).
//
// The `grid-template-rows: 0fr↔1fr` technique animates to natural height with
// NO magic max-height number (the reminders stack can be several rows tall).
// Needs iOS Safari 16+ — the app already relies on dvh/backdrop-filter, so
// that floor is safe. `overflow:hidden` + `minHeight:0` on the inner track let
// the row truly collapse to zero (incl. each child's own marginBottom).
// v16.1.1: optional `horizontal` — ease the occupied WIDTH (grid-template-columns
// 0fr↔1fr, inline-grid) instead of height. Used by the timeline start-time chip so
// the sibling booking-name span slides in lockstep with the chip instead of
// snapping when the chip appears/disappears. Default `false` = the original
// vertical behaviour, byte-for-byte for every existing caller.
// v17.15.0: both timeouts are DERIVED from the duration token, not typed. They
// were 320 and 300 against a 385ms transition, which happened to work; against
// the 520ms `--t-reveal` the unmount would have fired 220ms early and cut the
// collapse off halfway — the exit silently stops working, which is precisely
// the one-way-transition defect this version exists to remove. So the numbers
// follow the token, and the token is the only thing to change.
//
// The hold trails the transition slightly so the last frame is painted before
// the node goes, and it is also when it is safe to drop `overflow:hidden` and
// let a child's hover lift out of the box — the same moment, hence one number.
// `exitHold` lives in lib/constants.js beside the tokens it follows, so
// `useRevealRows` — which must outlast this same collapse — reads the same
// arithmetic instead of keeping its own copy (it kept 350, tuned for the old
// 385ms).
//
// ── `speed` (v17.15.0) ───────────────────────────────────────────────────────
// Which entry of the `M` scale this Reveal runs on. It exists because the
// --t-reveal token's own definition is "a DISCLOSURE opening or closing UNDER
// YOUR FINGER", and its list of examples ends with "the notification strip" —
// which contains TWO of these, only one of them under anybody's finger. The
// lid's body opening because you pressed the lid is the disclosure the token
// was written for. The PANE arriving because a booking has gone late, or
// because you pressed Next day, is not a disclosure at all; nobody pressed it.
// It is --t-move's own definition, "something arriving or leaving".
//
// Applied to both, the 520ms made the pane outlast the view's 240ms slide by
// more than double, so a date change slid horizontally for 240ms and then went
// on rising for another 280ms — one event, read as two.
//
// The duration and the hold MUST come from the same entry, which is why this
// takes a NAME and not a number: they are the two halves that were wrong in six
// places at the start of this version, and a caller able to pass one without the
// other is the same defect with a nicer spelling.
export function Reveal({ show, children, style, horizontal = false, speed = "reveal" }) {
  const last = useRef(null);
  if (children) last.current = children;
  const [mounted, setMounted] = useState(show === true);
  const [open, setOpen] = useState(show === true);
  // v15.8.0 cont.4: `revealed` lets the inner track go overflow:visible once OPEN and
  // settled, so a `.mgt-hover-scale` child (e.g. the List "Completed & cancelled"
  // finished cards) isn't clipped at rest. It stays hidden during the open/close
  // ease so the collapse still clips cleanly. (Timeout-driven — more robust across
  // browsers than transitionend on grid-template-rows.)
  const [revealed, setRevealed] = useState(show === true);
  useEffect(function () {
    if (show) {
      setMounted(true);
      // Double rAF: ensure the 0fr→1fr change lands in a separate frame from
      // the mount so the transition actually fires (a single frame can batch).
      let r2 = 0;
      const r1 = requestAnimationFrame(function () { r2 = requestAnimationFrame(function () { setOpen(true); }); });
      const tv = setTimeout(function () { setRevealed(true); }, exitHold(speed));
      return function () { cancelAnimationFrame(r1); cancelAnimationFrame(r2); clearTimeout(tv); };
    }
    setOpen(false);
    setRevealed(false);   // clip immediately so the collapse hides cleanly
    const t = setTimeout(function () { setMounted(false); }, exitHold(speed));
    return function () { clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `speed` is fixed per call site; re-running on it would restart a live transition
  }, [show]);
  if (!mounted) return null;
  // A Reveal is a DISCLOSURE by default, so it takes M.reveal rather than the
  // M.shift a bare geometry change would get — see the --t-reveal note in
  // index.html for why those are different questions, and `speed` above for the
  // one caller for which they are not. The opacity rides along on the same
  // timing so the two land together.
  const ease = M[speed];
  const track = horizontal
    ? { display: "inline-grid", gridTemplateColumns: open ? "1fr" : "0fr", transition: "grid-template-columns " + ease + ", opacity " + ease }
    : { display: "grid", gridTemplateRows: open ? "1fr" : "0fr", transition: "grid-template-rows " + ease + ", opacity " + ease };
  // v16.1.1: the horizontal inner track is a flex box (align-items:center) so the
  // revealed child is vertically centred without an inherited-font line-box strut
  // dropping it below its flex-row siblings (the timeline chip-vs-name misalign).
  const innerStyle = horizontal
    ? { overflow: revealed ? "visible" : "hidden", minWidth: 0, minHeight: 0, display: "flex", alignItems: "center" }
    : { overflow: revealed ? "visible" : "hidden", minHeight: 0 };
  return (
    <div style={{ ...track, opacity: open ? 1 : 0, ...(style || {}) }}>
      <div style={innerStyle}>{children || last.current}</div>
    </div>
  );
}

// ── AutoHeight — eases its height when its content changes (v15.8.0) ──────────
// For content-REPLACE cases (Settings tab swap, the ManualModal selection box,
// form sections) where there's no clean show/hide to drive a Reveal. A
// ResizeObserver measures the inner content and the wrapper transitions `height`
// to match. Because the Overlay card is auto-height, easing this inner height
// makes the whole modal card ease too — no card-height/scroll juggling needed.
// `overflow` is `visible` AT REST and `hidden` ONLY while the height transition runs
// (v15.8.0 cont.4 — supersedes cont.3's "always hidden"): clipping at rest cut off any
// `.mgt-hover-scale` lift inside (ReminderEditor edit sections, Settings bodies, the
// form/Manual/Walkin/Pref/Week bodies). Mirrors the SlideView pattern — the growth is
// still clipped + revealed by the eased height (no first-frame pop), but a settled
// AutoHeight no longer clips its children.
//
// v17.8.0: the easing is LINEAR, always — the `linear` opt-in prop is gone. It
// had been set on two call sites (the Week↔Month body and the reminder editor)
// and Patryk named the first of those as the one that felt right, which is the
// whole diagnosis: this component is never an object arriving, it is a box
// conforming to content that has already changed. There is no arrival to
// decelerate into, and ease-out's front-loading turned every modal resize into
// a lurch-then-crawl. See M.resize for the reasoning in full.

// ── clampRange (v17.10.0) ────────────────────────────────────────────────────
// The whole decision, as arithmetic.
//
// Both paths into an AutoHeight animation ask the same four questions, and both
// have now been got wrong once: v17.9.1 shipped the `watch` swap clamped and the
// observer unclamped, on the stated belief that the observer was already
// correct. Pulling the arithmetic out of the two effects is what lets it be
// pinned by a test (tests/auto-height.test.js) instead of by reading it.
//
//   from    where the box starts easing — its live height, pulled down to the
//           ceiling when it is already above it (that jump only removes scroll
//           range, which is why it is invisible)
//   to      where it eases to, likewise clamped
//   pending the TRUE height to retake once the visible part has run, or null
//           when nothing was clamped away
//   moves   is there anything to animate at all? false means the change is
//           entirely above the ceiling, i.e. off screen, and the box should
//           simply take the new height rather than clip the port to ease to it
//
// `cap == null` (no scroll port, or no height transition to drive the restore)
// disables all of it and gives back the plain measure this always was.
export function clampRange(live, next, cap) {
  const from = cap == null ? live : Math.min(live, cap);
  const to = cap == null ? next : Math.min(next, cap);
  return { from: from, to: to, pending: to === next ? null : next, moves: to !== from };
}

function scrollPort(box) {
  let p = box.parentElement;
  while (p && p !== document.body) {
    const oy = getComputedStyle(p).overflowY;
    if (oy === "auto" || oy === "scroll") return p;
    p = p.parentElement;
  }
  return null;
}

// ── The visible cap (v17.9.1) ────────────────────────────────────────────────
// Every height at or above the enclosing scroll port's own height LOOKS THE
// SAME: the port paints the same pixels either way and only the scroll range
// differs. So the visible half of a height change is the range [0, cap], and
// any part of an animation outside it is spent on something nobody can see.
// Returns null when the box has no scroll port to be clamped against.
function visibleCap(box) {
  const p = scrollPort(box);
  if (!p) return null;
  // v17.10.0: read the scroll offset BEFORE the probe. The cap is really "the
  // box height at which the box's bottom edge reaches the bottom of what is on
  // screen RIGHT NOW", and the port being scrolled by `st` pushes that down by
  // exactly `st`. v17.9.1 could assume zero because its only caller was a tab
  // swap, which resets the port's scroll in the click handler before the layout
  // effect runs; the observer path has no such guarantee, and without the term a
  // section collapsed after scrolling down would clamp BELOW the visible window
  // — shrinking the scroll range under the reader and yanking the page up.
  const st = p.scrollTop;
  // The port is ELASTIC — `flex: 1` inside a card that is `height: auto` under a
  // `maxHeight` — so its height RIGHT NOW understates what it could show: in a
  // short tab the card has shrunk to fit and the port with it, and reading it
  // there returns a cap equal to the current content, which clamps a GROW to
  // zero visible travel. So probe the real ceiling: ask for an absurd height and
  // read back what the port actually became. Transitions are suppressed across
  // the probe and the original height re-established before they are restored,
  // so nothing can start a transition from the probe value.
  //
  // Whatever ELSE lives in the port — siblings, its own padding — eats part of
  // the ceiling, and that is measured inside the probe too, not before it. This
  // runs from a layout effect, where the new content is already in the DOM and
  // the box is still `overflow: visible` at its old height: taller content
  // spills and lands in `scrollHeight`, so subtracting the box's height outside
  // the probe reports the CONTENT, not the siblings, and the cap comes out
  // negative on exactly the swap it exists for. At the probe height nothing
  // spills, so the remainder is the siblings and only the siblings.
  const PROBE = 100000;
  const t = box.style.transition, h0 = box.style.height;
  box.style.transition = "none";
  box.style.height = PROBE + "px";
  const max = p.clientHeight;
  const others = p.scrollHeight - PROBE;
  box.style.height = h0;
  void p.clientHeight;
  box.style.transition = t;
  const cap = max - others + st;
  return cap > 0 ? cap : null;
}

// Write a height with the transition suppressed, flushing a style recalc so the
// browser adopts it as the NEXT transition's start value. A React re-render
// cannot do this on its own: two style writes inside one task collapse into a
// single before/after pair, so the intermediate value never exists to start from.
function setHeightNow(box, px) {
  if (!box) return;
  const t = box.style.transition;
  box.style.transition = "none";
  box.style.height = px + "px";
  void box.offsetHeight;
  box.style.transition = t;
}

// Does `height` ACTUALLY transition on this element right now? (v17.9.1 review fix)
//
// The clamped-range animation above is only correct if something later restores
// the true height, and the only signal for that is `transitionend`. Under
// `prefers-reduced-motion` there is no such event to wait for: that rule
// rewrites `transition-property` to a list without `height` (`!important`), so
// the box never transitions, the event never fires, and the box would be
// stranded at the cap with `overflow: hidden` — measured: Settings' General tab
// pinned at 499px with 2226px of content and the port unable to scroll, i.e.
// most of that screen permanently unreachable. Two changes in one patch that
// were each fine alone. So: ask, and take the plain path when the answer is no.
//
// Note this is asked of the COMPUTED style, not of our own inline value — an
// `!important` rule elsewhere is exactly the case being detected.
function heightAnimates(box) {
  const cs = getComputedStyle(box);
  const props = cs.transitionProperty.split(",").map(function (s) { return s.trim(); });
  let i = props.indexOf("height");
  if (i < 0) i = props.indexOf("all");
  if (i < 0) return false;
  const durs = cs.transitionDuration.split(",").map(function (s) { return parseFloat(s) || 0; });
  if (!durs.length) return false;
  // A shorter duration list repeats over the property list (CSS value cycling).
  return durs[i % durs.length] > 0.02;
}

// How long a probed ceiling may be reused (/code-review fix). It mirrors
// `armSettle`'s window on purpose: one animation's length, so a cap can only
// ever be shared by fires belonging to the same content change.
const CAP_TTL = M.dur.shift + 120;

export function AutoHeight({ children, watch, style }) {
  const outer = useRef(null);
  const inner = useRef(null);
  const hRef = useRef(null);                    // last height COMMITTED to the box
  const cRef = useRef(null);                    // last CONTENT height seen
  const pendingRef = useRef(null);              // a real height to retake, invisibly
  const [h, setH] = useState(null);             // null = auto until first measure
  const [animating, setAnimating] = useState(false);
  const measureRef = useRef(null);
  const timerRef = useRef(null);
  const animRef = useRef(false);                // `animating`, readable mid-measure
  const capRef = useRef(null);                  // the visible ceiling for THIS run
  const capAtRef = useRef(0);                   // when it was last probed
  const toRef = useRef(null);                   // the height the box is easing TO

  // Settle: leave the clipped state and retake the true height. Reached by
  // `transitionend` normally, and by a timer when that event does not come —
  // which is not hypothetical (v17.9.1 review fix). `transitionend` does not
  // fire for a transition that never started, and it does not fire for one that
  // is CANCELLED — a second tab switch mid-animation cancels the first. Both
  // would leave `animating` true forever, which means `overflow: hidden` and,
  // with a pending height outstanding, a permanently clipped body. Idempotent,
  // so the two paths racing is harmless.
  function settle() {
    clearTimeout(timerRef.current);
    setAnimating(false);
    animRef.current = false;
    capRef.current = null;
    capAtRef.current = 0;                       // the next change re-probes
    const p = pendingRef.current;
    if (p == null) return;
    pendingRef.current = null;
    setHeightNow(outer.current, p);
    hRef.current = p;
    toRef.current = p;
    setH(p);
  }
  function armSettle() {
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(settle, M.dur.shift + 120);
  }
  useEffect(function () { return function () { clearTimeout(timerRef.current); }; }, []);
  useLayoutEffect(function () {
    const el = inner.current;
    if (!el || typeof ResizeObserver === "undefined") return undefined;
    function measure() {
      const box = outer.current;
      if (!box) return;
      const next = el.offsetHeight;
      const prev = cRef.current;
      // v17.9.1: compare against the last CONTENT height, not the last height
      // committed to the box — those stopped being the same thing once a `watch`
      // swap could commit a CLAMPED height. The observer fires a frame after the
      // swap, saw box 543 vs content 2226, called that a change and overwrote
      // the clamped target with the true one, undoing the whole animation.
      if (prev === next) return;
      cRef.current = next;
      // The first (null→number) measure adopts the height; it must not clip or
      // animate the rest state.
      if (prev == null) { hRef.current = next; toRef.current = next; setH(next); return; }

      // ── v17.10.0: the clamped range, on the OBSERVER path too ──────────────
      //
      // v17.9.1 added this to the `watch` swap and asserted that "callers that
      // only grow/shrink their own content are already served correctly by the
      // observer". That was wrong, and Settings → Layout is where it shows.
      // Opening `Combos` there, sampled per rAF (port 477px, card 552px under a
      // 739px max):
      //     0–166ms    card 552 → 739     the entire visible change
      //     166–866ms  card 739, box 535 → 2602, port CLIPPED
      // 165ms of travel inside an 864ms animation, and 700ms of it locking the
      // scroll port to animate pixels below the fold. That is the same defect
      // v17.9.1 diagnosed one level up, in the same component, for the same
      // reason — the range being animated is not the range anyone can see.
      //
      // The observer path is harder than the swap in one way: it fires EVERY
      // FRAME while the content is itself animating (a `Collapsible` opening is
      // a `Reveal` easing a grid track for 385ms), so a run has to survive being
      // re-measured ~23 times. It does, because the clamped target stops moving
      // as soon as the content passes the ceiling: the first fire starts the
      // transition, the rest only update the true height to restore afterwards.
      //
      // The 864ms also explains why the General tab "looks fine" and Layout does
      // not. General's content already overflows its port at rest, so the card
      // is pinned at its max and the whole height change is invisible — the
      // animation was equally wrong there, it just had nothing to spoil. Under
      // the clamp that case now takes the instant branch below and stops
      // clipping the port for 843ms after every toggle.
      // /code-review fix: the ceiling is probed at most ONCE per animation, not
      // once per frame. `visibleCap` writes `height: 100000px` and reads
      // `clientHeight` + `scrollHeight` back, i.e. two forced synchronous
      // layouts, and the no-movement branch below returns WITHOUT marking a run
      // — so `running` stayed false and every one of the ~23 observer fires
      // during a 385ms `Reveal` re-probed. That is ~46 forced layouts of a
      // 2700px modal subtree per Settings toggle, newly added by the commit
      // whose whole subject was making that toggle smoother. Settings → General
      // takes that branch on every fire, so it was the worst case.
      //
      // A timestamp rather than a flag, because the instant branch has no
      // natural end to reset on. The window is the animation's own length, so
      // the cap can only be reused by fires belonging to the same change; a
      // scroll or resize mid-animation makes it stale by at most one frame's
      // worth of clamp, which is invisible. `settle` zeroes it so the next real
      // change always measures fresh.
      const running = animRef.current;
      const now = typeof performance !== "undefined" ? performance.now() : Date.now();
      if (!running && now - capAtRef.current > CAP_TTL) {
        capRef.current = heightAnimates(box) ? visibleCap(box) : null;
        capAtRef.current = now;
      }
      const cap = capRef.current;
      const live = running ? null : box.getBoundingClientRect().height;
      const r = clampRange(live == null ? next : live, next, cap);
      const to = r.to;
      pendingRef.current = r.pending;

      if (running) {
        // Mid-flight. `pendingRef` above already carries the new true height, so
        // the only thing left is whether the VISIBLE target moved — it does not
        // while the content is still growing past the ceiling, and re-setting
        // the same value would leave the transition alone anyway. Re-arm the
        // fallback timer, since this run may now outlast its original window.
        if (to !== toRef.current) { toRef.current = to; hRef.current = to; setH(to); armSettle(); }
        return;
      }

      const from = r.from;
      if (!r.moves) {
        // Nothing on screen would move. Take the true height outright rather
        // than clipping the port for a third of a second to animate a change
        // that is entirely below the fold.
        pendingRef.current = null;
        setHeightNow(box, next);
        hRef.current = next;
        toRef.current = next;
        setH(next);
        return;
      }
      if (from !== live) setHeightNow(box, from);
      hRef.current = from;
      toRef.current = to;
      animRef.current = true;
      setAnimating(true);
      armSettle();
      setH(to);
    }
    measureRef.current = measure;
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return function () { ro.disconnect(); };
  }, []);
  // v17.9.1: `watch` — an identity to re-measure on, SYNCHRONOUSLY, before paint.
  //
  // ResizeObserver is one frame late by design: it fires after layout, so on a
  // whole-content SWAP (Settings' tab body, keyed on the tab id) the sequence was
  //   1. React commits the new tab's DOM
  //   2. the wrapper still has the OLD pinned height and, because `animating` is
  //      still false, `overflow: visible` — so the new content PAINTS IN FULL,
  //      overflowing the box
  //   3. only then does RO fire, clip to the old height, and transition
  // which reads as "the content appears, then the panel snaps and re-grows". The
  // Summary panel has no such artifact because `Reveal` animates a grid track
  // from 0 in the same commit — there is never an unclipped intermediate paint.
  //
  // A layout effect keyed on `watch` runs BEFORE the browser paints, so the clip
  // and the new height are committed in the same frame as the new content. The
  // height still transitions from the old value because that is what the element
  // was last painted at. Opt-in: callers that only grow/shrink their own content
  // are already served correctly by the observer.
  //
  // v17.9.1 — and it must animate only the range that is VISIBLE.
  //
  // The above fixed the first frame and the panel still read as "content
  // changes, long pause, window jumps". Sampled per rAF, Settings' General
  // (2226px) → Layout (321px) inside a 611px port:
  //     frame  0–21   card 774 (its 90dvh max), box 2226 → 572
  //     frame  22–24  card 774 → 720 → 638 → 556
  // The box eased perfectly the whole time. But the card is `height: auto`
  // clamped by `maxHeight`, so it cannot move until the box drops under the
  // port — 22 frames of nothing, then the entire 222px of visible travel
  // crammed into three. That IS the jump, and no curve or duration fixes it,
  // because 85% of the budget was being spent below the fold.
  //
  // So on a `watch` swap the animation is run over the CLAMPED range: jump
  // (invisibly) to `min(prev, cap)`, ease to `min(next, cap)`, then retake the
  // true height. Both jumps are unobservable by the definition of `cap` above —
  // they only restore scroll range. The card now eases across the full duration.
  //
  // A caller whose content never overflows its port is untouched: `prev` and
  // `next` are both ≤ cap, so `from`/`to` are `prev`/`next` and this is the
  // plain measure it always was (the Week/Month/Stats body, which is the
  // reference for how this is supposed to feel, takes that path).
  useLayoutEffect(function () {
    if (watch === undefined) return;
    const box = outer.current, el = inner.current;
    if (!box || !el || !measureRef.current) return;
    // The LIVE height, not hRef — an interrupted transition leaves the box
    // somewhere between the two, and that is where the next one starts.
    const live = hRef.current == null ? null : box.getBoundingClientRect().height;
    // Clamping is only safe while something restores the true height afterwards,
    // and that restore is driven by the transition. With no transition on
    // `height` (prefers-reduced-motion rewrites `transition-property`), take the
    // plain path — which is also the right behaviour there: instant.
    const cap = live == null || !heightAnimates(box) ? null : visibleCap(box);
    const next = el.offsetHeight;
    const r = clampRange(live, next, cap);
    const from = r.from, to = r.to;
    if (cap == null || !r.moves) {
      pendingRef.current = null;
      measureRef.current();
      return;
    }
    if (from !== live) setHeightNow(box, from);
    cRef.current = next;                        // the observer must not re-fire
    hRef.current = from;
    pendingRef.current = r.pending;
    // v17.10.0: the run bookkeeping the observer path reads. A late resize
    // inside the new tab (a font landing, an image sizing) must join THIS run
    // rather than start a second one on top of it.
    capRef.current = cap;
    capAtRef.current = typeof performance !== "undefined" ? performance.now() : Date.now();
    toRef.current = to;
    animRef.current = true;
    setAnimating(true);
    armSettle();
    setH(to);
  }, [watch]);
  return (
    <div
      ref={outer}
      onTransitionEnd={function (e) {
        // `transitionend` BUBBLES, and AutoHeight nests — Settings' General tab
        // holds five of these inside the tab-body one, and every child's height
        // transition was ending the parent's. Harmless while the handler only
        // un-clipped early; not harmless once it also retakes the real height,
        // which snapped the whole grow animation to its end value in 3 frames.
        if (e.target !== e.currentTarget || e.propertyName !== "height") return;
        // The visible part has run; `settle` takes the real height back so the
        // port can scroll again. The box already fills it, so no pixels change.
        settle();
      }}
      style={{ height: h == null ? "auto" : h, overflow: animating ? "hidden" : "visible", transition: "height " + M.resize, ...(style || {}) }}
    >
      <div ref={inner}>{children}</div>
    </div>
  );
}

// ── SlideView — slide-in wrapper that only clips while animating (v15.8.0) ─────
// Wraps the main view (timeline/list). The parent keys it (`key={slideKey}`) so a
// nav/view change remounts it and replays the entrance. `dir` is the ENTRANCE
// CLASS, not a direction: the T/L/P switch passes mgt-view-in-left / -right and
// travels 28px sideways, and since v17.15.0 a DATE change passes mgt-view-fade
// and travels nowhere, because a date change also moves the notification strip
// and two axes at once is a diagonal (see the keyframe's note in index.html).
// `overflow:hidden` ONLY while the entrance runs (so the 28px translateX
// doesn't cause a transient scrollbar), then `visible` so card hover-lifts aren't
// clipped at rest (the v15.8.0-cont.3 regression fix).
// `fill` (v17.5.0): in the fixed-shell layout (Settings → "Lock navigation",
// and Split View) this wrapper sits inside a flex COLUMN and must pass a
// definite height through to its child instead of collapsing to content
// height. Off by default, so the normal document-flow layout is unchanged.
export function SlideView({ dir, fill = false, children }) {
  const [animating, setAnimating] = useState(true);
  return (
    <div
      className={animating ? dir : undefined}
      onAnimationEnd={function () { setAnimating(false); }}
      style={fill
        ? { overflow: animating ? "hidden" : "visible", flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }
        : { overflow: animating ? "hidden" : "visible" }}
    >
      {children}
    </div>
  );
}

// ── useFlip — animate list reorder (FLIP) (v15.8.0) ───────────────────────────
// Returns a ref for the list container; on `deps` change it measures each
// `[data-flip-id]` child's top, and for any that moved, plays a Web-Animations
// translateY(from→0) — so a re-sorted card eases to its new spot instead of
// jumping. WAAPI leaves no inline styles, so it never fights `.mgt-hover-scale`.
//
// v17.15.0: offsets are measured relative to the CONTAINER, not the viewport.
// The two agree only while nothing above the container ever changes height, and
// something does: the notification strip. It appears and collapses on its own
// schedule, moves the whole grid vertically, and does NOT change `assignSig` —
// so this effect does not run, and `prevTops` keeps viewport coordinates from
// before the shift. The next UNRELATED edit then compares new tops against that
// stale baseline and animates every block by the strip's height, including the
// ones that did not move.
//
// Measured live on the timeline before the fix: collapse the strip (blocks move
// 391px → 286px, zero WAAPI calls, baseline now stale), then add a booking —
// and all FIVE blocks played `translateY(-46px) → 0` over 385ms, four of them
// having stayed on exactly the same table. Together with the blocks' own
// `left`/`width` CSS transition, which a real reshuffle does fire, that reads
// as the whole grid sliding in diagonally from a corner.
//
// Container-relative is not a workaround, it is what this hook actually means:
// it exists to animate a card or a block moving to a different ROW, which is a
// movement WITHIN the container. A whole-container move is the page scrolling
// or reflowing around it, which is not this hook's business and which the
// browser has already drawn correctly.
// ── reduceMotionOn — the WAAPI half of the motion kill-switch (v17.15.0) ────
// index.html's reduced-motion rules rewrite CSS `animation-duration` and
// `transition-duration`; NEITHER reaches a Web-Animations `animate()` call, so
// anything driven from JS has to ask in JS. Two things now do — `useFlip`'s
// list reorder and `NotificationStrip`'s date swap — which is one more than the
// number of copies of this expression that may exist.
//
// Both inputs matter and they are different intents: `data-motion="reduce"` is
// the per-device "Reduce animations" toggle, whose stated job is weak tablet
// hardware where the cheapest frame is no frame; `prefers-reduced-motion` is the
// OS-level request. Read at call time, never cached — the toggle can flip while
// the app is running.
export function reduceMotionOn() {
  return document.documentElement.dataset.motion === "reduce"
    || !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
}

export function useFlip(deps) {
  const ref = useRef(null);
  const prevTops = useRef(new Map());
  useLayoutEffect(function () {
    const container = ref.current;
    if (!container) return;
    const originTop = container.getBoundingClientRect().top;
    // v17.1.0: WAAPI animations aren't touched by the CSS reduced-motion
    // kill-switch — honor both the OS setting and the per-device "Reduce
    // animations" toggle (data-motion, index.html) here in JS. Computed ONCE
    // per flip pass (/code-review fix #4 — it was inside the per-element loop).
    // v17.15.0: the expression moved to `reduceMotionOn` above, because the
    // notification strip's swap needs the same answer and two copies of this
    // is how one of them silently stops asking.
    const reduceMotion = reduceMotionOn();
    const next = new Map();
    container.querySelectorAll("[data-flip-id]").forEach(function (el) {
      const id = el.getAttribute("data-flip-id");
      // Relative to the container — see the note above. A shift applied to the
      // container itself cancels out of every child's offset.
      const top = el.getBoundingClientRect().top - originTop;
      next.set(id, top);
      const prev = prevTops.current.get(id);
      if (!reduceMotion && prev != null && prev !== top && typeof el.animate === "function") {
        el.animate(
          [{ transform: "translateY(" + (prev - top) + "px)" }, { transform: "translateY(0)" }],
          // WAAPI cannot read a CSS var — see the note on M.dur/M.easeOut.
          { duration: M.dur.shift, easing: M.easeOut }
        );
      }
    });
    prevTops.current = next;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return ref;
}

// ── Presence — generic enter/exit animation primitive (v15.8.0) ───────────────
// The shared "delayed-unmount so the exit can animate" pattern (also used by
// Reveal). On `show`→false the node stays mounted, swaps to `outClass`, and
// unmounts after `outMs`; the last truthy children are cached so the
// out-animation still has content if the source expression goes null. Drives
// the status toasts (float in/out) and the slide-in/out buttons.
//   Presence({ show, inClass, outClass, outMs, children, style, tag })
// `usePresenceLifecycle` is the bare state machine, reused by ModalPresence
// (which provides a context instead of rendering a wrapper element).
// v17.15.0: `EXIT_MS` (lib/constants.js) is how long a leaving node stays
// mounted so its `*-out` keyframe can finish. It is the default for all three
// primitives here — see the note at its definition for what each of the four
// hand-typed numbers it replaces was getting wrong.
function usePresenceLifecycle(show, outMs) {
  const [render, setRender] = useState(show === true);
  const [leaving, setLeaving] = useState(false);
  useEffect(function () {
    if (show) { setRender(true); setLeaving(false); return undefined; }
    if (!render) return undefined;          // never shown → nothing to animate out
    setLeaving(true);
    const t = setTimeout(function () { setRender(false); setLeaving(false); }, outMs);
    return function () { clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `render` read as a closure snapshot
  }, [show]);
  return [render, leaving];
}

export function Presence({ show, inClass, outClass, outMs = EXIT_MS, children, style, tag = "div" }) {
  const last = useRef(null);
  if (children) last.current = children;
  const [render, leaving] = usePresenceLifecycle(show, outMs);
  if (!render) return null;
  const Tag = tag;
  return <Tag className={leaving ? outClass : inClass} style={style}>{children || last.current}</Tag>;
}

// Thin alias: a floating status toast = Presence with the toast keyframes.
// `style` lets the one-at-a-time slot pass `gridArea` so leaving + entering
// toasts overlap in the same grid cell (crossfade in place, never stack).
export function Toast({ show, children, style }) {
  return (
    <Presence show={show} inClass="mgt-toast-in" outClass="mgt-toast-out" style={style}>
      {children}
    </Presence>
  );
}

// ── ModalPresence — exit animation for Overlay-based modals (v15.8.0) ──────────
// Wraps a modal mount (`<ModalPresence show={cond}>{cond?<Modal/>:null}</…>`).
// Keeps the modal mounted for `outMs` after close and exposes `{leaving}` via
// PresenceContext — `Overlay` (and ReminderEditor) read it to swap their scrim/
// card/sheet to the *-out keyframe before unmounting. No wrapper element is
// rendered, so the modal's own fixed/overlay positioning is untouched.
export const PresenceContext = createContext({ leaving: false });
// v17.10.2: was `usePresence`, which collided with the Firebase device-presence
// hook in src/hooks/usePresence.js — two exported, importable functions of that
// name sharing nothing but a good word. Importing the wrong one gave a confusing
// RUNTIME failure, not a build error. This is the narrower, purely-local concern,
// so it takes the specific name, and it now pairs with its own provider.
export function useModalPresence() { return useContext(PresenceContext); }

export function ModalPresence({ show, children, outMs = EXIT_MS }) {
  const last = useRef(null);
  if (children) last.current = children;
  const [render, leaving] = usePresenceLifecycle(show, outMs);
  if (!render) return null;
  return (
    <PresenceContext.Provider value={{ leaving: leaving }}>
      {children || last.current}
    </PresenceContext.Provider>
  );
}

// ── Status badge (colour-coded by booking status) ────────────────────────────
export function SBadge({ status }) {
  return (
    <span style={{
      fontSize: T.body, padding: "4px 10px", borderRadius: R.pill,
      background: BLOCK_BG[status] || BLOCK_BG.confirmed,
      color: BLOCK_INK[status] || BLOCK_INK.confirmed, border: RIM_SOLID,
      fontWeight: FW.semi, textTransform: "capitalize",
      display: "inline-block",
      boxShadow: "var(--shadow-flat)"
    }}>
      {status}
    </span>
  );
}

// ── Table badge (id, indoor/outdoor coloured) ────────────────────────────────
export function TBadge({ id }) {
  const indoor = isIn(id);
  const t = indoor ? TBL.ind : TBL.out;
  return (
    <span style={{
      fontSize: T.body, padding: "4px 10px", borderRadius: R.pill,
      background: t.bg, color: t.text,
      border: "1px solid " + t.border,
      fontWeight: FW.semi, display: "inline-block",
      boxShadow: "var(--shadow-btn)"
    }}>
      {id}
    </span>
  );
}

// ── OutlineChip — the standalone count / disclosure chip (v17.15.0) ─────────
// DESIGN.md's OUTLINE treatment: no fill, a 2px border in the semantic hue,
// text in the same family. Customers' "3 visits" / "1 no-show", the booking
// form's Regular and No-show disclosures, the phone-autocomplete rows.
//
// It was the same component written twice — `chip()` in CustomersSettings and
// `chipBase` in BookingFormModal — one a <span>, the other a <button>, agreeing
// on 2px, the pill radius, the transparent fill and the bold text, and taking
// their colours from two unrelated token families: the BORDER from
// --suggest-border / --warn-border, the TEXT from --success-text / --warn-text.
// In light that renders a pale mint ring around dark forest text; in dark the
// two nearly converge. The chip looked like a different component depending on
// the theme, which is what was reported.
//
// So a tone here is ONE decision, not two: the border is the ink at half
// strength, derived with color-mix (see index.html). Pass `as="button"` for the
// clickable kind — a chip that is a disclosure is still the same chip, and
// DESIGN.md's note that clickable chips are "the documented exception" was
// about them keeping a FILL, which v17.8.0 already removed.
//
// The SOLID row tags in ListView (`manual`, `locked`, `no-show ×N`, `N min
// late`, `€N deposit`) are deliberately NOT this. They share a dense row with
// four other solid tags, and DESIGN.md's rule for choosing between the two
// treatments is "match whatever sits next to you".
export const CHIP_TONES = {
  success: { border: "var(--chip-success-border)", text: "var(--success-text)" },
  warn:    { border: "var(--chip-warn-border)",    text: "var(--warn-text)" },
  danger:  { border: "var(--chip-danger-border)",  text: "var(--danger-text)" },
  neutral: { border: "var(--chip-neutral-border)", text: "var(--text-secondary)" }
};

export function OutlineChip({ tone = "neutral", as = "span", size = "micro", style, children, ...rest }) {
  const c = CHIP_TONES[tone] || CHIP_TONES.neutral;
  const Tag = as;
  return (
    <Tag {...rest} style={{
      display: "inline-flex", alignItems: "center", gap: SP.tight,
      borderRadius: R.pill,
      padding: size === "micro" ? "2px 6px" : "2px 10px",
      fontSize: size === "micro" ? T.micro : T.small,
      fontWeight: FW.bold,
      background: "transparent",
      border: "2px solid " + c.border,
      color: c.text,
      flexShrink: 0,
      ...(as === "button" ? { cursor: "pointer" } : null),
      ...(style || {})
    }}>{children}</Tag>
  );
}

// ── Generic small chip / inline tag ──────────────────────────────────────────
export function SmallTag({ label, style }) {
  return (
    <span style={{
      fontSize: T.small, padding: "2px 8px", borderRadius: R.pill,
      // v17.9.0: inline-FLEX, so a label can carry an icon beside its text
      // (ListView's preferred-tables tag). A text-only label renders the same.
      fontWeight: FW.semi, display: "inline-flex", alignItems: "center", gap: 4,
      ...(style || {})
    }}>
      {label}
    </span>
  );
}

// ── iOS-style toggle switch ───────────────────────────────────────────────────
// v17.15.4: it is a SWITCH, and it has a NAME. Until now it was a bare
// <button> whose entire content was two coloured divs, so every on/off control
// in the app announced as "button" — no name, no state, no way to tell one from
// the next. Twenty call sites, all of Settings among them.
//
// It survived v17.12.0 ("reachable and announced") and v17.13.0's gate for the
// reason DESIGN.md's accessibility section gives about the whole class: this
// defect is invisible unless you go looking with the right tool. Both passes
// swept the surfaces that hold BOOKINGS — the card, the block, the table, the
// form field — and an atom that draws a 48×26 pill is not where you look for a
// missing name. `tests/a11y.test.js` now asserts both halves.
//
// `role="switch"` + `aria-checked` rather than `aria-pressed`: a switch is a
// state that stays, a toggle button is an action you took. Every one of these
// writes a setting. It stays a <button> element, so all of `src/index.css`'s
// `button` rules (user-select, the press dip, the transform transition) still
// apply unchanged — and there is no `[role="switch"]` rule in the stylesheet
// for it to newly subscribe to. That was checked BEFORE the role went on, per
// the rule v17.12.0 learned by teleporting the floor-plan tables.
//
// `label` is REQUIRED and names what the switch CONTROLS, never its state —
// the state is `aria-checked`'s job, and a name that flips with the value
// ("Active" / "Inactive") makes one control read as two. It has no default: a
// default here would be a silent twenty-first answer to a question every call
// site has to answer for itself, which is `ModalTitle`'s `background` lesson.
export function Toggle({ on, onClick, label }) {
  return (
    <button
      onClick={onClick}
      role="switch"
      aria-checked={!!on}
      aria-label={label}
      className="mgt-hover-scale"
      style={{
        width: 48, height: 26,   /* @canvas */ borderRadius: R.pill,
        border: "1px solid var(--border-glass)",
        cursor: "pointer",
        background: on ? "var(--toggle-on)" : "var(--toggle-off)",
        position: "relative", flexShrink: 0,
        boxShadow: "var(--shadow-well)",
        // v17.8.0 correction: M.move, not M.tap — and `transform` is in the list
        // because an INLINE transition beats .mgt-hover-scale's stylesheet one,
        // so omitting it left this button's hover lift with nothing to ease
        // (the same shorthand-collision class as the v17.8.0 hover/press fix).
        transition: "background-color " + M.move + ", transform " + M.tap
      }}
    >
      <div style={{
        position: "absolute",
        top: 3,
        left: on ? 24 : 3,
        width: 20, height: 20, borderRadius: R.pill,
        background: "var(--text-on-accent)",
        // v17.10.0: --shadow-flat, not --shadow-btn. The knob is white in BOTH
        // themes (--text-on-accent is declared once), so a white inset
        // highlight tuned for light and dimmed for dark would be wrong on it.
        boxShadow: "var(--shadow-flat)",
        // The knob crosses 21px. That is TRAVEL, not a control acknowledging a
        // tap, so it takes M.move — under M.tap it arrived before the eye could
        // follow it and the switch read as teleporting rather than sliding.
        transition: "left " + M.move
      }} />
    </button>
  );
}

// ── Keyboard keycap (for shortcuts cheatsheet) ───────────────────────────────
export function Kbd({ k }) {
  return (
    <span style={{
      display: "inline-block",
      padding: "2px 8px",
      borderRadius: 6,   /* @canvas */
      background: "var(--bg-kbd)",
      border: "1px solid var(--border-kbd)",
      fontFamily: "-apple-system, 'SF Mono', Menlo, monospace",
      fontSize: T.body,
      fontWeight: FW.semi,
      color: "var(--text-primary)",
      // v17.10.1: NOT --shadow-well. A drop PLUS a bottom inset is the physical
      // keycap look — the shading of a key you press, not a groove — and it is
      // the only one of its kind. Same category as this atom's monospace font:
      // a deliberate depiction, exempt from the scale rather than missing from it.
      boxShadow: "0 1px 2px rgba(0,0,0,0.06), inset 0 -1px 0 rgba(0,0,0,0.08)",   /* @shadow */
      minWidth: 22,
      textAlign: "center",
      boxSizing: "border-box",
      lineHeight: "16px"
    }}>
      {k}
    </span>
  );
}

