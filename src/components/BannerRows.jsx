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

export function BannerRows({ ids, renderRow }) {
  // Per-row ease-in/out lifecycle: renderIds may hold departing rows a moment
  // longer than `ids` so their collapse animates.
  const { renderIds, openIds } = useRevealRows(ids);

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
        {renderIds.map(function (id, i) {
          return (
            <Reveal key={id} show={openIds.has(id)}>
              {/* The hairline lives HERE, not on the row, so a banner's row
                  components stay pure content and every banner separates its
                  rows identically. `i > 0` keeps it off the first row, whose
                  separation from the header is already the header's padding.
                  paddingLeft 31 = the strip's 14 + the dot (8) + its gap (9),
                  so row text sits on the same left edge as the section title
                  rather than under the dot. */}
              <div style={{ padding: "0 14px 0 31px", ...(i > 0 ? { borderTop: "1px solid var(--border-soft)" } : null) }}>
                {renderRow(id)}
              </div>
            </Reveal>
          );
        })}
      </div>
    </div>
  );
}
