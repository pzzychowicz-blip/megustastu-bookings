// Shared by the modal previews — not a component of the design system.
//
// `Overlay` is `position: fixed; inset: 0`. The preview card wraps each cell in
// a transformed element, and a transform makes an ancestor the containing
// block for fixed children — so with nothing else in the cell, the modal is
// centred in a box of zero height and half of it lands above the card. The
// stage gives that containing block a real size (its own transform makes IT
// the block), and paints an app page behind the scrim for the blur to act on.
import { useEffect } from "react";
import { BLOCK_BG, R, T, FW, SP } from "megustastu-bookings";

const ROWS = [
  ["19:30", "Ana Ruiz", "confirmed"],
  ["20:00", "Marco Bianchi", "seated"],
  ["20:15", "Familia Pérez", "pending"],
  ["21:00", "Sophie Martin", "confirmed"],
];

export function ModalStage({ dark = false, height = 680, children }: { dark?: boolean; height?: number; children?: any }) {
  // Overlay focuses its dialog on mount. With no pointer interaction before it,
  // the browser treats that as keyboard focus and draws the focus ring round
  // the whole card — which is not what anyone sees after tapping a button. The
  // stage's effect runs after the Overlay's (parents after children), so this
  // shows the resting look. Keyboard focus still rings in the app itself.
  useEffect(() => {
    const el = document.activeElement as HTMLElement | null;
    if (el && el !== document.body && typeof el.blur === "function") el.blur();
  }, []);
  return (
    <div
      data-theme={dark ? "dark" : undefined}
      style={{ position: "relative", height, transform: "translateZ(0)", overflow: "hidden", borderRadius: 10, background: "var(--bg-app)", color: "var(--text-primary)", fontFamily: "var(--font-app)" }}
    >
      <div style={{ padding: SP.section }}>
        <div style={{ fontSize: T.display, fontWeight: FW.bold, marginBottom: SP.gutter }}>Me Gustas Tú</div>
        <div style={{ display: "flex", flexDirection: "column", gap: SP.base }}>
          {ROWS.map(([t, n, s]) => (
            <div key={n} style={{ display: "flex", alignItems: "center", gap: SP.wide, background: "var(--bg-card-strong)", border: "1px solid var(--border-card)", borderRadius: R.card, padding: "12px 14px" }}>
              <span style={{ fontSize: T.title, fontWeight: FW.bold, fontVariantNumeric: "tabular-nums" }}>{t}</span>
              <span style={{ fontSize: T.title, fontWeight: FW.semi, flex: 1 }}>{n}</span>
              <span style={{ width: 64, height: 12, borderRadius: 6, background: BLOCK_BG[s] }} />
            </div>
          ))}
        </div>
      </div>
      {children}
    </div>
  );
}
