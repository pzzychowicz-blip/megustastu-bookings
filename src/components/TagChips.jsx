// src/components/TagChips.jsx
//
// v18.5.0 — a booking's or a guest's tags as chips.
//
// `TagChips` is the EDITABLE row: every tag of one kind from the tag list
// (`settings/tags`), each a button that is pressed when `on` holds its id. The
// booking form uses it twice (guest tags, occasion) and Settings → Customers
// once per opened customer.
//
// `TagRow` is the same row READ: only the tags somebody has, as plain chips. The
// seat note uses it, and a Customers row for an account that may not edit.
//
// Both are the app's outline chip (atoms.jsx), at the size and height the
// activity log's filter chips take, where a pressed chip is already this one in
// the success tone. A pressed tag also carries a check mark: these chips say
// "this guest has an allergy", and that must not rest on a ring's colour.
// `aria-pressed` says it to a screen reader.
//
// Neither holds state. The form's guest chips are not a set at all: `on` is
// `editTagIds(base, taps)` and a tap is `toggleTagEdit` (lib/tags.js), which is
// the caller's business.

import { H, IC, SP } from "../lib/constants";
import { OutlineChip } from "./atoms";
import { CheckIcon } from "./Icons";

const CHIP = { minHeight: H.chip };
const ROW = { display: "flex", flexWrap: "wrap", gap: SP.tight };

export function TagChips({ tags, on, onToggle, disabled = false }) {
  const held = Array.isArray(on) ? on : [];
  return (
    <div style={ROW}>
      {(tags || []).map(function (t) {
        const pressed = held.indexOf(t.id) >= 0;
        return (
          <OutlineChip
            key={t.id} as="button" type="button" size="small"
            className="mgt-hover-scale" style={CHIP}
            tone={pressed ? "success" : "neutral"}
            aria-pressed={pressed}
            disabled={disabled}
            onClick={function () { onToggle(t.id); }}
          >{pressed ? <CheckIcon size={IC.inline} /> : null}{t.label}</OutlineChip>
        );
      })}
    </div>
  );
}

// `labels`: the tag names to show, in the tag list's order. Nothing is rendered
// for none, so a caller can put it in a row without asking first.
export function TagRow({ labels, style }) {
  if (!labels || !labels.length) return null;
  return (
    <div style={{ ...ROW, ...(style || {}) }}>
      {labels.map(function (l) { return <OutlineChip key={l} size="small" style={CHIP}>{l}</OutlineChip>; })}
    </div>
  );
}
