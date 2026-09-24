// src/components/PhoneField.jsx
//
// v18.1.0 — the phone field, split: a country-code picker and the number.
//
// It is CONTROLLED by the one string the app has always stored ("+34 600 123
// 456"), and `onChange` hands one string back — see `lib/phone-countries.js`
// for why the split is a view of the data and not a new shape of it. The
// picker's value is DERIVED from that string on every render, so anything that
// rewrites the phone from outside (picking a customer from the suggestion
// list, Book Again, a waitlist hand-over) moves the flag with it.
//
// ── The one piece of state it keeps ─────────────────────────────────────────
// `chosen`: the country the user last picked. The string cannot always carry
// it — an EMPTY number stores nothing (`joinPhone`), and "+1" is the USA and
// Canada and twenty islands — so without it, choosing Canada on an empty field
// would snap straight back to no country, and choosing it for "+1 416…" would
// snap back to the USA. It is a PREFERENCE handed to `splitPhone`, so a string
// that names a different code still wins.
//
// ── No default country (v18.2.0 phase 19) ────────────────────────────────────
// Patryk: the picker shows no country code until one is chosen. It used to
// start on the restaurant's Settings default ("+34"), which the form also
// seeded into the phone itself, so a foreign number typed without its code was
// saved as a Spanish one and nothing on screen had asked. Now a number typed
// with no country is stored as typed (`joinPhone`), the picker reads "Code",
// and the booking form's Save refuses it until a code is picked or typed
// (`phoneHasCode`, App's `doSave`).
//
// ── What changed about focus ─────────────────────────────────────────────────
// The old field typed a "+" into itself on focus so the number started in
// international form. The code now lives in the picker, so the number box
// holds the number alone; typing or pasting "+44 …" / "0044 …" there still
// works and moves the picker to the country it names.
//
// `onChange(value, source)`: `source` is "picker" for a country pick, "detect"
// for a code found on blur (below), and undefined for typing — the caller's
// suggestion list must only open on typing.
//
// ── A code typed without the plus (v18.2.0 phase 20) ─────────────────────────
// Patryk: a number typed WITH its country code should put that code in the
// picker. "+44 …" and "0044 …" always did, key by key. "44 7700 900123" did
// not: it was stored behind whatever the picker held. `withTypedCode`
// (lib/phone-countries.js) decides it, deliberately narrowly — see there — and
// it runs when the number box LOSES focus, not per keystroke: digits alone
// name a code only once the number is long enough, so doing it while typing
// would strip "44" out from under the cursor at the eleventh digit. It runs
// only if the box was typed in during that focus, so tabbing through an old
// booking never rewrites its stored number. App's Save runs the same function
// for a save that never blurred the box (Enter).
//
// A country the FIELD found (a typed "+44", "0044", or this detection) is
// forgotten when the number is cleared: it was a reading of that number, and
// with the number gone the picker goes back to "Code". Measured before this:
// "44 7700 900123" detected 🇬🇧, the box was cleared, a French number typed
// without its code was saved as "+44 33 6 12 34 56 78". A country somebody
// PICKED stays — that was a choice about the guest, not about the digits.
//
// `inputProps` land on the NUMBER input (its id — so the form's label names it
// — and the focus/blur handlers the customer-suggestion list is driven by);
// `children` render inside the positioned row, which is where that suggestion
// list has always hung.

import { useState, useRef } from "react";
import { SP } from "../lib/constants";
import { mkInp } from "./atoms";
import { CountryPicker } from "./CountryPicker";
import { splitPhone, joinPhone, dialOf, withTypedCode } from "../lib/phone-countries";

