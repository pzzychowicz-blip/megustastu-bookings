import { Toast, mkBtn, BTN, R, T, FW, H, SP } from "megustastu-bookings";
import { Surface } from "./_shared/frame";

// The app's ONE toast pane (StatusToasts): the colour lives in the leading dot.
function Pane({ tone, children }: { tone: string; children?: any }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: SP.base, background: "var(--bg-ac-menu)", border: "1px solid var(--border-card)", borderRadius: R.card, padding: "8px 14px", fontSize: T.body, fontWeight: FW.semi, color: "var(--text-primary)", boxShadow: "var(--shadow-popover)", width: "fit-content" }}>
      <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: "50%", background: tone, flexShrink: 0 }} />
      {children}
    </div>
  );
}

export const Messages = () => (
  <Surface>
    <div style={{ display: "flex", flexDirection: "column", gap: SP.wide, alignItems: "center" }}>
      <Toast show={true}><Pane tone="var(--status-online)">Reconnected — changes synced.</Pane></Toast>
      <Toast show={true}><Pane tone="var(--success-text)">Added to the waitlist.</Pane></Toast>
      <Toast show={true}><Pane tone="var(--warn-text)">Table 7 is blocked 21:00–22:00.</Pane></Toast>
    </div>
  </Surface>
);

export const WithUndo = () => (
  <Surface>
    <div style={{ display: "flex", justifyContent: "center" }}>
      <Toast show={true}>
        <Pane tone="var(--text-muted)">
          <span>Booking cancelled · Ana Ruiz, 19:30</span>
          <button style={mkBtn({ fontSize: T.body, minHeight: H.compact, padding: "4px 12px", background: BTN.nav })}>Undo</button>
        </Pane>
      </Toast>
    </div>
  </Surface>
);

export const DarkTheme = () => (
  <Surface dark>
    <div style={{ display: "flex", justifyContent: "center" }}>
      <Toast show={true}><Pane tone="var(--status-connecting)">Loading bookings…</Pane></Toast>
    </div>
  </Surface>
);
