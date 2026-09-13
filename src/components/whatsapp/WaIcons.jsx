// src/components/whatsapp/WaIcons.jsx
// Small inline-SVG icons for the WhatsApp inbox. Stroke-based so they inherit
// the host button's `color` via currentColor — theme-aware (dark mode) with no
// extra tokens. pointerEvents:none so the parent button owns all clicks.
//
// TemplatesIcon — a document (folded top-right corner) with three text lines.
//   Used for: the panel-header "Templates" button (replaces "⚙ Templates") and
//   the composer "Templates" toggle (replaces the text "Templates ▸" button).
// SelectIcon — a checkbox with a tick. Toggles multi-select mode in the inbox.

import { IC } from "../../lib/constants";

export function TemplatesIcon({ size = IC.chrome, color = "currentColor" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      style={{ pointerEvents: "none", display: "block" }} aria-hidden="true">
      {/* Page outline with a folded top-right corner */}
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5" />
      {/* Three text lines */}
      <line x1="8.5" y1="12.5" x2="15.5" y2="12.5" />
      <line x1="8.5" y1="15.5" x2="15.5" y2="15.5" />
      <line x1="8.5" y1="18" x2="13" y2="18" />
    </svg>
  );
}

// RecheckIcon — a near-closed circular arrow with a tick inside: "run the check
// again". Used for the manual LLM re-check button, left of Archive in the
// conversation header. The gap + arrowhead sit at ~2 o'clock so the tick stays
// centred and legible at 17px.
export function RecheckIcon({ size = IC.chrome, color = "currentColor" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      style={{ pointerEvents: "none", display: "block" }} aria-hidden="true">
      {/* Ring, open at the upper right */}
      <path d="M20.2 9.8A8.5 8.5 0 1 1 14.9 4" />
      {/* Arrowhead closing the gap, pointing up */}
      <path d="M17.6 11l2.6-2.9 2.4 2.9" />
      {/* Tick */}
      <path d="M8.2 12.2l2.8 2.8 5-5.4" />
    </svg>
  );
}

export function SelectIcon({ size = IC.chrome, color = "currentColor" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      style={{ pointerEvents: "none", display: "block" }} aria-hidden="true">
      {/* Checkbox */}
      <rect x="3" y="3" width="18" height="18" rx="4" />
      {/* Tick */}
      <path d="M8 12.5l2.5 2.5L16 9" />
    </svg>
  );
}

// ── v17.8.0 sweep: the emoji that had to go ───────────────────────────────────
// The test is not "is it a picture" — it is CLAUDE.md's: does the glyph render
// as COLOUR EMOJI, or is its font coverage patchy? 📋 📦 🗑 🔗 🧪 🎲 ✨ 🌊 all
// paint a full-colour OS glyph, which puts an Apple illustration next to a
// hand-drawn stroke icon on the same 36px button and a different illustration
// on the tablet. ⚠ and ✎ are the subtler half: both DEFAULT to text
// presentation, macOS honours that, and Android's Chrome substitutes the colour
// emoji — so the same marker was an outline on one restaurant device and a
// yellow sign on another.
//
// What deliberately STAYS text: ✓ ✕ ✗ ↻ ↺ ‹ › ▸ ▾. Monochrome, universally
// covered, and they inherit colour and weight for free — which an inline SVG
// cannot, and which is exactly why they truncate correctly with their label.
//
// strokeWidth eases up below 18px: a small icon reads lighter at the same
// nominal weight, so the house style compensates rather than looking thinner
// beside a large one.
const sw = (size) => (size < 18 ? 2 : 1.8);
function Svg({ size, color, children }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke={color} strokeWidth={sw(size)} strokeLinecap="round" strokeLinejoin="round"
      style={{ pointerEvents: "none", display: "block" }} aria-hidden="true">{children}</svg>
  );
}

// DraftIcon (was 📋) — a clipboard. The marker for "a booking was parsed out of
// this message", on the conversation row, the draft card and the parsing notice.
export function DraftIcon({ size = IC.chrome, color = "currentColor" }) {
  return (
    <Svg size={size} color={color}>
      <rect x="4" y="4" width="16" height="17" rx="2.5" />
      <path d="M9 4V3a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1" />
      <line x1="8" y1="11" x2="16" y2="11" />
      <line x1="8" y1="15" x2="13.5" y2="15" />
    </Svg>
  );
}

// ArchiveIcon (was 📦) — a box with a lid band and a pull slot.
export function ArchiveIcon({ size = IC.chrome, color = "currentColor" }) {
  return (
    <Svg size={size} color={color}>
      <rect x="3" y="4" width="18" height="4.5" rx="1.5" />
      <path d="M4.75 8.5v10a1.5 1.5 0 0 0 1.5 1.5h11.5a1.5 1.5 0 0 0 1.5-1.5v-10" />
      <line x1="10" y1="13" x2="14" y2="13" />
    </Svg>
  );
}

// TrashIcon (was 🗑) — a bin with a lid and two staves.
export function TrashIcon({ size = IC.chrome, color = "currentColor" }) {
  return (
    <Svg size={size} color={color}>
      <line x1="4" y1="6.5" x2="20" y2="6.5" />
      <path d="M9 6.5V4.5a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 4.5v2" />
      <path d="M6.5 6.5l1 13a1.5 1.5 0 0 0 1.5 1.4h6a1.5 1.5 0 0 0 1.5-1.4l1-13" />
      <line x1="10.5" y1="10.5" x2="10.8" y2="17" />
      <line x1="13.5" y1="10.5" x2="13.2" y2="17" />
    </Svg>
  );
}