export function PhoneField({ value, onChange, pinned, inputProps, children, placeholder = "600 000 000" }) {
  const [chosen, setChosen] = useState(null);
  // An international prefix typed one key at a time ("+", "+3") names no
  // country yet. It is held HERE, shown in the box and stored as nothing,
  // until it grows into a code ("+34") — at which point the picker takes the
  // code and the box keeps only what follows it.
  const [raw, setRaw] = useState(null);
  // Was the number box typed in since it last took focus? (phase 20, above)
  const typedRef = useRef(false);
  // Did the FIELD set `chosen` (from the digits) rather than the user? (above)
  const foundRef = useRef(false);
  const { iso, national } = splitPhone(value, chosen);
  const { onBlur: callerBlur, ...boxProps } = inputProps || {};

  function onPick(nextIso) {
    setChosen(nextIso);
    foundRef.current = false;
    setRaw(null);
    // An empty number stays empty — switching country must never WRITE a
    // phone. A typed one is re-prefixed with the new code.
    // The second argument says WHERE the change came from: the booking form
    // opens its customer-suggestion list on a number-box change, and one
    // opened by a picker change has no blur to close it (/code-review).
    if (national) { onChange(joinPhone(nextIso, national), "picker"); return; }
    // A string that names a code outranks `chosen`, so a leftover code-only
    // value must go or the pick reads back as the old country. Found live in
    // v18.1.0, when the form was seeded with "+34" and picking Belgium on a
    // fresh form read back as Spain. v18.2.0 seeds nothing, so this is now
    // defensive: it covers a code-only string arriving from outside the field.
    // Clear it: "" and a bare prefix are the same nothing to `enteredPhone`.
    if (value) onChange("", "picker");
  }
  // The number is gone: a country the field found in it goes with it.
  function forgetFound() {
    if (!foundRef.current) return;
    foundRef.current = false;
    setChosen(null);
  }
  function onNumber(e) {
    typedRef.current = true;
    const s = String(e.target.value || "");
    const t = s.trim();
    if (t.charAt(0) === "+" || t.slice(0, 2) === "00") {
      if (!dialOf(t)) { setRaw(s); forgetFound(); onChange(""); return; }
      // It names its own country: move the picker there and keep the rest.
      const sp = splitPhone(t, iso);
      setRaw(null);
      setChosen(sp.iso);
      foundRef.current = true;
      onChange(joinPhone(sp.iso, sp.national));
      return;
    }
    setRaw(null);
    // Clearing the box stores "" (joinPhone), never a bare code; text with no
    // digits at all is passed through as typed so the box does not eat it.
    const next = joinPhone(iso, s) || (/\d/.test(s) ? "" : t);
    // `iso` here is the one this render derived — possibly the country being
    // forgotten — so the join above already used it; clearing is the only case
    // that forgets, and a cleared box joins to "" whatever the country.
    if (!/\d/.test(s)) forgetFound();
    onChange(next);
  }
  function onBoxBlur(e) {
    if (typedRef.current) {
      typedRef.current = false;
      const found = withTypedCode(value, pinned);
      if (found !== value) {
        setRaw(null);
        setChosen(splitPhone(found, null).iso);
        foundRef.current = true;
        onChange(found, "detect");
      }
    }
    if (callerBlur) callerBlur(e);
  }

  return (
    <div style={{ position: "relative", display: "flex", gap: SP.snug, alignItems: "center" }}>
      <CountryPicker iso={iso} onPick={onPick} pinned={pinned} ariaLabel="Country code" />
      <input
        type="tel"
        inputMode="tel"
        autoComplete="tel-national"
        /* `raw` counts only while the stored phone is still empty — it is
           what an incomplete prefix stores. Once anything else writes the
           phone (a guest picked from the NAME list, Book Again) the stale
           "+3" must give way to the number the form will save (/code-review). */
        value={raw !== null && !value ? raw : national}
        onChange={onNumber}
        placeholder={placeholder}
        className="mgt-hover-scale"
        {...boxProps}
        onBlur={onBoxBlur}
        style={Object.assign({}, mkInp(), { flex: 1, minWidth: 0 })}
      />
      {children}
    </div>
  );
}
