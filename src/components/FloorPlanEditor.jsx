// src/components/FloorPlanEditor.jsx
//
// v17.0.0 — the drag-&-drop floor-plan editor (Settings → Layout → "Floor
// plan") + the shared SVG table glyph the Plan view reuses.
//
// The floor plan lives on settings/layout.floorPlan (see useLayout.js
// sanitizeFloorPlan for the shape + sanitize contract). This editor mutates it
// through the parent's onSaveLayout — the existing layoutRev CAS path — so
// every committed edit is one guarded write. During a DRAG the position lives
// in local state only; the write happens once, on pointer-up.
//
// Multi-export exception (like Settings.jsx): this file also exports the pure
// geometry helpers + <TableGlyph> so PlanView renders identical shapes without
// duplicating the chair math.
//
// Interaction model:
//   • mode "select" — tap/click an element to select it (inspector below);
//     drag tables/doors to move (snap 10). Walls are delete-and-redraw.
//   • mode "wall"   — two clicks: start point, end point → wall committed.
//   • mode "door"   — one click places a door (rotate/size in the inspector).
// Tables are added/removed in the Tables editor above, never here — the plan
// only positions what exists (a new table gets an auto slot via sanitize).

import { useState, useRef, useEffect } from "react";
import { S, TBL } from "../lib/constants";
import { isIn } from "../lib/booking-logic";
import { mkBtn } from "./atoms";

// ── Pure geometry (shared with PlanView) ────────────────────────────────────
// Chair centers in TABLE-LOCAL coordinates (origin = table center, unrotated).
export function chairPositions(entry){
  const w = entry.w, h = entry.shape === "rect" ? entry.h : entry.w;
  const ch = entry.chairs || {};
  const out = [];
  const off = 11; // chair-center distance beyond the table edge
  if(entry.shape === "round"){
    const total = (ch.top || 0) + (ch.right || 0) + (ch.bottom || 0) + (ch.left || 0);
    const r = Math.max(w, h) / 2 + off;
    for(let i = 0; i < total; i++){
      const a = -Math.PI / 2 + (i * 2 * Math.PI) / total;
      out.push({ cx: Math.cos(a) * r, cy: Math.sin(a) * r });
    }
    return out;
  }
  const spread = function(n, len){ const p = []; for(let i = 0; i < n; i++) p.push(-len / 2 + (len * (i + 0.5)) / n); return p; };
  spread(ch.top || 0, w).forEach(function(x){ out.push({ cx: x, cy: -h / 2 - off }); });
  spread(ch.bottom || 0, w).forEach(function(x){ out.push({ cx: x, cy: h / 2 + off }); });
  spread(ch.left || 0, h).forEach(function(y){ out.push({ cx: -w / 2 - off, cy: y }); });
  spread(ch.right || 0, h).forEach(function(y){ out.push({ cx: w / 2 + off, cy: y }); });
  return out;
}

// One table as an SVG group: shape + chairs + the id label pill (the timeline
// TBadge identity — indoor purple / outdoor blue hue). The label counter-
// rotates so text stays horizontal at any table rotation. `fill`/`stroke`
// carry the occupancy colour in PlanView; the editor passes neutrals.
// Extra children (countdown pills etc.) render above the label.
export function TableGlyph({ id, entry, fill, stroke, strokeWidth = 2, strokeDasharray, labelSuffix = "", chairFill = "var(--bg-stepper)", children, onPointerDown, onClick, onContextMenu, style }){
  const w = entry.w, h = entry.shape === "rect" ? entry.h : entry.w;
  const t = TBL[isIn(id) ? "ind" : "out"];
  const label = id + labelSuffix;
  const lw = Math.max(26, label.length * 7.5 + 12);
  return (
    <g transform={"translate(" + entry.x + "," + entry.y + ") rotate(" + (entry.rot || 0) + ")"}
      onPointerDown={onPointerDown} onClick={onClick} onContextMenu={onContextMenu}
      style={{ cursor: onPointerDown ? "grab" : (onClick ? "pointer" : "default"), ...style }}>
      {chairPositions(entry).map(function(c, i){
        return <circle key={i} cx={c.cx} cy={c.cy} r={6} fill={chairFill} stroke="var(--fp-chair-outline)" strokeWidth={1.5} />;
      })}
      {entry.shape === "round"
        ? <circle cx={0} cy={0} r={w / 2} fill={fill} stroke={stroke} strokeWidth={strokeWidth} strokeDasharray={strokeDasharray} />
        : <rect x={-w / 2} y={-h / 2} width={w} height={h} rx={entry.shape === "square" ? 10 : 12} fill={fill} stroke={stroke} strokeWidth={strokeWidth} strokeDasharray={strokeDasharray} />}
      <g transform={"rotate(" + (-(entry.rot || 0)) + ")"}>
        <rect x={-lw / 2} y={-9} width={lw} height={18} rx={9} fill={t.bg} stroke={t.border} strokeWidth={1} />
        <text x={0} y={4} textAnchor="middle" fontSize={11} fontWeight={700} fill="var(--text-on-accent)" style={{ pointerEvents: "none", userSelect: "none" }}>{label}</text>
        {children}
      </g>
    </g>
  );
}

