// ── The Claude Design bundle's entry (/design-sync) ───────────────────────────
// Everything the design agent on claude.ai/design gets on window.MGTBookings:
// the shared UI kit, its token scales and icons, and the app's signature views.
// Nothing here is a copy — every line re-exports the module the app ships, and
// .design-sync/vite.lib.config.mjs compiles it with the app's own Vite + React
// plugin (so JSX uses the same automatic runtime as the app).
//
// Deliberately ABSENT: the five components whose import graph reaches
// src/firebase.js (Settings, AdminSettings, VouchersSettings, LoginScreen,
// WaSimulator). Importing one initialises Firebase, which has no place inside
// a design. Check a new export's import graph before adding it here.

// The stylesheet: the app's own, then the one design-only override (Inter as
// --font-app — see design-font.css). Vite emits both, in this order, as
// .design-sync/.lib/index.css, which config.json's cssEntry points at.
import "../src/index.css";
import "./design-font.css";

// Tokens — the role-named scales (S, BTN, R, T, FW, SP, H, IC, M, BLOCK_BG,
// BLOCK_INK, STATUS_COLORS, TBL …) every component styles itself with.
export * from "../src/lib/constants.js";

// The UI kit — atoms, the mkBtn / mkInp style factories, and the icon sets.
export * from "../src/components/atoms.jsx";
export * from "../src/components/Icons.jsx";
export * from "../src/components/FloorGlyphs.jsx";
export * from "../src/components/whatsapp/WaIcons.jsx";

// The signature views — what staff recognise the app by.
export { TimelineView } from "../src/components/TimelineView.jsx";
export { TableGrid } from "../src/components/TableGrid.jsx";
export { PlanView } from "../src/components/PlanView.jsx";
export { ListView } from "../src/components/ListView.jsx";
export { WeekView } from "../src/components/WeekView.jsx";
export { BookingFormModal } from "../src/components/BookingFormModal.jsx";
export { MessageBubble } from "../src/components/whatsapp/MessageBubble.jsx";
