// src/components/TablesPreview.jsx
//
// v18.14.0 (correction 29, Patryk): the booking form's Tables row, between its
// label and its Clear. The scan's answer is null for the length of a check
// (`useDeferredCompute`, "never show a stale answer"), so on every change of the
// time or the party the badges and "(auto)" blinked out for about 50ms and "was:"
// blinked in. The answer still leaves at once: it goes to opacity 0 in that frame.
// Its room stays, so nothing beside it moves and a phone's wrapped row keeps its
// line, and the next answer fades in where it stood. "was:" waits for the answer
// too, in `useLineBand`'s idiom: it stays as it was for the check, because a change
// of guests that keeps the same tables would otherwise open it and close it again.
//
// Direct children of the row, not a group: a phone wraps these one by one, and a
// `Reveal` around them would wrap them at every width of its ease. So when the
// answer changes size, "was:" beside it moves in that frame.
//
//   tables   what to show: the booking's, a pick or the scan's answer; null when
//            there is none yet
//   auto     they are the scan's, so they read "(auto)"
//   was      the sentence after them, or null
//   pending  a check is under way

import { useState } from "react";
import { S, T, M } from "../lib/constants";
import { RowSlot, TBadge } from "./atoms";

const ITALIC = { fontSize: T.small, color: S.muted, fontStyle: "italic" };

export function TablesPreview({ tables, auto, was, pending }) {
  const [held, setHeld] = useState(tables);
  if (tables && (!held || tables.join() !== held.join())) setHeld(tables);
  const [heldWas, setHeldWas] = useState(was);
  if (!pending && heldWas !== was) setHeldWas(was);
  const waiting = pending && !tables;
  const shown = tables || (waiting ? held : null);
  const wasShown = pending ? heldWas : was;
  const fade = { opacity: waiting ? 0 : 1, transition: waiting ? "none" : "opacity " + M.move };
  return (
    <>
      {(shown || []).map((id) => (
        <span key={id} className="mgt-appear" style={{ ...fade, display: "inline-flex" }}><TBadge id={id} /></span>
      ))}
      {shown && auto ? <span className="mgt-appear" style={{ ...ITALIC, ...fade }}>(auto)</span> : null}
      <RowSlot show={!!wasShown} gap={8}>
        {wasShown ? <span style={ITALIC}>{wasShown}</span> : null}
      </RowSlot>
    </>
  );
}
