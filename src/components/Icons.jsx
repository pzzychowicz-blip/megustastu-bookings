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
// ── v17.9.0: the rule above was narrowed, on purpose ─────────────────────────
// v17.8.0 drew the line at "does this render as a colour emoji", and kept
// ✕ ‹ › ▲ ▼ ▸ ▾ ✓ ★ as text on the grounds that they inherit colour and weight
// for free and truncate with their label. That reasoning is sound and it was
// still the wrong line, for a reason the emoji argument obscures: **an icon set
// that covers only the glyphs with a rendering BUG is not an icon set, it is a
// patch.** The app ended up drawing its dismiss control as a text ✕ two
// millimetres from a hand-drawn SVG cog — the exact "not one medium" complaint
// in point 1 above, just with a monochrome glyph instead of a colour one.
//
// So every CONTROL mark is now drawn here. TWO things stay text, and they are a
// category, not an exception list:
//
//   • Prose arrows inside sentences — "Settings → Opening hours", the history
//     entries ("status → completed"), the shift labels. These are punctuation
//     in a text run. An SVG in the middle of a sentence is a rendering bug, not
//     an icon.
//   • Keycap labels in Shortcuts.jsx (← → ↑ ↓ ⇧). They depict the key you press.
//     Replacing them with drawn arrows breaks the mapping to the physical
//     keyboard, which is the entire content of that screen.
//
// It was THREE. The timeline's bracketed `[L]` / `[!]` / `!!` were defended as
// "ASCII, not glyphs, and deliberately part of the truncating label string" —
// see the second-pass note further down for why neither half of that survived.
//
// The truncation cost is real and is paid explicitly: TimelineView's ★ moved
// OUT of the label string into the marker row (where the note dog-ear and the
// waitlist ⏳ already live), so it no longer truncates with the name — it is now
// a fixed-width marker that survives a narrow block, which is what a "this party
// has preferred tables" flag should do anyway.
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

// ── v17.9.0: the control marks (ex ✕ ✓ ★ ▲ ▼ ▸ ▾ ‹ › 🖨 ⬇ ✎ and the ASCII = / >)
// Chevrons are ONE shape at four rotations rather than four hand-drawn paths, so
// a disclosure that turns and a nav arrow that points can never drift apart.
function Chevron({ deg, ...rest }) {
  return (
    <Svg {...rest}>
      <g transform={"rotate(" + deg + " 12 12)"}><path d="M9 5l7 7-7 7" /></g>
    </Svg>
  );
}
export function ChevronRightIcon(props) { return <Chevron deg={0} {...props} />; }
export function ChevronDownIcon(props) { return <Chevron deg={90} {...props} />; }
export function ChevronLeftIcon(props) { return <Chevron deg={180} {...props} />; }
export function ChevronUpIcon(props) { return <Chevron deg={270} {...props} />; }

export function CloseIcon(props) {
  return (
    <Svg {...props}>
      <path d="M6 6l12 12" />
      <path d="M18 6L6 18" />
    </Svg>
  );
}

export function CheckIcon(props) {
  return (
    <Svg {...props}>
      <path d="M4 12.5l5.5 5.5L20 6.5" />
    </Svg>
  );
}

// The preferred-tables marker. FILLED, unlike every other icon here, because it
// replaces ★ (U+2605, the solid star) rather than ☆ — and because it is a flag
// on a saturated block where an outline star at 10px closes up into a blob.
export function StarIcon({ size = 20 }) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24"
      fill="currentColor" stroke="none"
      style={{ display: "block", flexShrink: 0 }}
      aria-hidden="true"
    >
      <path d="M12 2.6l2.9 5.9 6.5.95-4.7 4.58 1.11 6.47L12 17.44l-5.81 3.06 1.11-6.47-4.7-4.58 6.5-.95z" />
    </svg>
  );
}

export function PrintIcon(props) {
  return (
    <Svg {...props}>
      <path d="M6 9V3h12v6" />
      <path d="M6 18H4a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2" />
      <rect x="6" y="14" width="12" height="8" rx="1.5" />
    </Svg>
  );
}

export function DownloadIcon(props) {
  return (
    <Svg {...props}>
      <path d="M12 3v12" />
      <path d="M7 10.5l5 5 5-5" />
      <path d="M3.5 20.5h17" />
    </Svg>
  );
}

// Rename / edit. A pencil on a baseline rather than a bare nib — at 14px a
// lone diagonal reads as a slash, which is what the ex-✎ looked like next to
// the ✓ it sits beside.
export function EditIcon(props) {
  return (
    <Svg {...props}>
      <path d="M14.5 4.5l5 5L9 20H4v-5z" />
      <path d="M13 6l5 5" />
    </Svg>
  );
}

