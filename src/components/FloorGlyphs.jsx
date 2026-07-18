// src/components/FloorGlyphs.jsx
//
// v17.1.0 — the pure floor-plan SVG geometry, extracted from FloorPlanEditor
// so PlanView (always in the main chunk — it's a main view) and the editor
// (lazy-loaded with Settings, Tier 3 code-splitting) can share it WITHOUT the
// Plan view dragging the whole editor into the main bundle.
//
// Multi-export exception (like atoms.jsx): chairPositions + TableGlyph +
// DoorGlyph are one geometry unit — the editor and the live view must draw
// identical shapes.

import { TBL } from "../lib/constants";
import { isIn } from "../lib/booking-logic";

// ── Pure geometry (shared editor ↔ PlanView) ────────────────────────────────
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