// LinkIcon (was 🔗) — two chain links. Heads the "linked booking" card.
export function LinkIcon({ size = IC.chrome, color = "currentColor" }) {
  return (
    <Svg size={size} color={color}>
      <path d="M10 13.5a4 4 0 0 0 5.7.4l2.8-2.8a4 4 0 0 0-5.7-5.7l-1.6 1.6" />
      <path d="M14 10.5a4 4 0 0 0-5.7-.4l-2.8 2.8a4 4 0 0 0 5.7 5.7l1.6-1.6" />
    </Svg>
  );
}

// WarnIcon (was ⚠) — a triangle with a bang. THE one that motivated this pass:
// U+26A0 renders differently per platform, so the app's most important marker
// was the least predictable glyph in it.
export function WarnIcon({ size = IC.chrome, color = "currentColor" }) {
  return (
    <Svg size={size} color={color}>
      <path d="M12 3.5 21.2 19.5a1.4 1.4 0 0 1-1.2 2H4a1.4 1.4 0 0 1-1.2-2Z" />
      <line x1="12" y1="10" x2="12" y2="14.5" />
      <line x1="12" y1="17.6" x2="12" y2="17.7" />
    </Svg>
  );
}

// PencilIcon (was ✎) — heads a modification request, and its Apply button.
export function PencilIcon({ size = IC.chrome, color = "currentColor" }) {
  return (
    <Svg size={size} color={color}>
      <path d="M4 20h4l10.5-10.5a2.8 2.8 0 0 0-4-4L4 16Z" />
      <line x1="14.5" y1="6" x2="18.5" y2="10" />
    </Svg>
  );
}

// ── Restore / Retry (v17.9.1 glyph sweep) ─────────────────────────────────────
// The only two marks the sweep had to DRAW. Everything else it needed already
// existed: ✕ → CloseIcon, ‹ → ChevronLeftIcon, ▸/▾ → the Chevron rotations,
// ✓ → CheckIcon, all from the app's own set.
//
// One shape, two mirrorings — the Chevron precedent. `↺ Restore` (unarchive a
// conversation) and `↻ Retry` (resend a failed message) are the same idea
// pointing opposite ways, and drawing them separately is how two marks for one
// concept drift. `flip` mirrors about the vertical centre-line.
//
// NOT RecheckIcon, which was the obvious reuse and is wrong: it carries a TICK
// inside the ring, because it means "re-check this conversation and tell me the
// answer". Retry means "send it again" and has no answer to report. The v17.9.0
// rule says watch for the reuse before drawing — it does not say take one that
// says something else.
function Rotate({ flip, size, color }) {
  return (
    <Svg size={size} color={color}>
      <g transform={flip ? "scale(-1 1) translate(-24 0)" : undefined}>
        {/* Ring, open at the top-right, with the arrowhead closing the gap. */}
        <path d="M20.5 10.2A8.5 8.5 0 1 1 15 4.2" />
        <path d="M14.6 8.6l5.9-1.1 1.1 5.9" />
      </g>
    </Svg>
  );
}
// ↺ — counter-clockwise: bring it back.
export function RestoreIcon({ size = IC.chrome, color = "currentColor" }) {
  return <Rotate flip size={size} color={color} />;
}
// ↻ — clockwise: do it again.
export function RetryIcon({ size = IC.chrome, color = "currentColor" }) {
  return <Rotate size={size} color={color} />;
}

// ── Dev-simulator chrome (sandbox only) ───────────────────────────────────────
// FlaskIcon (was 🧪) heads the panel button and the modal title; DiceIcon
// (was 🎲) heads the Generate-scenario section.
//
// There were two more here — a SparkIcon for ✨ Suggest and a BurstIcon for
// 🌊 Simulate a burst — and they were dead on arrival: the sweep deleted those
// two emoji from the button LABELS and never mounted the replacements, so both
// components shipped with zero call sites under a comment claiming they were in
// use. Removed rather than wired up, because "Suggest reply" and "Simulate a
// burst" are full-word labels on a dev-only panel and the glyph was decoration.
// Note that lint cannot catch this class of thing: an unused *export* has no
// unused-variable to report. Grep a new icon's call sites before trusting it.
export function FlaskIcon({ size = IC.chrome, color = "currentColor" }) {
  return (
    <Svg size={size} color={color}>
      <path d="M9.5 3v6.2L4.6 18a2 2 0 0 0 1.7 3h11.4a2 2 0 0 0 1.7-3l-4.9-8.8V3" />
      <line x1="8.5" y1="3" x2="15.5" y2="3" />
      <line x1="7.2" y1="14" x2="16.8" y2="14" />
    </Svg>
  );
}
export function DiceIcon({ size = IC.chrome, color = "currentColor" }) {
  return (
    <Svg size={size} color={color}>
      <rect x="3.5" y="3.5" width="17" height="17" rx="3.5" />
      <line x1="8.5" y1="8.5" x2="8.6" y2="8.5" />
      <line x1="15.5" y1="8.5" x2="15.6" y2="8.5" />
      <line x1="12" y1="12" x2="12.1" y2="12" />
      <line x1="8.5" y1="15.5" x2="8.6" y2="15.5" />
      <line x1="15.5" y1="15.5" x2="15.6" y2="15.5" />
    </Svg>
  );
}
