// ── SettingsUndoToast ────────────────────────────────────────────────────────
// v18.19.1 (Patryk): the Undo pill for Settings → Layout. The same pill as the
// app's own Undo (`ToastPill`, a neutral dot, the sentence and an accent Undo
// button), drawn in the Settings dialog's FOOTER, left of Close.
//
// Patryk first chose the pill floating above the dialog in RefusalToast's
// place. Measured on DEV that put it over the tab body (the Combos row on a
// phone, the Tables row on the tablet), and because it stays until Settings
// closes, a tap meant for that row hit Undo. The footer's left side is empty on
// every width, so there it covers nothing (his second answer). Being INSIDE the
// footer rather than fixed over it is what keeps it there: the card eases its
// height as a section opens, and a fixed layer measured once would be left
// behind. It is also inside the dialog's focus trap, so Tab reaches Undo.
//
// The region is mounted with the footer, before the first step, because a
// live region added together with its first message announces nothing.
// `pill` is `{text, undo, show}` (useSettingsUndo); a pill that goes off keeps
// its text, so it fades out still saying it.
import { Toast, ToastPill, mkBtn } from "./atoms";
import { T, H } from "../lib/constants";
import { keyHint } from "../lib/shortcuts";

export function SettingsUndoToast({ pill, onUndo }) {
  const on = !!pill && pill.show;
  return (
    <div role="status" aria-live="polite" style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center" }}>
      <Toast show={on} style={{ maxWidth: "100%" }}>
        {pill && pill.text ? (
          <ToastPill tone={pill.undo ? "var(--text-muted)" : "var(--warn-text)"}
            style={pill.undo ? { padding: "6px 10px 6px 14px", textAlign: "left" } : { textAlign: "left" }}>
            {pill.undo ? (
              <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ minWidth: 0 }}>{pill.text}</span>
                <button type="button"
                  onClick={onUndo}
                  title={"Take back the change this message names" + keyHint("settingsUndo")}
                  className="mgt-hover-scale mgt-press"
                  style={mkBtn({ fontSize: T.body, minHeight: H.compact, padding: "4px 12px", background: "var(--accent)", flexShrink: 0 })}>Undo</button>
              </span>
            ) : pill.text}
          </ToastPill>
        ) : null}
      </Toast>
    </div>
  );
}
