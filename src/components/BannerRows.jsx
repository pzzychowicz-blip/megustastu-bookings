// src/components/BannerRows.jsx
// v17.0.0 review fix #6: the shared shell for the in-flow "rows" banners
// (Running-late, Overlap warnings, and — v17.1.0 — Waitlist "table free").
// Extracted from the byte-identical scaffolding they had: the container, the
// collapsible count header (▲/▼, default-collapsed above `collapseMax`,
// initial-only session state), the outer Reveal, and the per-row Reveal driven
// by useRevealRows. Each banner supplies only its `title` and a `renderRow(id)`
// render-prop for the row's own content (name + action buttons + ✕).
//
// Props:
//   title       — header label (the count " · N" is appended here)
//   ids         — the CURRENT live row ids (array; drives the count + lifecycle)
//   collapseMax — start collapsed when ids.length exceeds this (default 2)
//   renderRow(id) — returns the row JSX for a still-mounted id, or null
//   bg / border / textColor — container token overrides (default = the amber
//     warn family; WaitAvailBanner passes the green suggest family)

import { useState } from "react";
import { Reveal } from "./atoms";
import { useRevealRows } from "../hooks/useRevealRows";

export function BannerRows({ title, ids, collapseMax = 2, renderRow, bg = "var(--app-overlap-bg)", border = "var(--app-overlap-border)", textColor = "var(--warn-text)" }) {
  // Initial-only (session): won't auto-re-collapse if the count later crosses.
  const [open, setOpen] = useState(function () { return ids.length <= collapseMax; });
  // Per-row ease-in/out lifecycle: renderIds may hold departing rows a moment
  // longer than `ids` so their collapse animates.
  const { renderIds, openIds } = useRevealRows(ids);

  if (renderIds.length === 0) return null;
  const liveCount = ids.length;

  return (
    <div style={{ background: bg, border: "2px solid " + border, borderRadius: 14, padding: "10px 14px", marginBottom: 10, boxShadow: "0 1px 4px rgba(0,0,0,0.04)" }}>
      <button
        onClick={function () { setOpen(!open); }}
        aria-expanded={open}
        style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, width: "100%", background: "transparent", border: "none", cursor: "pointer", padding: 0, textAlign: "left" }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: textColor, marginBottom: 2 }}>{title + " · " + liveCount}</span>
        <span style={{ fontSize: 11, color: textColor, fontWeight: 700, flexShrink: 0 }}>{open ? "▲" : "▼"}</span>
      </button>
      <Reveal show={open}>
        <div>
          {renderIds.map(function (id) {
            return (
              <Reveal key={id} show={openIds.has(id)}>
                {renderRow(id)}
              </Reveal>
            );
          })}
        </div>
      </Reveal>
    </div>
  );
}