// A door: a wall-gap bar + a quarter-circle swing arc. `flip` (v17.0.0
// correction) mirrors the swing side — hinge left (default) ↔ hinge right —
// via a scale(-1,1) wrapper (the bar is x-symmetric, only arc+hinge mirror).
export function DoorGlyph({ door, selected, onPointerDown, onClick }){
  const w = door.width;
  return (
    <g transform={"translate(" + door.x + "," + door.y + ") rotate(" + (door.rot || 0) + ")"}
      onPointerDown={onPointerDown} onClick={onClick}
      style={{ cursor: onPointerDown ? "grab" : "default" }}>
      <line x1={-w / 2} y1={0} x2={w / 2} y2={0} stroke={selected ? "var(--accent)" : "var(--text-muted)"} strokeWidth={5} strokeLinecap="round" />
      {/* v17.0.0 round 9 (Patryk): invisible fat hit-band over the 5cm bar —
          on a touch screen the painted strokes were a few px and selection
          rarely caught. 44cm tall, slightly wider than the bar; pointer events
          bubble to the g's handlers. */}
      <rect x={-w / 2 - 10} y={-22} width={w + 20} height={44} fill="transparent" pointerEvents="fill" />
      <g transform={door.flip ? "scale(-1,1)" : undefined}>
        {/* swing arc from the hinge (left end pre-flip) */}
        <path d={"M " + (w / 2) + " 0 A " + w + " " + w + " 0 0 0 " + (-w / 2) + " " + (-w) + ""}
          fill="none" stroke={selected ? "var(--accent)" : "var(--text-faint)"} strokeWidth={1.5} strokeDasharray="4 4" />
        <line x1={-w / 2} y1={0} x2={-w / 2} y2={-w} stroke={selected ? "var(--accent)" : "var(--text-muted)"} strokeWidth={2.5} strokeLinecap="round" />
      </g>
    </g>
  );
}

const SNAP = 10;
function snap(n){ return Math.round(n / SNAP) * SNAP; }

// Tiny labelled stepper (local — Settings' HourStepper isn't exported).
function Step({ label, value, fmt, onDec, onInc, disableDec, disableInc }){
  const btn = {
    background: "var(--bg-stepper)", border: "1px solid var(--border-soft)", borderRadius: 8,
    width: 28, height: 28, fontSize: 15, fontWeight: 600, color: "var(--text-primary)",
    display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, boxShadow: "var(--shadow-input)"
  };
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 4 }}>{label}</div>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <button onClick={onDec} disabled={disableDec} className={disableDec ? undefined : "mgt-hover-scale"}
          style={{ ...btn, opacity: disableDec ? 0.4 : 1, cursor: disableDec ? "not-allowed" : "pointer" }}>−</button>
        <span style={{ minWidth: 46, textAlign: "center", fontSize: 13, fontWeight: 700, color: "var(--text-primary)" }}>{fmt ? fmt(value) : value}</span>
        <button onClick={onInc} disabled={disableInc} className={disableInc ? undefined : "mgt-hover-scale"}
          style={{ ...btn, opacity: disableInc ? 0.4 : 1, cursor: disableInc ? "not-allowed" : "pointer" }}>+</button>
      </div>
    </div>
  );
}

