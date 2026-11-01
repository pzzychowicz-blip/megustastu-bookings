// ── DurationReset ────────────────────────────────────────────────────────────
// v18.14.0 (correction 26, Patryk): back to the party size's own duration. It sat at
// the end of the stepper row, which has no room for it on a two-column form: "End:"
// wrapped onto two lines and the column grew 14 to 16px, moving Date, Time and whatever
// shared them, on the very tap that set a duration. It has a slot of its own now, on
// the field's label line, so nothing moves when it comes or goes, in either form. The
// row it is drawn in is `position: relative`, and Enter and Space reach it through
// stepPress, as they reach the steppers beside it.
import { Presence, mkBtn } from "./atoms";
import { stepPress } from "../lib/keyboard";
import { BTN, T, H } from "../lib/constants";

export function DurationReset({ show, onReset }) {
  return (
    <Presence show={show} inClass="mgt-appear" outClass="mgt-ghost-out" style={{ position: "absolute", right: 0, bottom: "100%" }}>
      <button
        className="mgt-hover-scale mgt-press"
        style={mkBtn({ fontSize: T.small, background: BTN.quiet, minHeight: H.chip, padding: "2px 10px" })}
        {...stepPress(onReset)}>Reset</button>
    </Presence>
  );
}
