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

// ── v17.8.0: the notification-section icons ──────────────────────────────────
// One per section of NotificationStrip, replacing the 8px semantic dot. The dot
// said "something", coloured; these say WHICH something, and keep the colour —
// every one is `currentColor`, so the strip tints them with the same `tone` the
// dot used and nothing about the colour system changes.
//
// They also do a second job the dot could not: collapsed, the strip lists an
// icon + count per live section, so "2 late, 1 waiting" is legible without
// expanding. That only works if every section has a mark of its own, which is
// why the four the brief didn't name are drawn here too.

// The strip's lid when several sections are live — a plain bell, the generic
// "notifications" mark. Deliberately the QUIET one of the two bells: it labels
// the container, and the container must not out-shout the reminder inside it.
export function BellIcon(props) {
  return (
    <Svg {...props}>
      <path d="M18 8a6 6 0 1 0-12 0c0 6-2 7-2 7h16s-2-1-2-7" />
      <path d="M13.7 20a2 2 0 0 1-3.4 0" />
    </Svg>
  );
}

// Reminders — the same bell RINGING. A reminder is a bell that has gone off, so
// it is the plain bell plus motion arcs rather than a different object; the two
// read as one family at 14px, which a bell-vs-clock pairing would not.
export function BellRingIcon(props) {
  return (
    <Svg {...props}>
      <path d="M17 9a5 5 0 0 0-10 0c0 5-1.8 6.2-1.8 6.2h13.6S17 14 17 9" />
      <path d="M13.4 19a2 2 0 0 1-2.8 0" />
      <path d="M20.2 5.4a7.5 7.5 0 0 1 1.5 3.4M3.8 5.4a7.5 7.5 0 0 0-1.5 3.4" />
    </Svg>
  );
}

// Running late — a stopwatch, not a clock face. The crown and side buttons are
// what separate "elapsed time is the problem" from "here is the time", which is
// the whole distinction between this section and Reminders.
export function LateIcon(props) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="13.5" r="7.5" />
      <path d="M12 9.5v4l2.6 2.1" />
      <path d="M9.6 2.5h4.8" />
      <path d="M12 2.5v3" />
      <path d="M19.6 5.2l1.6 1.6M4.4 5.2L2.8 6.8" />
    </Svg>
  );
}

// Overlap warnings — two blocks sharing a span, which is literally the fault:
// the top bar's tail runs under the bottom bar's head. A warning triangle would
// have described the severity, which the colour already does.
export function OverlapIcon(props) {
  return (
    <Svg {...props}>
      <rect x="2.5" y="5" width="13" height="5.5" rx="1.6" />
      <rect x="8.5" y="13.5" width="13" height="5.5" rx="1.6" />
      <path d="M12 10.5v3" />
    </Svg>
  );
}

// Working offline — a struck-through cloud. The slash is the load-bearing part
// (a cloud alone reads as "syncing"), and it runs corner to corner so it stays
// legible at 14px where the cloud's own outline is nearly closed.
export function OfflineIcon(props) {
  return (
    <Svg {...props}>
      <path d="M17.5 18.5H7a4.5 4.5 0 0 1-.6-8.96A6 6 0 0 1 17.6 9.2" />
      <path d="M3 3l18 18" />
    </Svg>
  );
}

// Couldn't save — the one triangle in the set, and it earns it: this is the
// only section that reports the app failing rather than the restaurant needing
// something. The bar-and-dot inside is the standard alert interior.
export function AlertIcon(props) {
  return (
    <Svg {...props}>
      <path d="M10.3 3.6L1.9 18a2 2 0 0 0 1.7 3h16.8a2 2 0 0 0 1.7-3L13.7 3.6a2 2 0 0 0-3.4 0z" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </Svg>
  );
}

// Closed this day — the universal "no". Not a padlock (that reads as a
// permission problem) and not a calendar (which is what every DATE control in
// the app already is); a struck circle is the one mark that says "not today"
// without competing with either.
export function ClosedIcon(props) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M5.6 5.6l12.8 12.8" />
    </Svg>
  );
}
