import { DoorGlyph, TableGlyph } from "megustastu-bookings";
import { Surface } from "./_shared/frame";

export const InAWall = () => (
  <Surface>
    <svg viewBox="0 0 520 200" width="100%" style={{ display: "block", maxWidth: 520 }}>
      <line x1={20} y1={170} x2={500} y2={170} stroke="var(--text-muted)" strokeWidth={6} strokeLinecap="round" />
      <DoorGlyph door={{ x: 140, y: 170, width: 80, rot: 0 }} />
      <DoorGlyph door={{ x: 380, y: 170, width: 80, rot: 0, flip: true }} selected />
      <TableGlyph id="4" entry={{ x: 260, y: 80, shape: "round", w: 70, chairs: { top: 1, right: 1, bottom: 1, left: 1 } }} fill="var(--bg-card)" stroke="var(--fp-outline)" />
    </svg>
  </Surface>
);

export const DarkTheme = () => (
  <Surface dark>
    <svg viewBox="0 0 520 160" width="100%" style={{ display: "block", maxWidth: 520 }}>
      <line x1={20} y1={130} x2={500} y2={130} stroke="var(--text-muted)" strokeWidth={6} strokeLinecap="round" />
      <DoorGlyph door={{ x: 260, y: 130, width: 90, rot: 0 }} />
    </svg>
  </Surface>
);
