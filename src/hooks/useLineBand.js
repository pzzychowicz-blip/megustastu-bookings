// src/hooks/useLineBand.js
//
// v18.14.0 (correction 10, Patryk; a hook since correction 16, when the walk-in took
// the line too): what the availability line draws while a refused answer is
// re-checked. `useDeferredCompute` reads null for the length of a check, so the line
// would fold on every change of the time and ease back with the same answer. It keeps
// its band instead (`AvailLine`, whose header says why).
//
//   const line = useLineBand(refused, pending);
//   refused        the scan's refusal; null for "a table fits" and during a check
//   pending        a check is under way
//   line.shown     the band is up: a refusal, or one being re-checked
//   line.checking  it is up for a re-check, so `AvailLine` shows its words
//   line.answer    what to draw: the live refusal or the last one, which holds the
//                  band for a re-check and for its fold once a table is found
//   line.words     the sentence that goes with `answer` (v18.19.0): `words` as the
//                  caller builds it from the live draft, held with the refusal it
//                  described. It was rebuilt from the draft during a check, so the
//                  line read "No table for 12 at 20:45" beside 21:15's times before
//                  20:45 had been asked about (measured on the tablet).
//
// `open` says a refusal was still the answer when the check began, so a first check
// opens nothing. Both are set during render, React's own pattern for a value derived
// from the last one, so the band is never a commit behind: it holds from the render
// that starts the check.

import { useState } from "react";

export function useLineBand(refused, pending, words) {
  const [held, setHeld] = useState(null);
  const [heldWords, setHeldWords] = useState("");
  const [open, setOpen] = useState(false);
  if (!pending) {
    if (open !== !!refused) setOpen(!!refused);
    if (refused && held !== refused) setHeld(refused);
    if (refused && heldWords !== words) setHeldWords(words);
  }
  const checking = pending && open;
  return { shown: !!refused || checking, checking, answer: refused || held, words: refused ? words : heldWords };
}
