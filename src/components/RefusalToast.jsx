// ── RefusalToast ─────────────────────────────────────────────────────────────
// v18.4.5: the refusal toast ("You don't have permission to …", ⇧D under
// Automatic dark mode, a drop on no table) in a layer of its own, ABOVE every
// modal and popup.
//
// It was one of StatusToasts' one-slot toasts, and that layer is inside the main
// view at z-index 60 while every `Overlay` is at 200. So a tap refused from
// INSIDE a modal — Accept, Open booking and Apply changes in the WhatsApp inbox
// since v18.3.5, anything in Settings — drew its answer under the dialog, and on
// a phone, where the dialog is a sheet over the whole view, the tap looked like
// it did nothing. A control that silently no-ops reads as broken, which is the
// reason `refused` raises a toast at all.
//
// Four properties, each load-bearing:
//  • ALWAYS mounted, and its own `role="status"` region. A live region must
//    already be in the DOM when its content changes (StatusToasts' note), and
//    this one sits at the app's root, outside the `inert` view, so it is
//    announced with a modal open.
//  • `position: fixed` at the root, z-index above the popups (300 / 301 — the
//    highest layer the app draws). Fixed, not absolute, because z-index only
//    competes inside a stacking context and the main view's wrapper is one.
//  • `pointerEvents: none`: it is drawn over a dialog's controls for 3.5s and
//    must never take the tap meant for them.
//  • NO `backdrop-filter` — the pill is the opaque `ToastPill`, so this layer
//    adds nothing to the four-blur budget.
//
// `msg` is `{text, show, top, left, width} | null`. App keeps the box and the
// text in the message when it turns `show` off, so the pill fades out where it
// was, still saying what it said.
import { Toast, ToastPill } from "./atoms";

// Above PopupShell's scrim (300) and the popup cards (301).
const REFUSAL_Z = 400;

export function RefusalToast({ msg }) {
  const box = msg || { top: 0, left: 0, width: 0 };
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: "fixed", top: box.top, left: box.left, width: box.width || "100%",
        zIndex: REFUSAL_Z, boxSizing: "border-box",
        display: "flex", justifyContent: "center", alignItems: "flex-start",
        padding: "6px 12px 0", pointerEvents: "none",
      }}>
      <div style={{ width: "100%", maxWidth: 360, display: "grid", justifyItems: "center", textAlign: "center" }}>
        <Toast show={!!msg && msg.show} style={{ width: "fit-content", justifySelf: "center" }}>
          {msg ? <ToastPill tone="var(--warn-text)">{msg.text}</ToastPill> : null}
        </Toast>
      </div>
    </div>
  );
}
