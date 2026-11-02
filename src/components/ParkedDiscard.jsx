// ── ParkedDiscard ────────────────────────────────────────────────────────────
// v18.14.0 (correction 22, Patryk): Discard is the one button in this strip that loses
// something for good, and it sat where the eye goes for the way forward. It takes two
// taps now, with the half-second wait every two-tap button has, and Retry takes the
// right. ARM_MS is the tag row's: nothing else here could disarm it.
// PARKED_ARMED_W: "Confirm — discard" at T.body with 12px of padding, 136.6 measured in
// the app's font, rounded up. The slot reserves it, as a waitlist row's ACTIONS_W does,
// so arming grows the button leftwards into space that was already empty.
import { useEffect, useRef, useState } from "react";
import { mkBtn } from "./atoms";
import { markArmed, armSettled } from "../lib/arm-guard";
import { BTN, T, H } from "../lib/constants";

const ARM_MS = 3000;
const PARKED_ARMED_W = 137;

export function ParkedDiscard({ onDiscard }) {
  const [armed, setArmed] = useState(false);
  const timer = useRef(null);
  useEffect(function () { return function () { clearTimeout(timer.current); }; }, []);
  return (
    <div style={{ minWidth: PARKED_ARMED_W, display: "flex", justifyContent: "flex-end" }}>
      <button
        className="mgt-hover-scale"
        style={mkBtn({ fontSize: T.body, background: BTN.quiet, minHeight: H.compact, padding: "4px 12px" })}
        onClick={function () {
          if (armed) {
            if (!armSettled()) return;
            clearTimeout(timer.current);
            onDiscard();
            return;
          }
          markArmed();
          setArmed(true);
          timer.current = setTimeout(function () { setArmed(false); }, ARM_MS);
        }}>{armed ? "Confirm — discard" : "Discard"}</button>
    </div>
  );
}
