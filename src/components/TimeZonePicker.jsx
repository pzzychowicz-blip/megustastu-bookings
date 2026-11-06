// src/components/TimeZonePicker.jsx
//
// v18.15.0 — where the restaurant is, picked from every zone the engine knows
// (about 420), searchable by place, region or offset ("canary", "europe",
// "utc+1"). Settings → General commits on the pick, like the pinned countries.
//
// It is `CountryPicker`'s shape, deliberately, and not a second design: a pill
// that opens a search box over a listbox, rows through `useAcRow` (so a swipe
// through the list scrolls rather than picks), ↑/↓/Enter/Tab, and Escape that
// closes THIS and nothing else (`useKeyboardShortcuts` owns Escape on a window
// listener and would close Settings). The menu is `position: absolute`
// against the caller's positioned wrapper, as there. The comments in
// CountryPicker.jsx explain each of those choices; they are not repeated here.
//
// ONE difference, on purpose: the row handlers are the shared
// `acRowHandlersFor`, called at EVENT time from one set on the listbox, which
// finds its row by `data-idx`. Spread per row (`{...acRow(fn)}`, CountryPicker's
// way) they cost 420 handler objects a render, and the React Compiler reads the
// ref inside them as a ref read during render, a lint warning past the cap. The
// tap-versus-scroll logic is the same function either way.

import { useState, useRef, useEffect, useId, useMemo } from "react";
import { S, T, FW, SP, IC, EXIT_MS } from "../lib/constants";
import { afterFrame } from "../lib/after-frame";
import { mkInp } from "./atoms";
import { ChevronDownIcon, CheckIcon } from "./Icons";
import { acRowHandlersFor, AC_MENU, AC_ROW } from "../hooks/useAcRow";
import { useMenuRoom } from "../hooks/useMenuRoom";
import { zoneList, zoneName, offsetLabel, matchesZone } from "../lib/time-zones";

const MENU_TALL = 320;

