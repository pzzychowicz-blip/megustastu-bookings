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
import { S, T, FW, SP, IC, EXIT_MS } from "../lib/constants";
import { afterFrame } from "../lib/after-frame";
import { mkInp } from "./atoms";
import { ChevronDownIcon, CheckIcon } from "./Icons";
import { useAcRow, AC_MENU, AC_ROW } from "../hooks/useAcRow";
import { useMenuRoom } from "../hooks/useMenuRoom";
import { COUNTRIES, countryByIso, flagOf, dialLabel, matchesCountry } from "../lib/phone-countries";

// The search box plus AC_MENU's 264 of list. `useMenuRoom` takes it lower where
// the form's footer or the keyboard leaves less.
const MENU_TALL = 320;

const HEAD = {
  padding: "6px 12px", fontSize: T.micro, fontWeight: FW.bold, color: S.muted,
  textTransform: "uppercase", letterSpacing: "0.04em",
};

// `label` turns the pill into an ACTION ("+ Add country") rather than a
// readout of the current choice: Settings' pinned-list editor picks a country
// to add, and has no "current" one to show. Its name is then the label itself.
export function CountryPicker({ iso, onPick, pinned, exclude, ariaLabel = "Country code", label, style, disabled = false }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  // v18.14.0 (correction 31, Patryk): the menu fades in and out, on the pair for a
  // popover anchored to its trigger. Not `Presence`, which mounts a commit after its
  // `show`: the search box has to take focus inside the tap or iOS opens no keyboard.
  // The list stays as it is for the exit, so `q` clears when that ends, and the
  // leaving copy is inert, so neither a tap nor a Tab can land in it.
  const [leaving, setLeaving] = useState(false);
  // The menu's key, one more on every open. A tap during the exit would keep the
  // leaving node, and `autoFocus` belongs to a mount: focus stayed on the pill, the
  // box drew no caret and typing reached nothing, measured 80ms into the exit.
  const [opens, setOpens] = useState(0);
  const rootRef = useRef(null);
  const btnRef = useRef(null);
  const listRef = useRef(null);
  const menuRef = useRef(null);
  const uid = useId();
  const acRow = useAcRow();
  const cur = countryByIso(iso);
  useMenuRoom(menuRef, open, MENU_TALL);

  // The rows on screen, in order. Unfiltered: pinned first, then every country
  // (a pinned one appears in both, as in every phone app — the long list is
  // the complete alphabet and should not have holes in it). Filtered: one list.
  const pins = (pinned || []).map(countryByIso).filter(Boolean);
  // `exclude`: countries not to offer at all (the pinned editor's "add" list
  // leaves out what is already pinned, or the second tap on Spain does nothing).
  const offer = exclude && exclude.length ? COUNTRIES.filter(function (c) { return exclude.indexOf(c.iso) < 0; }) : COUNTRIES;
  const all = q ? offer.filter(function (c) { return matchesCountry(c, q); }) : offer;
  const rows = q ? all.map(function (c) { return { c: c, sec: "all" }; })
    : pins.map(function (c) { return { c: c, sec: "pin" }; }).concat(all.map(function (c) { return { c: c, sec: "all" }; }));

  function close(refocus) {
    setOpen(false);
    setLeaving(true);
    if (refocus && btnRef.current) btnRef.current.focus();
  }
  useEffect(function () {
    if (!leaving) return undefined;
    return afterFrame(function () { setLeaving(false); setQ(""); }, EXIT_MS);
  }, [leaving]);
  function pick(c) {
    onPick(c.iso);
    close(true);
  }
  function openList() {
    if (disabled) return;
    // Start on the current country, so Enter without moving is a no-op.
    const at = rows.findIndex(function (r) { return cur && r.c.iso === cur.iso; });
    setActive(at < 0 ? 0 : at);
    setLeaving(false);
    setQ("");
    setOpens(function (n) { return n + 1; });
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
        aria-label={label ? undefined : ariaLabel + ": " + (cur ? cur.name + " " + dialLabel(cur) : "none")}
        onClick={function () { if (open) close(false); else openList(); }}
        style={Object.assign({}, mkInp(), {
          width: "auto", flexShrink: 0, display: "flex", alignItems: "center", gap: SP.snug,
          cursor: disabled ? "default" : "pointer", whiteSpace: "nowrap",
        }, style)}
      >
        {/* v18.2.0 phase 19: with no country the pill reads "Code", muted
            like the chevron beside it and like the number box's placeholder
            — a prompt, not a value. It used to read "+", which nothing showed
            because the booking form always passed a default country.
            v18.14.0 (correction 12): its own token, because in Dark the muted
            ink reads 3.94:1 on a field's fill. */}
        {label ? <span>{label}</span> : cur ? <>
          <span aria-hidden="true">{flagOf(cur.iso)}</span>
          <span>{dialLabel(cur)}</span>
        </> : <span style={{ color: "var(--field-prompt)" }}>Code</span>}
        <span aria-hidden="true" style={{ color: S.muted, display: "flex" }}><ChevronDownIcon size={IC.inline} /></span>
      </button>
      {open || leaving ? (
        <div ref={menuRef} key={opens} className={open ? "mgt-pop-in" : "mgt-pop-out"} inert={!open} style={Object.assign({}, AC_MENU, { transformOrigin: "top left", display: "flex", flexDirection: "column", overflowY: "hidden", maxHeight: MENU_TALL })}>
          <div style={{ padding: SP.base, borderBottom: "1px solid var(--border-soft)", flexShrink: 0 }}>
            <input
              autoFocus
              className="mgt-hover-scale"
              value={q}
              onChange={function (e) { setQ(e.target.value); setActive(0); }}
              onKeyDown={onKey}
              placeholder="Search country or code"
              /* v18.14.2: a country's name is no word to correct. Typing "pol"
                 on an iPad with a Polish keyboard raised iOS's "Pół" bubble,
                 which stayed on the screen after the form had closed. */
              autoCorrect="off"
              autoCapitalize="none"
              spellCheck={false}
              role="combobox"
              aria-label="Search country or code"
              aria-expanded="true"
              aria-controls={listId}
              aria-autocomplete="list"
              aria-activedescendant={rows[active] ? optId(active) : undefined}
              style={mkInp()}
            />
          </div>
          <div ref={listRef} id={listId} role="listbox" aria-label="Countries" style={{ overflowY: "auto", overscrollBehavior: "contain", flex: 1, minHeight: 0 }}>
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
