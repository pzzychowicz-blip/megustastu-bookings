// ── AvailBanner — "no tables available", with nearby alternatives ────────────
// Shown in the walk-in form when the requested slot cannot be filled. `warn`
// softens it from a refusal to an advisory. The booking form's answer is
// `AvailLine` since v18.14.0, pinned above its buttons; `TimeChip` is both's.
//
// v17.15.2: MOVED OUT OF atoms.jsx, and rebuilt on `AlertPanel`.
//
// It was one of the eight panes wearing the shape DESIGN.md bans — a pale
// semantic fill plus a border in the matching hue plus bold text in a third
// shade — and it needed `AlertPanel` to stop. That is also why it could not
// stay in atoms.jsx: `AlertPanel` imports the strip's geometry and the strip
// imports atoms, so an atom reaching for it is a cycle. On the merits it was
// never an atom anyway — it holds clickable suggestion chips and branches four
// ways on what it was given, which is a component with internal complexity, the
// side of CLAUDE.md's hook-vs-component line that gets its own file.
//
// The message becomes the section TITLE and the alternatives become rows, which
// is what they are: the heading states the problem, the rows offer ways out.
//
// The time chips keep their fill deliberately. DESIGN.md's outline treatment is
// for a chip standing alone as a count or a disclosure; these are ACTIONS — tap
// one and the form's time changes — and they sit on a tinted pane where an
// outline chip in a third hue would read as decoration rather than as something
// to press.

import { R, T, FW, H } from "../lib/constants";
import { AlertPanel, AlertRow } from "./AlertPanel";
import { AlertIcon } from "./Icons";

// v18.8.0 phase 8: ONE time to pick, shared with the WhatsApp draft card, where
// a tap accepts the request at that time. It was a `<span>` with an onClick
// here, so no keyboard could reach a suggested time; a `<button>` is focusable,
// is pressed by Enter and Space, and wears the app's press dip. Its look is the
// span's, declaration for declaration: `index.css` gives a button the app's
// font, and every property a button's UA style would change is set inline.
// `style` (v18.14.0): the availability line sizes its chips to the row they sit
// in; everywhere else the chip is its own size. `label` (v18.14.0, H4): the same
// pill for another one-tap answer, Save's country codes, which pick a code by its
// `time` and read as its flag and number. v18.14.0 (L1): `H.chip` tall on its own,
// the WhatsApp "Accept at" row and Walk-in's banner. It was 21px, under WCAG 2.5.8's 24.
export function TimeChip({ time, label, onPick, style }) {
  return (
    <button
      type="button"
      className="mgt-hover-scale"
      onClick={() => onPick(time)}
      style={{
        cursor: "pointer", padding: "2px 8px", minHeight: H.chip, borderRadius: R.pill,
        fontWeight: FW.semi, fontSize: T.body,
        background: "var(--suggest-bg)",
        color: "var(--success-text)",
        border: "1px solid var(--suggest-border)",
        boxShadow: "var(--shadow-btn)",
        ...(style || null)
      }}
    >
      {label || time}
    </button>
  );
}

export function AvailBanner({ msg, sugg, style, onTapTime, warn }) {
  const message = msg || "No tables available.";
  const hasEarlier = sugg && sugg.earlier && sugg.earlier.length > 0;
  const hasLater = sugg && sugg.later && sugg.later.length > 0;
  const hasSugg = hasEarlier || hasLater;

  function renderChips(arr) {
    if (!onTapTime) return arr.join(", ");
    return (
      <span style={{ display: "inline-flex", gap: 4, flexWrap: "wrap" }}>
        {arr.map((t) => <TimeChip key={t} time={t} onPick={onTapTime} />)}
      </span>
    );
  }

  return (
    <AlertPanel
      role={warn ? "warn" : "danger"}
      icon={AlertIcon}
      title={message}
      style={{ marginBottom: 14, boxShadow: "var(--shadow-card)", ...(style || {}) }}
    >
      {hasEarlier ? (
        <AlertRow first>
          <span style={{ fontWeight: FW.bold }}>Before: </span>
          {renderChips(sugg.earlier)}
        </AlertRow>
      ) : null}
      {hasLater ? (
        <AlertRow first={!hasEarlier}>
          <span style={{ fontWeight: FW.bold }}>After: </span>
          {renderChips(sugg.later)}
        </AlertRow>
      ) : null}
      {!hasSugg && sugg ? (
        <AlertRow first>No availability found.</AlertRow>
      ) : null}
    </AlertPanel>
  );
}