export function FloorPlanEditor({ layout, onSaveLayout = () => {} }){
  const fp = layout.floorPlan || { v: 1, room: { w: 900, h: 600 }, tables: {}, walls: [], doors: [] };
  const tables = Array.isArray(layout.tables) ? layout.tables : [];
  const capOf = {}; tables.forEach(function(t){ capOf[t.id] = t.capacity; });

  const [mode, setMode] = useState("select");            // select | wall | door
  const [sel, setSel] = useState(null);                  // {type,id|index}
  const [wallStart, setWallStart] = useState(null);      // {x,y} first click in wall mode
  const [hoverPt, setHoverPt] = useState(null);          // wall-preview end point
  // During a drag the moving element's position lives here; committed on pointer-up.
  const [dragPos, setDragPos] = useState(null);          // {type,id|index,x,y}
  const dragRef = useRef(null);                          // {type,id|index,dx,dy}
  const svgRef = useRef(null);
  // v17.0.0 correction round 6: zoom/pan via the viewBox window. {k, x, y} =
  // magnification + top-left origin (world cm). k=1,x=0,y=0 shows the whole room.
  const [zoom, setZoom] = useState({ k: 1, x: 0, y: 0 });
  const panRef = useRef(null);                           // {sx,sy,ox,oy,moved} while panning empty canvas
  const vbW = fp.room.w / zoom.k, vbH = fp.room.h / zoom.k;

  function commitFp(next){ onSaveLayout({ ...layout, floorPlan: next }); }

  // v17.0.0 round 7 (iOS fix): iOS Safari IGNORES touch-action on SVG elements,
  // so the inline `touchAction:"none"` below does nothing there — the first
  // touchmove scrolled the Settings modal instead, the browser fired
  // pointercancel, and every drag died ("drag and drop does nothing" on iPad).
  // A NATIVE non-passive touchmove listener that preventDefault()s while the
  // finger is on the canvas keeps the gesture ours (the Timeline drag's React-
  // 17-passive-root lesson: preventDefault in a React touch handler is a no-op).
  useEffect(function(){
    const svg = svgRef.current;
    if(!svg) return;
    const block = function(ev){ ev.preventDefault(); };
    svg.addEventListener("touchmove", block, { passive: false });
    return function(){ svg.removeEventListener("touchmove", block); };
  }, []);

  // Client → floor-plan coordinates (viewBox scaling + zoom window).
  function toFp(e){
    const svg = svgRef.current;
    if(!svg) return { x: 0, y: 0 };
    const r = svg.getBoundingClientRect();
    return { x: zoom.x + (e.clientX - r.left) * (vbW / r.width), y: zoom.y + (e.clientY - r.top) * (vbH / r.height) };
  }
  // Zoom keeping the current view centre fixed; clamp origin inside the room.
  function zoomBy(factor){
    setZoom(function(z){
      const k = Math.max(1, Math.min(4, z.k * factor));
      const zw = fp.room.w / z.k, zh = fp.room.h / z.k, cx = z.x + zw / 2, cy = z.y + zh / 2;
      const nw = fp.room.w / k, nh = fp.room.h / k;
      return { k: k, x: Math.max(0, Math.min(fp.room.w - nw, cx - nw / 2)), y: Math.max(0, Math.min(fp.room.h - nh, cy - nh / 2)) };
    });
  }
  function resetZoom(){ setZoom({ k: 1, x: 0, y: 0 }); }

  function startDrag(e, type, key, cur, extra){
    if(mode !== "select") return;
    e.preventDefault(); e.stopPropagation();
    // Wall drags select the WALL (endpoint handles are wall sub-parts).
    setSel({ type: type.indexOf("wall") === 0 ? "wall" : type, key: key });
    const p = toFp(e);
    dragRef.current = { type: type, key: key, dx: cur.x - p.x, dy: cur.y - p.y, ...(extra || {}) };
    try{ e.currentTarget.ownerSVGElement.setPointerCapture(e.pointerId); }catch(_e){}
  }
  function onMove(e){
    if(panRef.current){
      const svg = svgRef.current, r = svg.getBoundingClientRect();
      if(Math.abs(e.clientX - panRef.current.sx) > 3 || Math.abs(e.clientY - panRef.current.sy) > 3) panRef.current.moved = true;
      const dx = (e.clientX - panRef.current.sx) * (vbW / r.width), dy = (e.clientY - panRef.current.sy) * (vbH / r.height);
      setZoom(function(z){ return { ...z, x: Math.max(0, Math.min(fp.room.w - vbW, panRef.current.ox - dx)), y: Math.max(0, Math.min(fp.room.h - vbH, panRef.current.oy - dy)) }; });
      return;
    }
    if(mode === "wall" && wallStart){ setHoverPt(toFp(e)); return; }
    const d = dragRef.current;
    if(!d) return;
    const p = toFp(e);
    setDragPos({ type: d.type, key: d.key, x: snap(p.x + d.dx), y: snap(p.y + d.dy) });
  }
  function onUp(){
    if(panRef.current){ const moved = panRef.current.moved; panRef.current = null; if(!moved) setSel(null); return; }
    const d = dragRef.current;
    if(d && dragPos && dragPos.type === d.type && dragPos.key === d.key){
      if(d.type === "table"){
        commitFp({ ...fp, tables: { ...fp.tables, [d.key]: { ...fp.tables[d.key], x: dragPos.x, y: dragPos.y } } });
      } else if(d.type === "door"){
        commitFp({ ...fp, doors: fp.doors.map(function(dr, i){ return i === d.key ? { ...dr, x: dragPos.x, y: dragPos.y } : dr; }) });
      } else if(d.type === "wallA" || d.type === "wallB"){
        // v17.0.0 correction: draggable wall endpoints (full wall editing).
        commitFp({ ...fp, walls: fp.walls.map(function(wl, i){
          if(i !== d.key) return wl;
          return d.type === "wallA" ? { ...wl, x1: dragPos.x, y1: dragPos.y } : { ...wl, x2: dragPos.x, y2: dragPos.y };
        }) });
      } else if(d.type === "wallBody"){
        // dragPos = the new A endpoint; move both ends by the same delta.
        const ddx = dragPos.x - d.ax, ddy = dragPos.y - d.ay;
        commitFp({ ...fp, walls: fp.walls.map(function(wl, i){
          return i === d.key ? { x1: wl.x1 + ddx, y1: wl.y1 + ddy, x2: wl.x2 + ddx, y2: wl.y2 + ddy } : wl;
        }) });
      }
    }
    dragRef.current = null;
    setDragPos(null);
  }
  function onCanvasDown(e){
    const p = toFp(e);
    if(mode === "wall"){
      if(!wallStart){ setWallStart({ x: snap(p.x), y: snap(p.y) }); }
      else {
        commitFp({ ...fp, walls: fp.walls.concat([{ x1: wallStart.x, y1: wallStart.y, x2: snap(p.x), y2: snap(p.y) }]) });
        setWallStart(null); setHoverPt(null); setMode("select");
      }
      return;
    }
    if(mode === "door"){
      commitFp({ ...fp, doors: fp.doors.concat([{ x: snap(p.x), y: snap(p.y), rot: 0, width: 80 }]) });
      setSel({ type: "door", key: fp.doors.length });
      setMode("select");
      return;
    }
    // select-mode empty-canvas press: pan when zoomed (deselect on a clean tap).
    if(zoom.k > 1){ panRef.current = { sx: e.clientX, sy: e.clientY, ox: zoom.x, oy: zoom.y, moved: false }; return; }
    setSel(null);
  }

  function entryOf(id){
    const e = fp.tables[id];
    if(dragPos && dragPos.type === "table" && dragPos.key === id) return { ...e, x: dragPos.x, y: dragPos.y };
    return e;
  }
  function doorOf(i){
    const d = fp.doors[i];
    if(dragPos && dragPos.type === "door" && dragPos.key === i) return { ...d, x: dragPos.x, y: dragPos.y };
    return d;
  }
  function wallOf(i){
    const wl = fp.walls[i];
    if(!dragPos || dragPos.key !== i) return wl;
    if(dragPos.type === "wallA") return { ...wl, x1: dragPos.x, y1: dragPos.y };
    if(dragPos.type === "wallB") return { ...wl, x2: dragPos.x, y2: dragPos.y };
    if(dragPos.type === "wallBody"){
      const d = dragRef.current || {};
      const ddx = dragPos.x - (d.ax || 0), ddy = dragPos.y - (d.ay || 0);
      return { x1: wl.x1 + ddx, y1: wl.y1 + ddy, x2: wl.x2 + ddx, y2: wl.y2 + ddy };
    }
    return wl;
  }
  function patchTable(id, patch){
    commitFp({ ...fp, tables: { ...fp.tables, [id]: { ...fp.tables[id], ...patch } } });
  }
  function patchDoor(i, patch){
    commitFp({ ...fp, doors: fp.doors.map(function(d, j){ return j === i ? { ...d, ...patch } : d; }) });
  }

  // ── Inspector for the current selection ────────────────────────────────────
  let inspector = null;
  if(sel && sel.type === "table" && fp.tables[sel.key]){
    const id = sel.key, e = fp.tables[id];
    const chairs = e.chairs || { top: 0, right: 0, bottom: 0, left: 0 };
    const totalChairs = (chairs.top || 0) + (chairs.right || 0) + (chairs.bottom || 0) + (chairs.left || 0);
    const cap = capOf[id] || 0;
    const chairStep = function(side, lbl){
      return <Step key={side} label={lbl} value={chairs[side] || 0}
        disableDec={(chairs[side] || 0) <= 0} disableInc={(chairs[side] || 0) >= 12}
        onDec={function(){ patchTable(id, { chairs: { ...chairs, [side]: (chairs[side] || 0) - 1 } }); }}
        onInc={function(){ patchTable(id, { chairs: { ...chairs, [side]: (chairs[side] || 0) + 1 } }); }} />;
    };
    inspector = (
      <div>
        <div style={{ fontSize: 13, fontWeight: 700, color: S.text, marginBottom: 8 }}>{"Table " + id + " · seats " + cap}</div>
        <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
          {["round", "square", "rect"].map(function(sh){
            return <button key={sh} onClick={function(){ patchTable(id, { shape: sh }); }}
              className="mgt-hover-scale"
              style={mkBtn({ fontSize: 12, minHeight: 32, padding: "4px 12px", background: e.shape === sh ? S.accent : "var(--app-btn-grey)", textTransform: "capitalize" })}>{sh === "rect" ? "Rectangle" : sh}</button>;
          })}
        </div>
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 12 }}>
          <Step label={e.shape === "rect" ? "Width" : "Size"} value={e.w} fmt={function(n){ return n + " cm"; }}
            disableDec={e.w <= 30} disableInc={e.w >= 400}
            onDec={function(){ patchTable(id, { w: e.w - 10 }); }} onInc={function(){ patchTable(id, { w: e.w + 10 }); }} />
          {e.shape === "rect" ? (
            <Step label="Height" value={e.h} fmt={function(n){ return n + " cm"; }}
              disableDec={e.h <= 30} disableInc={e.h >= 400}
              onDec={function(){ patchTable(id, { h: e.h - 10 }); }} onInc={function(){ patchTable(id, { h: e.h + 10 }); }} />
          ) : null}
          <Step label="Rotation" value={e.rot || 0} fmt={function(n){ return n + "°"; }}
            disableDec={false} disableInc={false}
            onDec={function(){ patchTable(id, { rot: ((e.rot || 0) + 345) % 360 }); }} onInc={function(){ patchTable(id, { rot: ((e.rot || 0) + 15) % 360 }); }} />
        </div>
        <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 6 }}>
          {e.shape === "round" ? "Chairs (spread evenly around)" : "Chairs per side"}
        </div>
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
          {e.shape === "round"
            ? [chairStep("top", "Chairs")]
            : [chairStep("top", "Top"), chairStep("right", "Right"), chairStep("bottom", "Bottom"), chairStep("left", "Left")]}
        </div>
        {totalChairs !== cap ? (
          <div style={{ fontSize: 12, fontWeight: 600, color: "var(--warn-text)", marginTop: 8 }}>
            {totalChairs + " chair" + (totalChairs !== 1 ? "s" : "") + " drawn, but the table seats " + cap + " (capacity is set in the Tables editor above)."}
          </div>
        ) : null}
      </div>
    );
  } else if(sel && sel.type === "door" && fp.doors[sel.key]){
    const i = sel.key, d = fp.doors[i];
    inspector = (
      <div>
        <div style={{ fontSize: 13, fontWeight: 700, color: S.text, marginBottom: 8 }}>Door</div>
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "flex-end" }}>
          <Step label="Rotation" value={d.rot || 0} fmt={function(n){ return n + "°"; }}
            onDec={function(){ patchDoor(i, { rot: ((d.rot || 0) + 345) % 360 }); }} onInc={function(){ patchDoor(i, { rot: ((d.rot || 0) + 15) % 360 }); }} />
          <Step label="Width" value={d.width} fmt={function(n){ return n + " cm"; }}
            disableDec={d.width <= 40} disableInc={d.width >= 300}
            onDec={function(){ patchDoor(i, { width: d.width - 10 }); }} onInc={function(){ patchDoor(i, { width: d.width + 10 }); }} />
          {/* v17.0.0 correction: which side the door opens toward (hinge side) */}
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 4 }}>Opens</div>
            <div style={{ display: "flex", gap: 6 }}>
              {[["left", !d.flip], ["right", !!d.flip]].map(function(o){
                return <button key={o[0]} onClick={function(){ patchDoor(i, { flip: o[0] === "right" }); }}
                  className="mgt-hover-scale"
                  style={mkBtn({ fontSize: 12, minHeight: 32, padding: "4px 12px", background: o[1] ? S.accent : "var(--app-btn-grey)", textTransform: "capitalize" })}>{o[0]}</button>;
              })}
            </div>
          </div>
          <button onClick={function(){ commitFp({ ...fp, doors: fp.doors.filter(function(_, j){ return j !== i; }) }); setSel(null); }}
            className="mgt-hover-scale" style={mkBtn({ fontSize: 12, minHeight: 32, padding: "4px 12px", background: "var(--btn-del)" })}>Delete door</button>
        </div>
      </div>
    );
  } else if(sel && sel.type === "wall" && fp.walls[sel.key]){
    const i = sel.key, wl = fp.walls[i];
    const len = Math.round(Math.sqrt(Math.pow(wl.x2 - wl.x1, 2) + Math.pow(wl.y2 - wl.y1, 2)));
    inspector = (
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: S.text }}>{"Wall · " + len + " cm"}</div>
        <button onClick={function(){ commitFp({ ...fp, walls: fp.walls.filter(function(_, j){ return j !== i; }) }); setSel(null); }}
          className="mgt-hover-scale" style={mkBtn({ fontSize: 12, minHeight: 32, padding: "4px 12px", background: "var(--btn-del)" })}>Delete wall</button>
        <span style={{ fontSize: 12, color: S.muted }}>Drag the wall to move it, or drag its endpoint handles to reshape it.</span>
      </div>
    );
  }

  const modeBtn = function(m, lbl){
    return <button key={m} onClick={function(){ setMode(m); setWallStart(null); setHoverPt(null); }}
      className="mgt-hover-scale"
      style={mkBtn({ fontSize: 12, minHeight: 32, padding: "4px 12px", background: mode === m ? S.accent : "var(--app-btn-grey)" })}>{lbl}</button>;
  };

  return (
    <div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginBottom: 10 }}>
        {modeBtn("select", "Select / move")}
        {modeBtn("wall", "+ Wall")}
        {modeBtn("door", "+ Door")}
        {/* v17.0.0 correction round 6: zoom controls */}
        <div style={{ display: "flex", gap: 4, marginLeft: 6, alignItems: "center" }}>
          <button onClick={function(){ zoomBy(1 / 1.25); }} disabled={zoom.k <= 1} className={zoom.k <= 1 ? undefined : "mgt-hover-scale"}
            style={mkBtn({ fontSize: 15, fontWeight: 700, minHeight: 32, width: 34, padding: 0, background: "var(--app-btn-grey)", opacity: zoom.k <= 1 ? 0.4 : 1 })}>−</button>
          <span style={{ fontSize: 11, color: S.muted, minWidth: 30, textAlign: "center", fontVariantNumeric: "tabular-nums" }}>{Math.round(zoom.k * 100) + "%"}</span>
          <button onClick={function(){ zoomBy(1.25); }} disabled={zoom.k >= 4} className={zoom.k >= 4 ? undefined : "mgt-hover-scale"}
            style={mkBtn({ fontSize: 15, fontWeight: 700, minHeight: 32, width: 34, padding: 0, background: "var(--app-btn-grey)", opacity: zoom.k >= 4 ? 0.4 : 1 })}>+</button>
          <button onClick={resetZoom} disabled={zoom.k === 1 && zoom.x === 0 && zoom.y === 0} className={zoom.k === 1 && zoom.x === 0 && zoom.y === 0 ? undefined : "mgt-hover-scale"}
            style={mkBtn({ fontSize: 12, minHeight: 32, padding: "4px 10px", background: "var(--app-btn-grey)", opacity: zoom.k === 1 && zoom.x === 0 && zoom.y === 0 ? 0.4 : 1 })}>Reset</button>
        </div>
        <span style={{ fontSize: 12, color: S.muted, marginLeft: 6 }}>
          {mode === "wall" ? (wallStart ? "Tap the wall's END point." : "Tap the wall's START point.")
            : mode === "door" ? "Tap where the door sits."
            : "Tap an element to edit it; drag tables and doors to move them."}
        </span>
      </div>
      <div style={{ borderRadius: 14, overflow: "hidden", border: "1px solid var(--border-soft)", background: "var(--bg-soft)" }}>
        <svg ref={svgRef} viewBox={zoom.x + " " + zoom.y + " " + vbW + " " + vbH} style={{ display: "block", width: "100%", touchAction: "none", cursor: zoom.k > 1 && mode === "select" ? "grab" : "default" }}
          onPointerDown={onCanvasDown} onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={onUp}>
          {/* grid: minor 50 cm + stronger major every 250 cm (v17.0.0 round 6 — more visible) */}
          <defs>
            <pattern id="fp-grid" width={50} height={50} patternUnits="userSpaceOnUse">
              <path d={"M 50 0 L 0 0 0 50"} fill="none" stroke="var(--fp-grid)" strokeWidth={1} />
            </pattern>
            <pattern id="fp-grid-major" width={250} height={250} patternUnits="userSpaceOnUse">
              <path d={"M 250 0 L 0 0 0 250"} fill="none" stroke="var(--fp-outline)" strokeWidth={1.5} />
            </pattern>
          </defs>
          <rect x={0} y={0} width={fp.room.w} height={fp.room.h} fill="var(--bg-card)" />
          <rect x={0} y={0} width={fp.room.w} height={fp.room.h} fill="url(#fp-grid)" />
          <rect x={0} y={0} width={fp.room.w} height={fp.room.h} fill="url(#fp-grid-major)" />
          {fp.walls.map(function(wl0, i){
            const wl = wallOf(i);
            const selWall = sel && sel.type === "wall" && sel.key === i;
            return (
              <g key={"w" + i}>
                <line x1={wl.x1} y1={wl.y1} x2={wl.x2} y2={wl.y2}
                  stroke={selWall ? "var(--accent)" : "var(--text-muted)"} strokeWidth={7} strokeLinecap="round" />
                {/* v17.0.0 round 9 (Patryk): invisible FAT hit-line — the visible
                    7-unit stroke is 7 CM, ~5px on screen, near-impossible to tap.
                    The 40cm transparent band carries the pointer handler instead;
                    tables render later (on top) so they still win overlaps. */}
                <line x1={wl.x1} y1={wl.y1} x2={wl.x2} y2={wl.y2}
                  stroke="transparent" strokeWidth={40} strokeLinecap="round" pointerEvents="stroke"
                  style={{ cursor: mode === "select" ? "grab" : "pointer" }}
                  onPointerDown={function(e){ startDrag(e, "wallBody", i, { x: wl0.x1, y: wl0.y1 }, { ax: wl0.x1, ay: wl0.y1 }); }} />
                {selWall ? (
                  <>
                    {/* v17.0.0 correction: draggable endpoint handles (round 9:
                        each visible r=9 dot gets an invisible r=24 hit circle) */}
                    <circle cx={wl.x1} cy={wl.y1} r={9} fill="var(--accent)" stroke="#fff" strokeWidth={2} />
                    <circle cx={wl.x1} cy={wl.y1} r={24} fill="transparent" pointerEvents="fill"
                      style={{ cursor: "move" }}
                      onPointerDown={function(e){ startDrag(e, "wallA", i, { x: wl0.x1, y: wl0.y1 }); }} />
                    <circle cx={wl.x2} cy={wl.y2} r={9} fill="var(--accent)" stroke="#fff" strokeWidth={2} />
                    <circle cx={wl.x2} cy={wl.y2} r={24} fill="transparent" pointerEvents="fill"
                      style={{ cursor: "move" }}
                      onPointerDown={function(e){ startDrag(e, "wallB", i, { x: wl0.x2, y: wl0.y2 }); }} />
                  </>
                ) : null}
              </g>
            );
          })}
          {wallStart ? (
            <>
              <circle cx={wallStart.x} cy={wallStart.y} r={5} fill="var(--accent)" />
              {hoverPt ? <line x1={wallStart.x} y1={wallStart.y} x2={snap(hoverPt.x)} y2={snap(hoverPt.y)} stroke="var(--accent)" strokeWidth={4} strokeDasharray="6 6" strokeLinecap="round" /> : null}
            </>
          ) : null}
          {fp.doors.map(function(_, i){
            const d = doorOf(i);
            return <DoorGlyph key={"d" + i} door={d} selected={sel && sel.type === "door" && sel.key === i}
              onPointerDown={function(e){ startDrag(e, "door", i, d); }} />;
          })}
          {tables.map(function(t){
            const e = entryOf(t.id);
            if(!e) return null;
            const selT = sel && sel.type === "table" && sel.key === t.id;
            return <TableGlyph key={t.id} id={t.id} entry={e}
              fill="var(--bg-card)" stroke={selT ? "var(--accent)" : "var(--fp-outline)"} strokeWidth={selT ? 3 : 2}
              onPointerDown={function(ev){ startDrag(ev, "table", t.id, e); }} />;
          })}
        </svg>
      </div>
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "flex-end", marginTop: 12 }}>
        <Step label="Room width" value={fp.room.w} fmt={function(n){ return n + " cm"; }}
          disableDec={fp.room.w <= 300} disableInc={fp.room.w >= 4000}
          onDec={function(){ commitFp({ ...fp, room: { ...fp.room, w: fp.room.w - 50 } }); }}
          onInc={function(){ commitFp({ ...fp, room: { ...fp.room, w: fp.room.w + 50 } }); }} />
        <Step label="Room height" value={fp.room.h} fmt={function(n){ return n + " cm"; }}
          disableDec={fp.room.h <= 300} disableInc={fp.room.h >= 4000}
          onDec={function(){ commitFp({ ...fp, room: { ...fp.room, h: fp.room.h - 50 } }); }}
          onInc={function(){ commitFp({ ...fp, room: { ...fp.room, h: fp.room.h + 50 } }); }} />
      </div>
      {inspector ? (
        <div style={{ marginTop: 14, padding: "12px 14px", borderRadius: 14, background: "var(--bg-input)", border: "1px solid var(--border-input)" }}>
          {inspector}
        </div>
      ) : null}
      <div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 10 }}>
        All distances are in centimeters — grid squares are 50 cm, positions snap to 10 cm.
        The plan mirrors your Tables list — add, remove or rename tables in the Tables editor above; new tables appear here automatically. Shared across all devices.
      </div>
    </div>
  );
}
