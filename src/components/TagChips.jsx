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
//
// ── THE MARK ARRIVES AND LEAVES; IT IS NOT SWAPPED IN ───────────────────────
// It was `{pressed ? <CheckIcon /> : null}`, and Patryk reported what that
// does: the mark is there or gone between two frames. Measured on DEV, the chip
// went 58.7 → 74.7px in one frame and the two chips after it jumped 16px with
// it, and the ring and the ink changed colour in that same frame (the chip's
// transition, the hover lift's, names neither).
//
// So the mark sits in a HORIZONTAL `Reveal`, the timeline block's start-time
// chip exactly (v16.1.1): the width it occupies eases 0 ↔ full with its
// opacity, and the chips beside it slide in step. `speed="move"`, since a mark
// arriving or leaving is `--t-move`'s own definition and a tick is not read as
// it opens the way a disclosure is. The ring and the ink take the same 240ms,
// so the state lands as one event; that half is `OutlineChip`'s, for every chip
// that is a button (atoms.jsx, `CHIP_BUTTON_EASE`), the activity log's filters
// among them.
//
// One detail the ease depends on: the 4px between the mark and the name is
// INSIDE the reveal (`MARK`'s padding), and the chip's own gap is 0. A `Reveal`
// is a flex child from its first frame to its last, so with the atom's gap the
// chip would jump 4px when it mounts and 4px when it unmounts, and ease only
// the other 12.
//
// A chip that is pressed when it MOUNTS shows its mark at once (a form opening
// on a tagged guest does not tick five boxes at you), and a change that lands
// while the page is hidden is a replacement: both are `Reveal`'s.

import { H, IC, SP } from "../lib/constants";
import { OutlineChip, Reveal } from "./atoms";
import { CheckIcon } from "./Icons";

const CHIP = { minHeight: H.chip };
const PRESSABLE = { minHeight: H.chip, gap: 0 };
const MARK = { display: "inline-flex", paddingRight: SP.tight };
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
            className="mgt-hover-scale" style={PRESSABLE}
            tone={pressed ? "success" : "neutral"}
            aria-pressed={pressed}
            disabled={disabled}
            onClick={function () { onToggle(t.id); }}
          ><Reveal horizontal show={pressed} speed="move"><span style={MARK}><CheckIcon size={IC.inline} /></span></Reveal>{t.label}</OutlineChip>
        );
      })}
    </div>
  );
}

// `labels`: the tag names to show, in the tag list's order. Nothing is rendered
// for none, so a caller can put it in a row without asking first.
//
// The key carries the position: a name is unique within its own kind only, and
// the seat note hands over a guest's tags and the visit's in one list, so a
// guest tag and an occasion tag both called "Birthday" would share a key.
export function TagRow({ labels, style }) {
  if (!labels || !labels.length) return null;
  return (
    <div style={{ ...ROW, ...(style || {}) }}>
      {labels.map(function (l, i) { return <OutlineChip key={i + ":" + l} size="small" style={CHIP}>{l}</OutlineChip>; })}
    </div>
  );
}
