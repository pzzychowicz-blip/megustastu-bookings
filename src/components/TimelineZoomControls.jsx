// src/components/TimelineZoomControls.jsx
// Follow and the zoom buttons (− · 1×/reset · +). v18.14.0 (H7): out of
// TimelineView, which draws them on its toolbar row. On a short screen App's
// header draws them instead (`toolbarFolded`, lib/compact-shell.js), and the two
// must not differ. Every value here is App's state already, so nothing moved
// but the markup.

import { BTN, T } from "../lib/constants";
import { mkBtn, Reveal } from "./atoms";

// v18.14.0 (correction 26, Patryk): "Following" at T.small with 10px of padding, 75.2
// measured and rounded up. Follow keeps that width, or a tap on it moved the three zoom
// buttons beside it 17px, under the thumb that was about to use them.
const FOLLOW_W = 76;

export function TimelineZoomControls({ zoom, setZoom, maxZoom, followZoom, followNow, setFollowNow, isToday }) {
  // Follow-now button: today only. Phase C1 — label flips between "Following"
  // and "Follow" so screen-readers and quick visual scans get the state from
  // the text, not just the background colour. Background still flips for
  // emphasis.
  const followBtn = isToday ? (
    <button
      onClick={() => {
        if (!followNow) {
          setFollowNow(true);
          if (zoom < followZoom) setZoom(followZoom);
        } else {
          setFollowNow(false);
        }
      }}
      className="mgt-hover-scale mgt-press"
      style={mkBtn({
        minHeight: 36, minWidth: FOLLOW_W, padding: "4px 10px", fontSize: T.small,
        // v17.8.0: the idle fill was a hard-coded copy of --app-btn-grey's old
        // value, so the contrast pass fixed every other secondary button and
        // left this one at 1.82:1 — the lowest on the screen, on the control
        // that follows the clock during service. A literal duplicate of a token
        // is a token that cannot be fixed.
        background: followNow ? "var(--app-btn-dark)" : BTN.quiet
      })}
    >
      {followNow ? "Following" : "Follow"}
    </button>
  ) : null;

  // Zoom buttons (− · 1×/reset · +) — minimum 1× (i.e. never zoom below the
  // "fit one full service into the screen" baseline).
  return (
    <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
      {followBtn}
      {/* v18.2.0: named. Their whole content is a glyph, so they announced as
          "-" and "+" — the LayoutSettings `Stepper` defect (v17.15.5), and the
          same reasoning: a glyph doing an icon's job carries no word a voice-
          control user could say, so a name in words takes nothing away. The
          reset button below DOES carry text, so its name leads with it. */}
      <button
        onClick={() => setZoom((z) => Math.max(1, z - 0.5))}
        aria-label="Zoom out"
        className="mgt-hover-scale mgt-press"
        style={mkBtn({ minHeight: 36, minWidth: 36, padding: "4px 10px", fontSize: T.title, background: BTN.quiet })}
      >
        −
      </button>
      {/* v18.14.0 (L4): "Whole day" while zoomed, because that is what a press does.
          "1.5x → 1x" was the arithmetic of it, in the one place staff reach for
          when they have lost the evening off the side of the screen. At 1x the
          day is already whole, so it says the zoom instead.
          v17.2.0 follow-up: the label's change used to SNAP and shove the whole
          toolbar group sideways, so each word rides a horizontal Reveal (the
          start-time-chip pattern) and the button's width eases. */}
      <button
        onClick={() => { setZoom(1); setFollowNow(false); }}
        aria-label={(zoom !== 1 ? "Whole day" : "1x") + " (reset zoom)"}
        className="mgt-hover-scale mgt-press"
        style={mkBtn({ minHeight: 36, padding: "4px 10px", fontSize: T.small, background: BTN.quiet, display: "inline-flex", alignItems: "center", justifyContent: "center" })}
      >
        {/* NB each child must be NULL (not an empty span) when closed — Reveal
            caches its last truthy children for the exit ease; an always-mounted
            span would overwrite that cache with empty text and the collapse would
            animate a blank box (the text snapping away instead of easing out). */}
        <Reveal horizontal show={zoom !== 1}>
          {zoom !== 1 ? <span style={{ whiteSpace: "pre" }}>Whole day</span> : null}
        </Reveal>
        <Reveal horizontal show={zoom === 1}>
          {zoom === 1 ? <span style={{ whiteSpace: "pre" }}>1x</span> : null}
        </Reveal>
      </button>
      <button
        onClick={() => setZoom((z) => Math.min(maxZoom, z + 0.5))}
        aria-label="Zoom in"
        className="mgt-hover-scale mgt-press"
        style={mkBtn({ minHeight: 36, minWidth: 36, padding: "4px 10px", fontSize: T.title, background: BTN.quiet })}
      >
        +
      </button>
    </div>
  );
}
