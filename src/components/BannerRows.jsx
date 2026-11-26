// src/components/BannerRows.jsx
// v17.0.0 review fix #6: the shared shell for the in-flow "rows" banners
// (Running-late, Overlap warnings, and — v17.1.0 — Waitlist "table free").
// Extracted from the byte-identical scaffolding they had: the container, the
// collapsible count header (▲/▼, default-collapsed above `collapseMax`,
// initial-only session state), the outer Reveal, and the per-row Reveal driven
// by useRevealRows. Each banner supplies only its `title` and a `renderRow(id)`
// render-prop for the row's own content (name + action buttons + ✕).
//
// ── v17.8.0 restyle: one surface, not two ────────────────────────────────────
// These banners used to be a NESTED CARD: a saturated tinted container with a
// 2px ring, holding rows that each had their own fill, their own 1px border and
// their own radius. Two stacked card treatments is what made them read as
// bolted-on alert boxes rather than part of the app — every other surface here
// (Summary, list cards, the connection popover) is a single quiet pane.
//
// Now: ONE pane, in the app's own card language — a whisper of semantic tint,
// a 1px border, `R.card`. Rows are transparent and separated by hairlines, so
// the eye reads a list inside a panel instead of cards inside a card. The
// semantic colour is carried by a `tone` DOT next to the title (the exact
// device the connection popover uses for status) plus the title colour, rather
// than by washing two full surfaces in it.
//
// Callers pass `tone` (dot + title colour) and `tint` (the barely-there pane
// wash). The old bg/border/textColor props are gone; there were three call
// sites and all three moved together.
//
// Props:
//   title       — header label (the count " · N" is appended here)
//   ids         — the CURRENT live row ids (array; drives the count + lifecycle)
//   collapseMax — start collapsed when ids.length exceeds this (default 2)
//   renderRow(id) — returns the row JSX for a still-mounted id, or null
//   tone        — semantic colour for the dot + title (default: the warn amber)
//   tint        — the pane's background wash (default: the soft overlap amber)

import { Reveal } from "./atoms";
import { useRevealRows } from "../hooks/useRevealRows";
import { useLeavingOrder } from "../hooks/useLeavingOrder";
import { NOTIF_GUTTER, NOTIF_PAD_X } from "./NotificationStrip";

export function BannerRows({ ids, renderRow, swapKey }) {
  // Per-row ease-in/out lifecycle: renderIds may hold departing rows a moment
  // longer than `ids` so their collapse animates.
  //
  // v17.15.0: `swapKey` marks a wholesale replacement of the row list, and only
  // ClashBanner passes one — it is the sole rows banner scoped to the VIEWED
  // date rather than to today, so it is the only one whose rows can be replaced
  // by a different day's while the section itself stays put. The other three
  // depart as a whole section when you leave today, which the strip's own
  // swapKey already covers. Undefined here means the original behaviour,
  // unchanged.
  const { renderIds, openIds } = useRevealRows(ids, swapKey);
  // v18.19.0 (the motion sweep): drawn in the CALLER's order, each leaving row
  // kept where it was (`useLeavingOrder`, as the List and the waitlist draw
  // theirs). `renderIds` is arrival-ordered, and reminders, which came here as
  // a plain map sorted by time, would have put a reminder given an earlier time
  // below the ones already up.
  const order = useLeavingOrder(ids, renderIds);

  if (renderIds.length === 0) return null;

  return (
    <div>
      {/* v17.8.0: the pane AND the header are gone — NotificationStrip owns
          both (one pane for every notification, one collapsed height however
          many fire, and every section headed on the same terms whether its body
          is a row list like this or a single sentence like "Working offline").
          What is left here is the rows. The collapse moved up too, because
          collapsing per-banner cannot bound the total height, which was the
          whole point. */}
      <div>
        {order.map(function (id) {
          // v17.8.0 review fix: the hairline keys on this row's position among
          // the rows that are actually OPEN, not its index in renderIds — which
          // retains a departing row for ~350ms while its Reveal collapses. With
          // the raw index, marking the first of two late bookings as a no-show
          // left the survivor wearing a borderTop that ended up flush under the
          // section header: a line appearing exactly where the design says none.
          const visible = order.filter(function (x) { return openIds.has(x); });
          const i = visible.indexOf(id);
          return (
            // v18.19.0 (the motion sweep): a leaving row is inert, as FoldRows'
            // are, so a second tap during its fold cannot land on the copy.
            <Reveal key={id} show={openIds.has(id)} inert={!openIds.has(id)}
              // The hairline lives HERE, not on the row, so a banner's row
              // components stay pure content and every banner separates its
              // rows identically. `i > 0` keeps it off the first row, whose
              // separation from the header is already the header's padding.
              // NOTIF_GUTTER puts row text on the same left edge as the
              // section title rather than under the mark — imported from the
              // strip that defines that geometry, never re-derived here.
              //
              // v18.19.0 (the motion sweep): on the Reveal, no longer on a
              // wrapper inside it, so the row is the Reveal's own child and its
              // cache (`last`) keeps the ROW. A caller's `renderRow` reads its
              // own data, which for most rows leaves with the id (a reminder
              // marked Done, a dismissed waiting party), so it answers null for
              // the leaving copy; with the wrapper as the child, Reveal kept the
              // wrapper and folded an empty box. Measured on DEV with two
              // reminders: Done on the first dropped its row to 0px in the first
              // frame and the one under it jumped 53px. The padding is
              // horizontal only, and a leaving row is never `i > 0`, so nothing
              // here holds height while it folds.
              style={{ padding: "0 " + NOTIF_PAD_X + "px 0 " + NOTIF_GUTTER + "px", ...(i > 0 ? { borderTop: "1px solid var(--border-soft)" } : null) }}>
              {renderRow(id)}
            </Reveal>
          );
        })}
      </div>
    </div>
  );
}