export function TimeZonePicker({ value, onPick, ariaLabel = "Time zone", style }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const [leaving, setLeaving] = useState(false);
  const [opens, setOpens] = useState(0);
  const rootRef = useRef(null);
  const btnRef = useRef(null);
  const listRef = useRef(null);
  const menuRef = useRef(null);
  const uid = useId();
  const touchRef = useRef({ x: 0, y: 0, scroll: false, ts: 0 });
  useMenuRoom(menuRef, open, MENU_TALL);

  // Offsets are read at "now" (`offsetLabel`'s default), ONCE per opening, and
  // both the rows and the search read that map (the v18.15.0 /code-review: read
  // per row and again per keystroke, the list rebuilt every zone's label on each
  // render, a hover included). A row could relabel only if a clock change
  // happened while the list was open. `listUp` stays true through the exit fade,
  // so the closing list keeps its labels.
  const listUp = open || leaving;
  const all = useMemo(function () { return zoneList(value); }, [value]);
  const offsets = useMemo(function () {
    const m = new Map();
    if (listUp) for (const tz of all) m.set(tz, offsetLabel(tz));
    return m;
  }, [all, listUp]);
  const rows = useMemo(function () {
    return q ? all.filter(function (tz) { return matchesZone(tz, q, undefined, offsets.get(tz)); }) : all;
  }, [all, q, offsets]);

  function close(refocus) {
    setOpen(false);
    setLeaving(true);
    if (refocus && btnRef.current) btnRef.current.focus();
  }
  useEffect(function () {
    if (!leaving) return undefined;
    return afterFrame(function () { setLeaving(false); setQ(""); }, EXIT_MS);
  }, [leaving]);
  function pick(tz) {
    onPick(tz);
    close(true);
  }
  function openList() {
    const idx = all.indexOf(value);
    setActive(idx < 0 ? 0 : idx);
    setLeaving(false);
    setQ("");
    setOpens(function (n) { return n + 1; });
    setOpen(true);
  }

  useEffect(function () {
    if (!open) return undefined;
    function onDown(e) { if (rootRef.current && !rootRef.current.contains(e.target)) close(false); }
    document.addEventListener("pointerdown", onDown, true);
    return function () { document.removeEventListener("pointerdown", onDown, true); };
  }, [open]);

  useEffect(function () {
    if (!open || !listRef.current) return;
    const el = listRef.current.querySelector('[data-idx="' + active + '"]');
    if (el && el.scrollIntoView) el.scrollIntoView({ block: "nearest" });
  }, [open, active]);

  function onKey(e) {
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(true); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); setActive(function (a) { return Math.min(rows.length - 1, a + 1); }); return; }
    if (e.key === "ArrowUp") { e.preventDefault(); setActive(function (a) { return Math.max(0, a - 1); }); return; }
    if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); if (rows[active]) pick(rows[active]); return; }
    if (e.key === "Tab") close(false);
  }

  // The listbox's handlers: the row under the event, then the shared logic.
  // A press outside any row (the "no match" line) does nothing at all.
  function onRow(e, kind) {
    const el = e.target && e.target.closest ? e.target.closest("[data-idx]") : null;
    const tz = el ? rows[Number(el.getAttribute("data-idx"))] : undefined;
    if (!tz) return;
    acRowHandlersFor(touchRef, function () { pick(tz); })[kind](e);
  }

  const listId = uid + "-list";
  const optId = function (i) { return uid + "-opt-" + i; };
  const shown = value ? zoneName(value) : "Device's own";
  const offset = value ? offsetLabel(value) : "";

  return (
    <div ref={rootRef} style={{ display: "contents" }}>
      <button
        ref={btnRef}
        type="button"
        className="mgt-hover-scale"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel + ": " + shown + (offset ? ", " + offset : "")}
        onClick={function () { if (open) close(false); else openList(); }}
        style={Object.assign({}, mkInp(), {
          width: "auto", maxWidth: "100%", display: "flex", alignItems: "center", gap: SP.snug,
          cursor: "pointer", whiteSpace: "nowrap",
        }, style)}
      >
        <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{shown}</span>
        {offset ? <span style={{ color: S.muted }}>{offset}</span> : null}
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
              placeholder="Search place or UTC offset"
              autoCorrect="off"
              autoCapitalize="none"
              spellCheck={false}
              role="combobox"
              aria-label="Search place or UTC offset"
              aria-expanded="true"
              aria-controls={listId}
              aria-autocomplete="list"
              aria-activedescendant={rows[active] ? optId(active) : undefined}
              style={mkInp()}
            />
          </div>
          <div ref={listRef} id={listId} role="listbox" aria-label="Time zones"
            onMouseDown={function (e) { onRow(e, "onMouseDown"); }}
            onTouchStart={function (e) { onRow(e, "onTouchStart"); }}
            onTouchMove={function (e) { onRow(e, "onTouchMove"); }}
            onTouchEnd={function (e) { onRow(e, "onTouchEnd"); }}
            style={{ overflowY: "auto", overscrollBehavior: "contain", flex: 1, minHeight: 0 }}>
            {rows.length === 0 ? (
              <div style={{ padding: "10px 12px", fontSize: T.body, color: S.muted }}>No time zone matches</div>
            ) : null}
            {rows.map(function (tz, i) {
              const sel = tz === value;
              return (
                <div
                  key={tz}
                  id={optId(i)}
                  data-idx={i}
                  role="option"
                  aria-selected={sel}
                  className="mgt-ac-row"
                  onMouseEnter={function () { setActive(i); }}
                  style={Object.assign({}, AC_ROW, i === active ? { "--row-bg": "var(--bg-ac-hover)" } : null)}
                >
                  <span style={{ flex: 1, minWidth: 0, fontSize: T.body, fontWeight: sel ? FW.bold : FW.medium, color: S.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{zoneName(tz)}</span>
                  <span style={{ fontSize: T.body, color: S.muted, flexShrink: 0 }}>{offsets.get(tz)}</span>
                  {sel ? <span aria-hidden="true" style={{ color: "var(--accent)", display: "flex", flexShrink: 0 }}><CheckIcon size={IC.inline} /></span> : null}
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
