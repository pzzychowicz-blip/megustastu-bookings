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
// The chips keep the focus where it is: a tap on one with the keyboard up would
// otherwise move focus to the chip and drop the keyboard mid-sentence, and the
// chip can then unmount under that focus. Same `preventDefault` as the name
// field's suggestion rows. Enter and Space on a focused chip are unaffected,
// because a key press raises no mousedown.

import { useRef } from "react";
import { BLOCK_BG, FW, H, IC, SP, T } from "../lib/constants";
import { nearestTimes } from "../lib/booking-logic";
import { useSharesLine } from "../hooks/useSharesLine";
import { ALERT_TONES, InlineAlert, mkBtn } from "./atoms";
import { TimeChip } from "./AvailBanner";
import { WaitIcon } from "./Icons";

const LINE_TIMES = 4;
// The sentence's share of a row's free space against the actions' 1: all of it,
// to the pixel, and the actions keep the row to themselves once they wrap.
const SENTENCE_GROW = 9999;

export function AvailLine({ text, warn, sugg, onTapTime, onAddToWaitlist }) {
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
  const padding = !hasActions ? null : wrapped ? "10px 12px" : "4px 4px 4px 14px";
  return (
    <InlineAlert tone={role.tone} tint={role.tint} icon={null} style={{ marginBottom: SP.base, ...(padding ? { padding: padding } : null) }}>
      <span ref={rowRef} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: SP.snug }}>
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
    </InlineAlert>
  );
}
