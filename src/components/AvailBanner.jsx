// ── AvailBanner — "no tables available", with nearby alternatives ────────────
// Shown above the booking and walk-in forms when the requested slot cannot be
// filled. `warn` softens it from a refusal to an advisory.
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

import { R, T, FW } from "../lib/constants";
import { AlertPanel, AlertRow } from "./AlertPanel";
import { AlertIcon } from "./Icons";

export function AvailBanner({ msg, sugg, style, onTapTime, warn }) {
  const message = msg || "No tables available.";
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
              boxShadow: "var(--shadow-btn)"
            }}
          >
            {t}
          </span>
        ))}
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
