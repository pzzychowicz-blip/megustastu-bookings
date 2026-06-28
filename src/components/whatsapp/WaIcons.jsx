// src/components/whatsapp/WaIcons.jsx
// Small inline-SVG icons for the WhatsApp inbox. Stroke-based so they inherit
// the host button's `color` via currentColor — theme-aware (dark mode) with no
// extra tokens. pointerEvents:none so the parent button owns all clicks.
//
// TemplatesIcon — a document (folded top-right corner) with three text lines.
//   Used for: the panel-header "Templates" button (replaces "⚙ Templates") and
//   the composer "Templates" toggle (replaces the text "Templates ▸" button).
// SelectIcon — a checkbox with a tick. Toggles multi-select mode in the inbox.

export function TemplatesIcon({ size = 16, color = "currentColor" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      style={{ pointerEvents: "none", display: "block" }} aria-hidden="true">
      {/* Page outline with a folded top-right corner */}
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5" />
      {/* Three text lines */}
      <line x1="8.5" y1="12.5" x2="15.5" y2="12.5" />
      <line x1="8.5" y1="15.5" x2="15.5" y2="15.5" />
      <line x1="8.5" y1="18" x2="13" y2="18" />
    </svg>
  );
}

export function SelectIcon({ size = 16, color = "currentColor" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      style={{ pointerEvents: "none", display: "block" }} aria-hidden="true">
      {/* Checkbox */}
      <rect x="3" y="3" width="18" height="18" rx="4" />
      {/* Tick */}
      <path d="M8 12.5l2.5 2.5L16 9" />
    </svg>
  );
}
