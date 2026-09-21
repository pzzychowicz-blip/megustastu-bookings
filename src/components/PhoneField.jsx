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
// would snap straight back to the default, and choosing it for "+1 416…" would
// snap back to the USA. It is a PREFERENCE handed to `splitPhone`, so a string
// that names a different code still wins.
//
// ── What changed about focus ─────────────────────────────────────────────────
// The old field typed a "+" into itself on focus so the number started in
// international form. The code now lives in the picker, so the number box
// holds the number alone; typing or pasting "+44 …" / "0044 …" there still
// works and moves the picker to the country it names.
//
// `inputProps` land on the NUMBER input (its id — so the form's label names it
// — and the focus/blur handlers the customer-suggestion list is driven by);
// `children` render inside the positioned row, which is where that suggestion
// list has always hung.

import { useState } from "react";
import { SP } from "../lib/constants";
import { mkInp } from "./atoms";
import { CountryPicker } from "./CountryPicker";
import { splitPhone, joinPhone, dialOf } from "../lib/phone-countries";

export function PhoneField({ value, onChange, defaultIso, pinned, inputProps, children, placeholder = "600 000 000" }) {
  const [chosen, setChosen] = useState(null);
  // An international prefix typed one key at a time ("+", "+3") names no
  // country yet. It is held HERE, shown in the box and stored as nothing,
  // until it grows into a code ("+34") — at which point the picker takes the
  // code and the box keeps only what follows it.
  const [raw, setRaw] = useState(null);
  const { iso, national } = splitPhone(value, chosen || defaultIso);

  function onPick(nextIso) {
    setChosen(nextIso);
    setRaw(null);
    // An empty number stays empty — switching country must never WRITE a
    // phone. A typed one is re-prefixed with the new code.
    if (national) { onChange(joinPhone(nextIso, national)); return; }
    // The untouched field holds the SEEDED prefix ("+34", from Settings), and
    // a string that names a code outranks `chosen` — so without this, picking
    // Belgium on a fresh form read back as Spain. Measured live on the first
    // try. Clear it: "" and the seed are the same nothing to `enteredPhone`.
    if (value) onChange("");
  }
  function onNumber(e) {
    const s = String(e.target.value || "");
    const t = s.trim();
    if (t.charAt(0) === "+" || t.slice(0, 2) === "00") {
      if (!dialOf(t)) { setRaw(s); onChange(""); return; }
      // It names its own country: move the picker there and keep the rest.
      const sp = splitPhone(t, iso);
      setRaw(null);
      setChosen(sp.iso);
      onChange(joinPhone(sp.iso, sp.national));
      return;
    }
    setRaw(null);
    // Clearing the box stores "" (joinPhone), never a bare code; text with no
    // digits at all is passed through as typed so the box does not eat it.
    onChange(joinPhone(iso, s) || (/\d/.test(s) ? "" : t));
  }

  return (
    <div style={{ position: "relative", display: "flex", gap: SP.snug, alignItems: "center" }}>
      <CountryPicker iso={iso} onPick={onPick} pinned={pinned} ariaLabel="Country code" />
      <input
        type="tel"
        inputMode="tel"
        autoComplete="tel-national"
        value={raw !== null ? raw : national}
        onChange={onNumber}
        placeholder={placeholder}
        className="mgt-hover-scale"
        {...inputProps}
        style={Object.assign({}, mkInp(), { flex: 1, minWidth: 0 })}
      />
      {children}
    </div>
  );
}
