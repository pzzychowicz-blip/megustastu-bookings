// src/components/NotificationStrip.jsx
// v17.8.0 — ONE pane for every in-flow notification.
//
// ── The problem it solves ────────────────────────────────────────────────────
// Six independent banners could be live at once — offline, write-error,
// inefficiency, overlap warnings, running-late, waitlist-table-free, plus the
// reminder rows — each its own pane with its own margin, stacked. On a busy
// evening (which is exactly when several of them fire together) they pushed the
// timeline off the bottom of the tablet: the alerts displaced the thing the
// alerts are about. Each one was dismissible, but dismissing costs the taps a
// host does not have between parties.
//
// v17.8.0's earlier pass made them all LOOK like one system. This makes them
// BE one: a single pane whose collapsed height is one row, no matter how many
// notifications are live. That is the property that matters — the cost of a bad
// evening stops scaling with how bad it is.
//
// ── Contract ─────────────────────────────────────────────────────────────────
// App builds `sections`, ordered by severity (see ORDER at the call site):
//   { id, tone, title, count, node }
// `node` is the section's already-rendered body — the banner components still
// own their own rows, actions and per-row Reveal lifecycle, unchanged. This
// component owns only the pane, the collapse, and the separators.
//
// Collapsed, it shows the FIRST section (highest severity) plus "+N more". The
// section list is pre-sorted by App rather than here so severity stays one
// decision in one place, next to the flags that produce it.
//
// `startOpen` comes from settings/general.lateCollapseMax, which used to mean
// "collapse a banner with more than N rows". It now means the same thing about
// the strip as a whole, so the setting keeps working and gains reach.

import { useState } from "react";
import { Reveal } from "./atoms";
import { R } from "../lib/constants";

export function NotificationStrip({ sections, collapseMax = 2 }) {
  const total = sections.reduce(function (n, s) { return n + (s.count || 1); }, 0);
  // Initial-only, like BannerRows' own collapse was: a strip the user opened
  // must not slam shut because a seventh late booking arrived.
  const [open, setOpen] = useState(function () { return total <= collapseMax; });

  if (!sections.length) return null;
  const top = sections[0];
  const others = sections.length - 1;

  return (
    <div style={{
      background: top.tint || "var(--app-overlap-bg)",
      border: "1px solid var(--border-card)",
      borderRadius: R.card,
      marginBottom: 10,
      boxShadow: "var(--shadow-soft)",
      overflow: "hidden"
    }}>
      <button
        onClick={function () { setOpen(!open); }}
        aria-expanded={open}
        aria-label={open ? "Collapse notifications" : "Expand notifications"}
        // No press-scale: this is a full-width strip header, and a 0.96 dip on
        // something that spans the viewport reads as the page flinching.
        className="mgt-nopress"
        style={{
          display: "flex", alignItems: "center", gap: 9, width: "100%",
          background: "transparent", border: "none", cursor: "pointer",
          padding: "10px 14px", textAlign: "left"
        }}>
        <span aria-hidden="true" style={{
          width: 8, height: 8, borderRadius: "50%", background: top.tone, flexShrink: 0
        }} />
        {/* Collapsed, the strip summarises the WORST thing happening plus a
            count of the rest. With ONE section live, naming it here beats a generic lid plus a
            redundant sub-header underneath — so the strip simply becomes that
            banner. With several, "Notifications" is the honest label for the
            lid and each section names itself below. */}
        <span style={{ fontSize: 13, fontWeight: 700, color: top.tone, flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {open && sections.length > 1 ? "Notifications" : top.title}
        </span>
        {!open && others > 0 ? (
          <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", flexShrink: 0 }}>
            {"+" + others + " more"}
          </span>
        ) : null}
        <span style={{
          fontSize: 11, fontWeight: 700, color: top.tone, opacity: 0.75,
          fontVariantNumeric: "tabular-nums", flexShrink: 0
        }}>{total}</span>
        <span style={{ fontSize: 10, color: top.tone, opacity: 0.6, fontWeight: 700, flexShrink: 0 }}>{open ? "▲" : "▼"}</span>
      </button>
      <Reveal show={open}>
        {/* .mgt-notif draws the hairlines between sections (index.html). A CSS
            adjacent-sibling rule rather than a per-section borderTop prop, so a
            section never has to know its own position in the list. */}
        <div className="mgt-notif">
          {sections.map(function (s) {
            return (
              <div key={s.id}>
                {sections.length > 1 ? (
                  <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "9px 14px 1px" }}>
                    <span aria-hidden="true" style={{
                      width: 8, height: 8, borderRadius: "50%", background: s.tone, flexShrink: 0
                    }} />
                    <span style={{ fontSize: 13, fontWeight: 700, color: s.tone, flex: 1, minWidth: 0 }}>{s.title}</span>
                    {s.count > 1 ? (
                      <span style={{
                        fontSize: 11, fontWeight: 700, color: s.tone, opacity: 0.75,
                        fontVariantNumeric: "tabular-nums", flexShrink: 0
                      }}>{s.count}</span>
                    ) : null}
                  </div>
                ) : null}
                {s.node}
              </div>
            );
          })}
        </div>
      </Reveal>
    </div>
  );
}
