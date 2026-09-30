// v18.3.2 — the autocomplete rows' touch handling (`src/hooks/useAcRow.js`).
//
// A tap picks the row and closes the list, so the mousedown / mouseup / click
// the browser synthesizes afterwards used to land on whatever the list had
// been covering — measured on a touch tablet viewport, the booking form's
// country list sits over the Time input (a ghost click there opens Android's
// time picker) and the name list over Seating preference. The fix cancels the
// TAP's touchend, which suppresses those events; a swipe must stay untouched,
// because the list scrolls.
import { describe, it, expect } from "vitest";
import { acRowHandlersFor } from "../src/hooks/useAcRow.js";

function rig() {
  const ref = { current: { x: 0, y: 0, scroll: false, ts: 0 } };
  const picks = [];
  const h = acRowHandlersFor(ref, function () { picks.push(1); });
  return { ref, picks, h };
}
function touchEvent(x, y) { return { touches: [{ clientX: x, clientY: y }] }; }
function endEvent(cancelable) {
  const e = { cancelable: cancelable, prevented: 0 };
  e.preventDefault = function () { e.prevented += 1; };
  return e;
}

describe("useAcRow's touch handling", () => {
  it("a tap picks the row AND cancels its touchend, so no ghost click follows", () => {
    const { picks, h } = rig();
    h.onTouchStart(touchEvent(100, 200));
    h.onTouchMove(touchEvent(104, 203)); // inside the 12px slop
    const e = endEvent(true);
    h.onTouchEnd(e);
    expect(picks.length).toBe(1);
    expect(e.prevented).toBe(1);
  });

  it("a swipe scrolls: it picks nothing and cancels nothing", () => {
    const { picks, h } = rig();
    h.onTouchStart(touchEvent(100, 200));
    h.onTouchMove(touchEvent(100, 150));
    const e = endEvent(true);
    h.onTouchEnd(e);
    expect(picks.length).toBe(0);
    expect(e.prevented).toBe(0);
  });

  it("a touchend the browser will not let us cancel still picks, without calling preventDefault", () => {
    // `cancelable` is false once the browser has taken the touch for a
    // scroll; preventDefault there only logs an intervention warning.
    const { picks, h } = rig();
    h.onTouchStart(touchEvent(100, 200));
    const e = endEvent(false);
    h.onTouchEnd(e);
    expect(picks.length).toBe(1);
    expect(e.prevented).toBe(0);
  });

  it("the mousedown synthesized right after a touch is ignored; a real one picks", () => {
    const { ref, picks, h } = rig();
    h.onTouchStart(touchEvent(100, 200));
    h.onTouchEnd(endEvent(true));
    const ghost = endEvent(true);
    h.onMouseDown(ghost);
    expect(picks.length).toBe(1); // the tap's pick only
    expect(ghost.prevented).toBe(0);

    ref.current.ts = Date.now() - 1000; // long after any touch
    const real = endEvent(true);
    h.onMouseDown(real);
    expect(picks.length).toBe(2);
    expect(real.prevented).toBe(1); // keeps the input focused, as on desktop
  });
});
