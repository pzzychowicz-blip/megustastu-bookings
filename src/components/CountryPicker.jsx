// src/components/CountryPicker.jsx
//
// v18.1.0 — a searchable picker over the world's calling codes: a pill
// showing the chosen country's flag and code, opening a list you can filter by
// name, ISO code or digits, with the restaurant's PINNED countries on top.
// Patryk's choice over a native <select>: 240 rows is a scroll wheel on the
// tablets, and a waiter who hears "we're from Belgium" wants to type "bel".
//
// ── Where the list is drawn ──────────────────────────────────────────────────
// The menu is `position: absolute` against the nearest POSITIONED ancestor,
// and this component deliberately is not one (its root is `display:contents`).
// So the caller decides how wide the list is: the phone field wraps picker +
// number in one `position:relative` row and the list spans both, which is
// what fits a country's full name at half a form column's width. The root
// still owns the outside-click test — `contains()` walks the DOM tree, which
// `display:contents` does not change.
//
// ── Keyboard ─────────────────────────────────────────────────────────────────
// The search box is a combobox (aria-activedescendant over a listbox): ↑/↓
// move, Enter picks, Tab leaves and closes. **Escape closes THIS and nothing
// else** — `useKeyboardShortcuts` owns Escape on a WINDOW listener in the
// bubble phase and would close the whole booking form, so the key stops at the
// search box. React's `stopPropagation` stops the native event at the root
// container, which is below `window`, so this is sufficient.
//
// Rows use `useAcRow`, the booking form's tap-vs-scroll handling, so a swipe
// through the list scrolls it rather than picking whichever country the
// finger landed on.

import { useState, useRef, useEffect, useId } from "react";
import { S, T, FW, SP, IC } from "../lib/constants";
import { mkInp } from "./atoms";
import { ChevronDownIcon, CheckIcon } from "./Icons";
import { useAcRow, AC_MENU, AC_ROW } from "../hooks/useAcRow";
import { COUNTRIES, countryByIso, flagOf, dialLabel, matchesCountry } from "../lib/phone-countries";

const HEAD = {
  padding: "6px 12px", fontSize: T.micro, fontWeight: FW.bold, color: S.muted,
  textTransform: "uppercase", letterSpacing: "0.04em",
};

