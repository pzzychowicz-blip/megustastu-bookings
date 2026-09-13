// src/lib/waSandbox.js
//
// WA_SANDBOX — single source of truth for "should the WhatsApp simulator
// surfaces (the 🧪 panel, the __waSim console helpers, the WaSimulator modal)
// be available?".
//
//   · true in the Vite dev server               (import.meta.env.DEV)
//   · true in a deployed sandbox build that sets VITE_FB_TARGET=dev
//     (the online WA sandbox on its own Vercel project — see firebase.js)
//   · false in the real production build         (var unset → DEV false)
//
// Before this, the simulator gated on import.meta.env.DEV alone, which is false
// in ANY `vite build` — so a deployed sandbox would lose the simulator entirely.
// Widening to VITE_FB_TARGET keeps it for the online sandbox while still
// stripping it from a true prod build (the var is only set on the sandbox
// Vercel project). CLIENT-ONLY: never import this from api/ (Node has no
// import.meta.env) — keep it out of the shared src/lib/whatsapp.js.
//
// NB the simulator's "backend mode" (src/lib/wa-backend.js) stays gated on
// import.meta.env.DEV: it targets the local harness at :3999, which does not
// exist in a deployed build. Online, the panel runs in client-side sim mode
// (writes DEV Firebase directly). Driving the real deployed /api/ pipeline from
// the simulator would need a server-side signature bypass on the public webhook
// — a deliberate follow-up, not enabled here.
export const WA_SANDBOX =
  import.meta.env.VITE_FB_TARGET === "dev" || import.meta.env.DEV;
