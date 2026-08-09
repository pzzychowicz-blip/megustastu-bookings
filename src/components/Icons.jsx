// src/components/Icons.jsx
// v17.8.0 — the app's icon set.
//
// ── Why this exists ──────────────────────────────────────────────────────────
// The app drew its icons with emoji: 🔍 ⏳ ⚠ ⇄ ⬓ ◧. Two problems, one of them
// not cosmetic.
//
// 1. They are not ONE medium. `ViewTools` put a full-colour OS emoji (🔍)
//    directly beside a hand-drawn monochrome SVG (CogIcon) in the same 34px
//    pair. No amount of sizing reconciles a colour glyph with a hairline
//    stroke — they are drawn by different renderers, in different weights, and
//    only one of them follows `currentColor`.
// 2. They render DIFFERENTLY per platform. An emoji is painted from the OS
//    font, so 🔍 is one shape on the iPads, another on the Android tablet, and
//    a third in the Chrome tab. U+26A0 ⚠ is worse: Unicode defaults it to text
//    presentation, macOS honours that, and Android's Chrome substitutes the
//    colour emoji anyway — so the same warning marker is a thin outline on one
//    device in the restaurant and a yellow sign on another.
//
// ── What is NOT in here, on purpose ──────────────────────────────────────────
// Monochrome typographic marks with universal font coverage stay as text:
// ✕ ‹ › ▲ ▼ ▸ ▾ ✓ ★, plus the timeline's bracketed `[L]` / `!!` markers. They
// are glyphs in a text run, they inherit colour and weight for free, and they
// truncate with the label they sit in — which an inline SVG does not. The line
// is "does this render as a colour emoji, or is its font coverage patchy",
// not "is this a picture".
//
// House style, inherited from CogIcon (SettingsChrome.jsx, the one icon that
// was already drawn properly): 24×24 viewBox, no fill, `currentColor` stroke,
// round caps and joins. `strokeWidth` scales down as the icon does, or a 14px
// icon at stroke-2 reads heavier than a 20px one.

function Svg({ size = 20, stroke, children }) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24"
      fill="none" stroke="currentColor"
      // Optical compensation: 2 is right at 20px, too heavy below ~16px.
      strokeWidth={stroke != null ? stroke : size >= 18 ? 2 : 2.2}
      strokeLinecap="round" strokeLinejoin="round"
      style={{ display: "block", flexShrink: 0 }}
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export function SearchIcon(props) {
  return (
    <Svg {...props}>
      <circle cx={11} cy={11} r={7} />
      <path d="M20 20l-3.9-3.9" />
    </Svg>
  );
}

// The waitlist marker (ex-⏳). An hourglass, not a clock: the waitlist is about
// a party WAITING, not about a time of day — which is the distinction the
// reminder banner's ex-⏰ blurred.
export function WaitIcon(props) {
  return (
    <Svg {...props}>
      <path d="M6 2h12" />
      <path d="M6 22h12" />
      <path d="M6 2v5l6 5 6-5V2" />
      <path d="M6 22v-5l6-5 6 5v5" />
    </Svg>
  );
}

export function SwapIcon(props) {
  return (
    <Svg {...props}>
      <path d="M4 8h13" />
      <path d="M13 4l4 4-4 4" />
      <path d="M20 16H7" />
      <path d="M11 20l-4-4 4-4" />
    </Svg>
  );
}

// Split-direction glyphs (ex-◧ / ⬓). The filled half is the pane the label
// names, so the icon is a diagram of the resulting layout rather than a symbol
// to memorise. Filled with currentColor at low opacity, which the stroke-only
// Svg wrapper can't express, hence the local <svg>.
function SplitGlyph({ size = 20, vertical }) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24"
      fill="none" stroke="currentColor" strokeWidth={2}
      strokeLinecap="round" strokeLinejoin="round"
      style={{ display: "block", flexShrink: 0 }}
      aria-hidden="true"
    >
      <rect x={3} y={3} width={18} height={18} rx={3} />
      {vertical
        ? <><path d="M12 3v18" /><rect x={3} y={3} width={9} height={18} rx={3} fill="currentColor" opacity={0.35} stroke="none" /></>
        : <><path d="M3 12h18" /><rect x={3} y={3} width={18} height={9} rx={3} fill="currentColor" opacity={0.35} stroke="none" /></>}
    </svg>
  );
}

/** Side-by-side split (two panes left/right). */
export function SplitSideIcon(props) { return <SplitGlyph {...props} vertical />; }
/** Top-and-bottom split (two panes stacked). */
export function SplitStackIcon(props) { return <SplitGlyph {...props} />; }
