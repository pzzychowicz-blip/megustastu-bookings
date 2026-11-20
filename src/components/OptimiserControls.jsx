// src/components/OptimiserControls.jsx
// Reshuffle and the Optimiser toggle. v18.14.0 (H7): out of TimelineView, which
// draws them on its toolbar row. On a short screen they live in the opened
// Summary instead: in the evening the toolbar is 433px and the header has 352
// left, and this half is the half nobody needs mid-service, since the Optimiser
// switches itself off at the cutoff.
//
// v18.18.0 commit 16 (Patryk): Reshuffle shows on today and every later day, and
// the callers draw this only where App's `reshuffleOffer` says so (never on a
// past day). It used to slide in only while the switch was OFF, because ON
// re-seated the whole day on every save. Since v18.17.0 ON keeps the day
// (`applyOptKeep`), so a fresh pass needs the button whatever the switch says.
//   · Reshuffle comes FIRST, so it keeps one place on every day, and only the
//     toggle, today's alone, comes and goes beside it.
//   · Grey (`BTN.quiet`), and orange (`lit`) on today with the Optimiser off, or
//     while the "Tables could be reshuffled" check fires. Its description then
//     says why.

import { BTN, T } from "../lib/constants";
import { mkBtn } from "./atoms";
import { keyHint } from "../lib/shortcuts";

export function OptimiserControls({ isToday = true, lit = false, autoOptimizer, setAutoOptimizer, onReshuffle }) {
  // Lit by the check rather than by the switch: today with the Optimiser off is
  // always orange, and says nothing more.
  const suggested = lit && !(isToday && autoOptimizer === false);
  return (
    <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
      <button
        onClick={onReshuffle}
        title={"Re-seat " + (isToday ? "today's" : "this day's") + " unlocked bookings from scratch, once" + (suggested ? ": moving some would free up more capacity" : "") + keyHint("reshuffle")}
        className="mgt-hover-scale"
        style={mkBtn({ minHeight: 36, padding: "4px 12px", fontSize: T.small, background: lit ? BTN.orange : BTN.quiet })}
      >
        Reshuffle
      </button>
      {isToday ? (
        <button
          onClick={() => setAutoOptimizer(!autoOptimizer)}
          title={"Turn the Optimiser on or off for today: it re-seats unlocked bookings after each change" + keyHint("optimiser")}
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
      ) : null}
    </div>
  );
}
