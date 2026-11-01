// ── TimeChip — one time to tap ───────────────────────────────────────────────
// Used by the availability line, the WhatsApp draft card and the kitchen's notices.
// It lived in AvailBanner.jsx until v18.14.0 (correction 16), when the walk-in took
// the availability line and that banner had nothing left to show.
//
// The chips keep their fill deliberately. DESIGN.md's outline treatment is for a
// chip standing alone as a count or a disclosure; these are ACTIONS, tap one and the
// form's time changes, and they sit on a tinted pane where an outline chip in a third
// hue would read as decoration rather than as something to press.

import { R, T, FW, H } from "../lib/constants";

// v18.8.0 phase 8: ONE time to pick, shared with the WhatsApp draft card, where
// a tap accepts the request at that time. It was a `<span>` with an onClick
// here, so no keyboard could reach a suggested time; a `<button>` is focusable,
// is pressed by Enter and Space, and wears the app's press dip. Its look is the
// span's, declaration for declaration: `index.css` gives a button the app's
// font, and every property a button's UA style would change is set inline.
// `style` (v18.14.0): the availability line sizes its chips to the row they sit
// in; everywhere else the chip is its own size. `label` (v18.14.0, H4): the same
// pill for another one-tap answer, Save's country codes, which pick a code by its
// `time` and read as its flag and number. v18.14.0 (L1): `H.chip` tall on its own,
// the WhatsApp "Accept at" row. It was 21px, under WCAG 2.5.8's 24.
export function TimeChip({ time, label, onPick, style }) {
  return (
    <button
      type="button"
      className="mgt-hover-scale"
      onClick={() => onPick(time)}
      style={{
        cursor: "pointer", padding: "2px 8px", minHeight: H.chip, borderRadius: R.pill,
        fontWeight: FW.semi, fontSize: T.body,
        background: "var(--suggest-bg)",
        color: "var(--success-text)",
        border: "1px solid var(--suggest-border)",
        boxShadow: "var(--shadow-btn)",
        ...(style || null)
      }}
    >
      {label || time}
    </button>
  );
}
