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

import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import { BLOCK_BG, BLOCK_INK, TBL, S, R, M, T, FW, H } from "../lib/constants";
import { isIn } from "../lib/booking-logic";
import { ChevronRightIcon } from "./Icons";

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
  const { leaving } = usePresence();
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
  useEffect(() => {
    restoreRef.current = document.activeElement;
    const el = dialogRef.current;
    if (el) {
      const titled = el.querySelector("#" + MODAL_TITLE_ID) || el.querySelector("h1,h2,h3");
      if (titled) {
        if (!titled.id) titled.id = MODAL_TITLE_ID + "-auto";
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
// v17.9.1 deliberately changed NO pill's colour. `Waitlist` and `Find a booking`
// are the two the rule would move to neutral, and both are arguably act
// surfaces (you book from the waitlist; you jump to a booking from search), so
// moving them is a judgement call worth making on its own rather than smuggling
// into an extraction commit. This atom exists so that judgement has one place to
// land instead of seven.
//
// `background` is required and has no default on purpose: a default would be a
// silent seventh answer to the question above.
// v17.9.1 (audit P1): this renders an <h2>, not a <div>. Before it, the app
// contained ZERO headings — measured in the live DOM — so a screen-reader user
// had no document structure to navigate at all, and every modal announced itself
// as an unlabelled group. Because all seven titles come through here, one element
// change fixes all seven. `MODAL_TITLE_ID` is the anchor Overlay points its
// `aria-labelledby` at; only one modal is ever mounted at a time (the Esc
// z-order chain guarantees it), so a constant id is safe and means the two sides
// cannot drift apart through a prop.
//
// It stays visually identical: the pill is the h2's own box, `margin: 0` kills
// the UA heading margin, and the size comes from T.title as before — a heading
// element is a semantic claim, not a typographic one.
export const MODAL_TITLE_ID = "mgt-modal-title";

export function ModalTitle({ background, marginBottom = 14, children }) {
  return (
    <div style={{ textAlign: "center", marginBottom }}>
      <h2 id={MODAL_TITLE_ID} style={{
        fontSize: T.title, fontWeight: FW.bold, color: "var(--text-on-accent)",
        display: "inline-block", padding: "8px 16px", borderRadius: R.pill,
        background, margin: 0,
        border: "1px solid rgba(255,255,255,0.2)",
        boxShadow: "var(--shadow-btn)"
      }}>{children}</h2>
    </div>
  );
}

// ── Form field (label + child input) ─────────────────────────────────────────
export function Fld({ label, req, style, children }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, ...(style || {}) }}>
      <label style={{ fontSize: T.body, color: "var(--text-secondary)", fontWeight: FW.semi, letterSpacing: "0.01em" }}>
        {label}
        {req ? <span style={{ color: "var(--text-required)" }}>*</span> : null}
      </label>
      {children}
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
      <button
        type="button"
        aria-expanded={open}
        onClick={() => { if (controlled) { if (onToggle) onToggle(!open); } else { setOpen((o) => !o); } }}
        style={{
          width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
          gap: 12, background: "transparent", border: "none", padding: 0, margin: 0,
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
            <span style={{ fontSize: T.body, fontWeight: FW.semi, color: "var(--text-muted)", whiteSpace: "nowrap" }}>{summary}</span>
          ) : null}
          <span style={{
            fontSize: T.title, fontWeight: FW.bold, color: "var(--text-muted)", lineHeight: 1,
            display: "inline-block", transform: open ? "rotate(90deg)" : "rotate(0deg)",
            transition: "transform " + M.tap
          }}><ChevronRightIcon size={14} /></span>
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
export function Reveal({ show, children, style, horizontal = false }) {
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
      const tv = setTimeout(function () { setRevealed(true); }, 320);
      return function () { cancelAnimationFrame(r1); cancelAnimationFrame(r2); clearTimeout(tv); };
    }
    setOpen(false);
    setRevealed(false);   // clip immediately so the collapse hides cleanly
    const t = setTimeout(function () { setMounted(false); }, 300);
    return function () { clearTimeout(t); };
  }, [show]);
  if (!mounted) return null;
  const track = horizontal
    // A Reveal changes GEOMETRY (the 0fr↔1fr track), so it takes M.shift; the
    // opacity riding along takes the same timing so the two land together.
    ? { display: "inline-grid", gridTemplateColumns: open ? "1fr" : "0fr", transition: "grid-template-columns " + M.shift + ", opacity " + M.shift }
    : { display: "grid", gridTemplateRows: open ? "1fr" : "0fr", transition: "grid-template-rows " + M.shift + ", opacity " + M.shift };
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
export function AutoHeight({ children, watch, style }) {
  const inner = useRef(null);
  const hRef = useRef(null);
  const [h, setH] = useState(null);             // null = auto until first measure
  const [animating, setAnimating] = useState(false);
  const measureRef = useRef(null);
  useLayoutEffect(function () {
    const el = inner.current;
    if (!el || typeof ResizeObserver === "undefined") return undefined;
    function measure() {
      const next = el.offsetHeight;
      const prev = hRef.current;
      // Only a CHANGE from a known prior height animates → clip while it runs.
      // The first (null→number) measure must not clip the rest state.
      if (prev != null && next !== prev) setAnimating(true);
      hRef.current = next;
      setH(next);
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
  useLayoutEffect(function () {
    if (watch === undefined) return;
    if (measureRef.current) measureRef.current();
  }, [watch]);
  return (
    <div
      onTransitionEnd={function (e) { if (e.propertyName === "height") setAnimating(false); }}
      style={{ height: h == null ? "auto" : h, overflow: animating ? "hidden" : "visible", transition: "height " + M.resize, ...(style || {}) }}
    >
      <div ref={inner}>{children}</div>
    </div>
  );
}

// ── SlideView — slide-in wrapper that only clips while animating (v15.8.0) ─────
// Wraps the main view (timeline/list). The parent keys it (`key={slideKey}`) so a
// nav/view change remounts it and replays the slide (`dir` = mgt-view-in-left /
// -right). `overflow:hidden` ONLY while the slide runs (so the 28px translateX
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
export function useFlip(deps) {
  const ref = useRef(null);
  const prevTops = useRef(new Map());
  useLayoutEffect(function () {
    const container = ref.current;
    if (!container) return;
    // v17.1.0: WAAPI animations aren't touched by the CSS reduced-motion
    // kill-switch — honor both the OS setting and the per-device "Reduce
    // animations" toggle (data-motion, index.html) here in JS. Computed ONCE
    // per flip pass (/code-review fix #4 — it was inside the per-element loop).
    const reduceMotion = document.documentElement.dataset.motion === "reduce"
      || (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    const next = new Map();
    container.querySelectorAll("[data-flip-id]").forEach(function (el) {
      const id = el.getAttribute("data-flip-id");
      const top = el.getBoundingClientRect().top;
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

export function Presence({ show, inClass, outClass, outMs = 200, children, style, tag = "div" }) {
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
    <Presence show={show} inClass="mgt-toast-in" outClass="mgt-toast-out" outMs={210} style={style}>
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
export function usePresence() { return useContext(PresenceContext); }

export function ModalPresence({ show, children, outMs = 200 }) {
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
      color: BLOCK_INK[status] || BLOCK_INK.confirmed, border: "1px solid rgba(255,255,255,0.2)",
      fontWeight: FW.semi, textTransform: "capitalize",
      display: "inline-block",
      boxShadow: "0 1px 3px rgba(0,0,0,0.1)"
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
      boxShadow: "0 1px 3px rgba(0,0,0,0.08)"
    }}>
      {id}
    </span>
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
export function Toggle({ on, onClick }) {
  return (
    <button
      onClick={onClick}
      className="mgt-hover-scale"
      style={{
        width: 48, height: 26,   /* @canvas */ borderRadius: R.pill,
        border: "1px solid var(--border-glass)",
        cursor: "pointer",
        background: on ? "var(--toggle-on)" : "var(--toggle-off)",
        position: "relative", flexShrink: 0,
        boxShadow: "inset 0 1px 2px rgba(0,0,0,0.08)",
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
        boxShadow: "0 1px 4px rgba(0,0,0,0.15)",
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
      boxShadow: "0 1px 2px rgba(0,0,0,0.06), inset 0 -1px 0 rgba(0,0,0,0.08)",
      minWidth: 22,
      textAlign: "center",
      boxSizing: "border-box",
      lineHeight: "16px"
    }}>
      {k}
    </span>
  );
}

// ── Availability banner shown above booking form ─────────────────────────────
// Renders "no tables available" or warning states with optional time
// suggestions (clickable chips) for nearby alternative slots.
export function AvailBanner({ msg, sugg, style, onTapTime, warn }) {
  const message = msg || "No tables available.";
  const bgClr = warn ? "var(--warn-bg)" : "var(--danger-bg)";
  const brdClr = warn ? "var(--warn-border)" : "var(--danger-border)";
  const txtClr = warn ? "var(--warn-text)" : "var(--danger-text)";
  const hasEarlier = sugg && sugg.earlier && sugg.earlier.length > 0;
  const hasLater = sugg && sugg.later && sugg.later.length > 0;
  const hasSugg = hasEarlier || hasLater;

  function renderChips(arr) {
    if (!onTapTime) return arr.join(", ");
    return (
      <span style={{ display: "inline-flex", gap: 4, flexWrap: "wrap" }}>
        {arr.map((t) => (
          <span
            key={t}
            className="mgt-hover-scale"
            onClick={() => onTapTime(t)}
            style={{
              cursor: "pointer", padding: "2px 8px", borderRadius: R.pill,
              fontWeight: FW.semi, fontSize: T.body,
              background: "var(--suggest-bg)",
              color: "var(--success-text)",
              border: "1px solid var(--suggest-border)",
              boxShadow: "0 1px 2px rgba(0,0,0,0.04)"
            }}
          >
            {t}
          </span>
        ))}
      </span>
    );
  }

  return (
    <div style={{
      padding: "10px 14px",
      borderRadius: R.card,
      border: "1px solid " + brdClr,
      background: bgClr,
      marginBottom: 14,
      fontSize: T.body,
      color: txtClr,
      boxShadow: "0 1px 4px rgba(0,0,0,0.04)",
      ...(style || {})
    }}>
      <div style={{ fontWeight: FW.bold, marginBottom: hasSugg ? 6 : 0 }}>{message}</div>
      {hasEarlier ? (
        <div style={{ marginBottom: hasLater ? 4 : 0 }}>
          <span style={{ fontWeight: FW.bold }}>Before: </span>
          {renderChips(sugg.earlier)}
        </div>
      ) : null}
      {hasLater ? (
        <div>
          <span style={{ fontWeight: FW.bold }}>After: </span>
          {renderChips(sugg.later)}
        </div>
      ) : null}
      {!hasSugg && sugg ? (
        <div style={{ marginTop: 4 }}>No availability found.</div>
      ) : null}
    </div>
  );
}
