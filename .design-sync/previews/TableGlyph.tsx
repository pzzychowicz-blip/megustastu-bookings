import { TableGlyph, StatusIcon, BLOCK_BG, BLOCK_INK, IC } from "megustastu-bookings";
import { Surface } from "./_shared/frame";

const OCCUPIED = "rgba(255,255,255,0.5)";

// PlanView's own placement: centred under the id pill, in the status ink.
function Mark({ status }: { status: string }) {
  return (
    <g transform={"translate(" + (-IC.control / 2) + ",11)"} style={{ color: BLOCK_INK[status] }}>
      <StatusIcon status={status} size={IC.control} />
    </g>
  );
}

function Room({ children, h = 200 }: { children?: any; h?: number }) {
  return <svg viewBox={"0 0 520 " + h} width="100%" style={{ display: "block", maxWidth: 520 }}>{children}</svg>;
}

export const ShapesAndChairs = () => (
  <Surface>
    <Room>
      <TableGlyph id="2" entry={{ x: 90, y: 100, shape: "round", w: 80, chairs: { top: 1, right: 1, bottom: 1, left: 1 } }} fill="var(--bg-card)" stroke="var(--fp-outline)" />
      <TableGlyph id="5A" entry={{ x: 260, y: 100, shape: "rect", w: 130, h: 70, chairs: { top: 2, bottom: 2 } }} fill="var(--bg-card)" stroke="var(--fp-outline)" />
      <TableGlyph id="i3" entry={{ x: 430, y: 100, shape: "square", w: 80, chairs: { top: 1, bottom: 1, left: 1, right: 1 } }} fill="var(--bg-card)" stroke="var(--fp-outline)" />
    </Room>
  </Surface>
);

export const Occupancy = () => (
  <Surface>
    <Room>
      <TableGlyph id="3" entry={{ x: 90, y: 100, shape: "round", w: 80, chairs: { top: 1, right: 1, bottom: 1, left: 1 } }} fill={BLOCK_BG.seated} stroke={OCCUPIED}>
        <Mark status="seated" />
      </TableGlyph>
      <TableGlyph id="5A" entry={{ x: 260, y: 100, shape: "rect", w: 130, h: 70, chairs: { top: 2, bottom: 2 } }} fill={BLOCK_BG.confirmed} stroke={OCCUPIED}>
        <Mark status="confirmed" />
      </TableGlyph>
      <TableGlyph id="7" entry={{ x: 430, y: 100, shape: "rect", w: 70, h: 110, rot: 90, chairs: { left: 2, right: 2 } }} fill="var(--bg-card)" stroke="var(--text-muted)" strokeDasharray="4 3" />
    </Room>
  </Surface>
);

export const DarkTheme = () => (
  <Surface dark>
    <Room h={180}>
      <TableGlyph id="i1" entry={{ x: 130, y: 90, shape: "square", w: 80, chairs: { top: 1, bottom: 1, left: 1, right: 1 } }} fill="var(--bg-card)" stroke="var(--fp-outline)" />
      <TableGlyph id="1A" entry={{ x: 330, y: 90, shape: "rect", w: 120, h: 70, chairs: { top: 2, bottom: 2 } }} fill={BLOCK_BG.pending} stroke={OCCUPIED}>
        <Mark status="pending" />
      </TableGlyph>
    </Room>
  </Surface>
);