// Manual table assignment (ex the ASCII `=`). A grid of tables with one picked,
// which is literally what the modal it opens asks you to do. The `=` it replaces
// was meant to evoke two pushed-together tables and read as an equals sign.
export function AssignIcon(props) {
  return (
    <Svg {...props}>
      <rect x="2.5" y="4" width="8" height="7" rx="1.6" />
      <rect x="13.5" y="4" width="8" height="7" rx="1.6" />
      <rect x="2.5" y="14" width="8" height="7" rx="1.6" />
      <path d="M14 17.5l2.5 2.5 5-5" />
    </Svg>
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

// ── v17.9.0 (second pass): the timeline block's last three ASCII markers ─────
// `[L]` / `[!]` / `!!` were the one category this file's header still defended
// as text, on the grounds that they are ASCII and belong to the truncating
// label string. Both halves of that stopped being true in the same change: the
// label no longer carries flags at all (they moved to the block's right-hand
// rail, where they are fixed-width and survive a narrow block), and "it is
// ASCII" was never a reason to look different from every other mark on the
// same 36px surface — it is the emoji argument's mistake in a plainer costume.
//
// Note there are only TWO new icons for three markers. `!!` means a seated
// party is overstaying INTO the next booking on that table — the identical
// `warnings` entry the Overlap section of the notification strip renders — so
// it takes OverlapIcon. Same data, same mark, in both places it appears.

// Locked to its tables — a walk-in, or a manual assignment the optimizer must
// not move. Body and shackle only: a keyhole is invisible at the 10px this
// renders at on a block, and closes the body up into a filled square.
export function LockIcon(props) {
  return (
    <Svg {...props}>
      <rect x="4" y="10.5" width="16" height="10.5" rx="2.2" />
      <path d="M8 10.5V7a4 4 0 0 1 8 0v3.5" />
    </Svg>
  );
}

// Repeat no-show (2+ past no-shows on this phone). A struck-through person, and
// the slash is the load-bearing half — it runs corner to corner rather than
// neatly around the figure, for the same reason OfflineIcon's does: at 10px the
// figure alone is nearly closed and only a full-length diagonal still reads.
export function NoShowIcon(props) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="8" r="3.6" />
      <path d="M5.2 20.5a6.8 6.8 0 0 1 13.6 0" />
      <path d="M3 3l18 18" />
    </Svg>
  );
}

// The deposit marker. Until v17.9.0 this was the CURRENCY SYMBOL from
// settings/general appended to the label — so the flag for "money has been
// taken" was a different shape per restaurant setting, and on a narrow block it
// truncated away with the name. Whatever replaces it has to stay
// currency-NEUTRAL, which is the whole property that change bought; a drawn "$"
// would hand the defect straight back in a shape that merely looks deliberate.
//
// v17.9.1: a banknote, not the coin v17.9.0 drew. Two concentric circles at the
// 11px this renders at on a timeline block are not read as money — they are a
// target, or a button. A note has an outline nothing else in the set shares
// (every other icon here is round, diagonal, or a chevron), so it is
// identifiable by silhouette before any detail resolves.
//
// TWO shapes and no more. Corner ticks, a value line, a second circle — all of
// them turn to mush at 11px, which is the size that decides this icon, not the
// 24 it is drawn at. Verify at 11.
//
// v17.9.1 correction — the first banknote was unreadable, and for two reasons
// that only show up at the shipped size:
//
//   • It used HALF the viewBox height (y 6→18, 12 of 24) where every other flag
//     on the rail uses ~70–80% of it. Drawn to the same nominal `size`, it was
//     optically much smaller than the star and the lock beside it.
//   • The inner circle was r 2.6 against a stroke of 2.2, leaving a hole about
//     1.4 units across. At 11px that is **0.6 of a pixel** — it fills in solid,
//     so the note read as a rectangle with a dot rather than as a note.
//
// The fix is geometry, not scale: the note is taller (15 of 24) and the circle
// is r 3.6, which leaves a hole ~2.5× wider and survives the stroke. STROKE
// WIDTH IS THE CONSTRAINT ON DETAIL at these sizes — an interior shape has to
// be at least ~3× the stroke or it closes up. That is the same reason LockIcon
// carries no keyhole.
export function DepositIcon(props) {
  return (
    <Svg {...props}>
      <rect x="2.5" y="4.5" width="19" height="15" rx="2.5" />
      <circle cx="12" cy="12" r="3.6" />
    </Svg>
  );
}

// v17.9.0: the cog moved here from SettingsChrome.jsx. It was the ONE icon
// already drawn properly (v17.1.0) and this file's house style was copied from
// it — but it stayed outside the set, hard-coded at 20×20 with its own <svg>,
// so it took none of the optical stroke compensation and could not be sized.
// In ViewTools' pair that showed: a 17px search beside a 20px cog, which is a
// smaller version of the very mismatch the header of this file is about.
// SettingsChrome re-exports it, so the lazy-Settings import boundary is
// unchanged — Icons.jsx has no imports of its own to drag along.
export function CogIcon(props) {
  return (
    <Svg {...props}>
      <circle cx={12} cy={12} r={3} />
      <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
    </Svg>
  );
}
