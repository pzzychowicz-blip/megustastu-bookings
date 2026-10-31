// src/components/TimelineZoomControls.jsx
// Follow and the zoom buttons (− · 1×/reset · +). v18.14.0 (H7): out of
// TimelineView, which draws them on its toolbar row. On a short screen App's
// header draws them instead (`toolbarFolded`, lib/compact-shell.js), and the two
// must not differ. Every value here is App's state already, so nothing moved
// but the markup.

import { BTN, T } from "../lib/constants";
import { mkBtn, Reveal } from "./atoms";

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
        minHeight: 36, padding: "4px 10px", fontSize: T.small,
        // v17.8.0: the idle fill was a hard-coded copy of --app-btn-grey's old
        // value, so the contrast pass fixed every other secondary button and
        // left this one at 1.82:1 — the lowest on the screen, on the control
        // that follows the clock during service. A literal duplicate of a token
        // is a token that cannot be fixed.
        background: followNow ? "var(--app-btn-dark)" : "var(--app-btn-grey)"
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
        style={mkBtn({ minHeight: 36, minWidth: 36, padding: "4px 10px", fontSize: T.title, background: BTN.nav })}
      >
        −
      </button>
      {/* v17.2.0 follow-up: the reset label grows "1x" → "Nx → 1x" when zoomed —
          the widening used to SNAP and shove the whole toolbar group sideways.
          The "Nx → " prefix now rides a horizontal Reveal (the start-time-chip
          pattern) so the button width eases in/out instead of jumping. The
          constant "1x" tail keeps the button's identity while collapsed. */}
      <button
        onClick={() => { setZoom(1); setFollowNow(false); }}
        aria-label={(zoom !== 1 ? zoom + "x → " : "") + "1x (reset zoom)"}
        className="mgt-hover-scale mgt-press"
        style={mkBtn({ minHeight: 36, padding: "4px 10px", fontSize: T.small, background: zoom === 1 ? "var(--btn-default)" : BTN.nav, display: "inline-flex", alignItems: "center", justifyContent: "center" })}
      >
        {/* NB the child must be NULL (not an empty span) at 1× — Reveal caches its
            last truthy children for the exit ease; an always-mounted span would
            overwrite that cache with empty text and the collapse would animate a
            blank box (the text snapping away instead of easing out). */}
        <Reveal horizontal show={zoom !== 1}>
          {zoom !== 1 ? <span style={{ whiteSpace: "pre" }}>{zoom + "x → "}</span> : null}
        </Reveal>
        1x
      </button>
      <button
        onClick={() => setZoom((z) => Math.min(maxZoom, z + 0.5))}
        aria-label="Zoom in"
        className="mgt-hover-scale mgt-press"
        style={mkBtn({ minHeight: 36, minWidth: 36, padding: "4px 10px", fontSize: T.title, background: BTN.nav })}
      >
        +
      </button>
    </div>
  );
}
