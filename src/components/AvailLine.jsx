// ── AvailLine — "No table for 8 at 21:00", pinned above the form's buttons ───
// v18.14.0 (H3). A phone booking learned "no table" last: the answer was a
// banner in the form's body, at y=694 on a 570-tall screen, and with the
// keyboard up the body is about 211px, so the first thing to say so was Save.
// The form's FOOTER is the one part of the dialog that stays on screen, so the
// answer lives there, and so do the ways out: the four nearest times and, for a
// new booking, the waitlist. It replaces the body's list rather than repeating
// it (Patryk, 2026-10-31).
//
// A NAMED refusal (`warn`: a picked or kept table that Save will refuse) shows
// its own sentence, in the warning tone, with no times and no waitlist: its way
// out is the sentence's own.
//
// It is `InlineAlert`, the app's one-sentence notice, with the actions inside
// its sentence's slot. The form is 530px wide inside, and one row is the point:
// a line that wraps is 96px where this is 48, out of the 211px the keyboard
// leaves. So it goes without the notice's mark, whose job the tint and the words
// already do, and the chips and the button take narrower insets than they have
// elsewhere; their height stays the row's, for wet hands. The tint and tone are
// the pairing `tests/contrast.test.js` measures.
//
// v18.14.0 (correction 3, Patryk): where it wraps, on a phone, the buttons stretch
// edge to edge in equal cells, and Add to waitlist is a full-width bar under the
// times. Nothing measures for that: the sentence's growth outweighs the actions',
// so on one row it takes all the free space, and on a line of their own the actions
// take it. Only the pane's padding depends on the line, and that cannot be written
// as a width, because it follows from the sentence, so it is measured. The row can
// never talk itself out of a break: the wider padding is the wrapped row's.
//
// v18.14.0 (correction 10, Patryk): the band stays while a refused answer is being
// re-checked. It folded, because the answer is null until the new one lands (never a
// stale answer, his rule), and with the Optimiser on (today before 15:00, any future
// day) the check is long enough that the 56px band closed to 4px at 4× CPU and came
// back about 0.75s later, on every change of the time. `checking` is the same line
// with its answer hidden, which is what holds the height, to the pixel, wrapped or not,
// with the words over it. The answer is `inert` meanwhile: it may not be tapped, focused
// or read out. The words are for the eye and stay out of the live region, so a screen
// reader hears the new answer once and nothing in between. They wait out the answer's
// fade, and that wait is also the grace: a check that lands inside it never shows them.
// `leaving` is the fold once a table is found: the answer stays hidden and the words do
// not come, or they fade in on a band that is closing, after the check has ended.
//
// The chips keep the focus where it is: a tap on one with the keyboard up would
// otherwise move focus to the chip and drop the keyboard mid-sentence, and the
// chip can then unmount under that focus. Same `preventDefault` as the name
// field's suggestion rows. Enter and Space on a focused chip are unaffected,
// because a key press raises no mousedown.

import { useRef } from "react";
import { BLOCK_BG, FW, H, IC, M, R, SP, T } from "../lib/constants";
import { nearestTimes } from "../lib/booking-logic";
import { useSharesLine } from "../hooks/useSharesLine";
import { ALERT_TONES, InlineAlert, mkBtn } from "./atoms";
import { TimeChip } from "./AvailBanner";
import { WaitIcon } from "./Icons";

const LINE_TIMES = 4;
// The sentence's share of a row's free space against the actions' 1: all of it,
// to the pixel, and the actions keep the row to themselves once they wrap.
const SENTENCE_GROW = 9999;
const ANSWER_FADE = "opacity " + M.tap;
const WORDS_FADE_IN = "opacity " + M.move + " var(--t-tap)";

export function AvailLine({ text, warn, sugg, onTapTime, onAddToWaitlist, checking = false, leaving = false }) {
  const role = ALERT_TONES[warn ? "warn" : "danger"];
  const times = nearestTimes(sugg, LINE_TIMES);
  const rowRef = useRef(null);
  const sentenceRef = useRef(null);
  const actionsRef = useRef(null);
  const wrapped = useSharesLine(rowRef, sentenceRef, actionsRef).same === false;
  // A sentence alone keeps the notice's own padding; with 40px controls in the row,
  // they are its height. Wrapped, it takes the phone's padding, the same as the
  // country codes above it.
  const hasActions = times.length > 0 || !!onAddToWaitlist;
  const answerHidden = checking || leaving;
  const padding = !hasActions ? null : wrapped ? "10px 12px" : "4px 4px 4px 14px";
  return (
    <InlineAlert tone={role.tone} tint={role.tint} icon={null} style={{ marginBottom: SP.base, ...(padding ? { padding: padding } : null) }}>
      <span style={{ display: "grid" }}>
      <span ref={rowRef} inert={answerHidden} style={{ gridArea: "1 / 1", minWidth: 0, display: "flex", flexWrap: "wrap", alignItems: "center", gap: SP.snug, opacity: answerHidden ? 0 : 1, transition: ANSWER_FADE }}>
        <span ref={sentenceRef} style={{ flex: SENTENCE_GROW + " 1 auto", minWidth: 0, fontSize: T.lead }}>
          {text}
          {sugg && times.length === 0 ? <span style={{ fontWeight: FW.medium }}> No availability found.</span> : null}
        </span>
        <span ref={actionsRef} style={{ display: "flex", flexWrap: "wrap", flex: "1 1 auto", gap: SP.snug }}>
          {times.length > 0 ? (
            <span onMouseDown={function (e) { e.preventDefault(); }} style={{ display: "flex", flexWrap: "wrap", flex: "1 1 auto", gap: SP.tight }}>
              {times.map(function (t) {
                return <TimeChip key={t} time={t} onPick={onTapTime} style={{ flex: "1 1 0", minHeight: H.control, padding: "0 6px" }} />;
              })}
            </span>
          ) : null}
          {onAddToWaitlist ? (
            <button
              className="mgt-hover-scale"
              /* v17.10.0: pending amber — the waitlist's colour, see App's badge. */
              style={mkBtn({ flex: wrapped ? "1 1 100%" : "1 1 auto", fontSize: T.body, background: BLOCK_BG.pending, minHeight: H.control, padding: "8px", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6 })}
              onClick={function () { onAddToWaitlist(); }}><WaitIcon size={IC.control} />Add to waitlist</button>
          ) : null}
        </span>
      </span>
      <span aria-hidden="true" style={{ gridArea: "1 / 1", alignSelf: "center", display: "flex", alignItems: "center", gap: SP.base, fontSize: T.lead, fontWeight: FW.medium, pointerEvents: "none", opacity: checking ? 1 : 0, transition: checking ? WORDS_FADE_IN : ANSWER_FADE }}>
        <span className="mgt-dot-pulse" style={{ width: 7, height: 7, borderRadius: R.pill, background: "currentColor", flexShrink: 0, animationPlayState: checking ? "running" : "paused" }} />
        Checking the tables…
      </span>
      </span>
    </InlineAlert>
  );
}