export function CountryPicker({ iso, onPick, pinned, ariaLabel = "Country code", style, disabled = false }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const rootRef = useRef(null);
  const btnRef = useRef(null);
  const listRef = useRef(null);
  const uid = useId();
  const acRow = useAcRow();
  const cur = countryByIso(iso);

  // The rows on screen, in order. Unfiltered: pinned first, then every country
  // (a pinned one appears in both, as in every phone app — the long list is
  // the complete alphabet and should not have holes in it). Filtered: one list.
  const pins = (pinned || []).map(countryByIso).filter(Boolean);
  const all = q ? COUNTRIES.filter(function (c) { return matchesCountry(c, q); }) : COUNTRIES;
  const rows = q ? all.map(function (c) { return { c: c, sec: "all" }; })
    : pins.map(function (c) { return { c: c, sec: "pin" }; }).concat(all.map(function (c) { return { c: c, sec: "all" }; }));

  function close(refocus) {
    setOpen(false);
    setQ("");
    if (refocus && btnRef.current) btnRef.current.focus();
  }
  function pick(c) {
    onPick(c.iso);
    close(true);
  }
  function openList() {
    if (disabled) return;
    // Start on the current country, so Enter without moving is a no-op.
    const at = rows.findIndex(function (r) { return cur && r.c.iso === cur.iso; });
    setActive(at < 0 ? 0 : at);
    setOpen(true);
  }

  // Outside press closes. Capture phase, so a control that stops propagation
  // (the timeline, a stepper) cannot leave the list hanging open.
  useEffect(function () {
    if (!open) return undefined;
    function onDown(e) { if (rootRef.current && !rootRef.current.contains(e.target)) close(false); }
    document.addEventListener("pointerdown", onDown, true);
    return function () { document.removeEventListener("pointerdown", onDown, true); };
  }, [open]);

  // Keep the active row visible while arrowing. `block: nearest` scrolls the
  // list and nothing above it unless the list itself is off screen.
  useEffect(function () {
    if (!open || !listRef.current) return;
    const el = listRef.current.querySelector('[data-idx="' + active + '"]');
    if (el && el.scrollIntoView) el.scrollIntoView({ block: "nearest" });
  }, [open, active]);

  function onKey(e) {
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(true); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); setActive(function (a) { return Math.min(rows.length - 1, a + 1); }); return; }
    if (e.key === "ArrowUp") { e.preventDefault(); setActive(function (a) { return Math.max(0, a - 1); }); return; }
    if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); if (rows[active]) pick(rows[active].c); return; }
    if (e.key === "Tab") close(false);
  }

  const listId = uid + "-list";
  const optId = function (i) { return uid + "-opt-" + i; };
  const firstAll = rows.findIndex(function (r) { return r.sec === "all"; });

  return (
    <div ref={rootRef} style={{ display: "contents" }}>
      <button
        ref={btnRef}
        type="button"
        className="mgt-hover-scale"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel + ": " + (cur ? cur.name + " " + dialLabel(cur) : "none")}
        onClick={function () { if (open) close(false); else openList(); }}
        style={Object.assign({}, mkInp(), {
          width: "auto", flexShrink: 0, display: "flex", alignItems: "center", gap: SP.snug,
          cursor: disabled ? "default" : "pointer", whiteSpace: "nowrap",
        }, style)}
      >
        <span aria-hidden="true">{cur ? flagOf(cur.iso) : ""}</span>
        <span>{cur ? dialLabel(cur) : "+"}</span>
        <span aria-hidden="true" style={{ color: S.muted, display: "flex" }}><ChevronDownIcon size={IC.inline} /></span>
      </button>
      {open ? (
        <div style={Object.assign({}, AC_MENU, { display: "flex", flexDirection: "column", overflowY: "hidden", maxHeight: 320 /* @canvas the search box plus AC_MENU's 264 of list */ })}>
          <div style={{ padding: SP.base, borderBottom: "1px solid var(--border-soft)", flexShrink: 0 }}>
            <input
              autoFocus
              className="mgt-hover-scale"
              value={q}
              onChange={function (e) { setQ(e.target.value); setActive(0); }}
              onKeyDown={onKey}
              placeholder="Search country or code"
              role="combobox"
              aria-label="Search country or code"
              aria-expanded="true"
              aria-controls={listId}
              aria-autocomplete="list"
              aria-activedescendant={rows[active] ? optId(active) : undefined}
              style={mkInp()}
            />
          </div>
          <div ref={listRef} id={listId} role="listbox" aria-label="Countries" style={{ overflowY: "auto", flex: 1, minHeight: 0 }}>
            {rows.length === 0 ? (
              <div style={{ padding: "10px 12px", fontSize: T.body, color: S.muted }}>No country matches</div>
            ) : null}
            {rows.map(function (r, i) {
              const sel = cur && r.c.iso === cur.iso;
              return (
                <div key={r.sec + r.c.iso} role="presentation">
                  {!q && i === 0 && pins.length ? <div style={HEAD} aria-hidden="true">Pinned</div> : null}
                  {!q && i === firstAll && pins.length ? <div style={HEAD} aria-hidden="true">All countries</div> : null}
                  <div
                    id={optId(i)}
                    data-idx={i}
                    role="option"
                    aria-selected={!!sel}
                    className="mgt-ac-row"
                    {...acRow(function () { pick(r.c); })}
                    onMouseEnter={function () { setActive(i); }}
                    /* The keyboard's current row wears the hover tint through --row-bg:
                       an inline `background` would beat the stylesheet's
                       hover rule outright (the SearchField note in atoms.jsx). */
                    style={Object.assign({}, AC_ROW, i === active ? { "--row-bg": "var(--bg-ac-hover)" } : null)}
                  >
                    <span aria-hidden="true" style={{ fontSize: T.lead, flexShrink: 0 }}>{flagOf(r.c.iso)}</span>
                    <span style={{ flex: 1, minWidth: 0, fontSize: T.body, fontWeight: sel ? FW.bold : FW.medium, color: S.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.c.name}</span>
                    <span style={{ fontSize: T.body, color: S.muted, flexShrink: 0 }}>{dialLabel(r.c)}</span>
                    {sel ? <span aria-hidden="true" style={{ color: "var(--accent)", display: "flex", flexShrink: 0 }}><CheckIcon size={IC.inline} /></span> : null}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
