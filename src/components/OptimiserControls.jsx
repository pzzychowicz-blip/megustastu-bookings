// src/components/OptimiserControls.jsx
// The Optimiser toggle and Reshuffle, today only (the caller's gate). v18.14.0
// (H7): out of TimelineView, which draws them on its toolbar row. On a short
// screen they live in the opened Summary instead: in the evening the toolbar is
// 433px and the header has 352 left, and this half is the half nobody needs
// mid-service, since the Optimiser switches itself off at the cutoff.

import { BTN, T } from "../lib/constants";
import { mkBtn, Presence } from "./atoms";

// Reshuffle is only shown when the optimizer is OFF — when ON it runs
// continuously, no manual trigger needed.
export function OptimiserControls({ autoOptimizer, setAutoOptimizer, onReshuffle }) {
  return (
    <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
      <button
        onClick={() => setAutoOptimizer(!autoOptimizer)}
        className="mgt-hover-scale"
        style={mkBtn({
          minHeight: 36, padding: "4px 12px", fontSize: T.small,
          // v17.8.0 review fix: the OFF fill was the SAME hard-coded grey the
          // Follow button above was just cured of, in the same commit, eight
          // lines apart — 1.94:1 white-on-grey in light mode. Fixing one copy of
          // a literal does not fix the literal; grep the VALUE.
          background: autoOptimizer ? "var(--app-walkin)" : BTN.quiet
        })}
      >
        {"Optimiser: " + (autoOptimizer ? "ON" : "OFF")}
      </button>
      {/* v15.8.0: slides in L→R when Optimizer is toggled OFF, slides out →L when ON. */}
      <Presence show={!autoOptimizer} inClass="mgt-slide-in" outClass="mgt-slide-out" tag="span">
        <button
          onClick={onReshuffle}
          className="mgt-hover-scale"
          style={mkBtn({ minHeight: 36, padding: "4px 12px", fontSize: T.small, background: BTN.orange })}
        >
          Reshuffle
        </button>
      </Presence>
    </div>
  );
}
