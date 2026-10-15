// src/lib/wa-mock-media.js
//
// v18.8.0 phase 6 — media with no Meta behind it. A MOCK id is `MOCK.<kind>.<random>`,
// and api/wa-media.js answers one with a bundled sample of its kind
// (`api/_lib/mock-media/`) while WA_SEND_MODE is mock, and 410 on a live deployment.
//
// Two places make them, and both read this file, so the id has one spelling:
//   · `uploadMedia` in api/_lib/meta.js, in mock mode (a staff member's sent photo);
//   · the simulator's "customer sends a photo / voice note / PDF", whose message is
//     built here in the shape a Meta webhook carries (`simMediaMessage`), so it runs
//     through the same `inboundContent` a real one does. The DEV client wraps it in
//     a webhook for the local harness; the sandbox's /api/wa-sim-inbound builds it
//     on the SERVER, from a kind alone, because a media id taken from a browser is
//     the thing api/wa-media.js exists not to trust.
//
// Imported by the server (Node ESM) and by the simulator's chunk only, never by the
// app's own code, so it is not in a production bundle. Imports nothing.

// What each kind looks like in a webhook: the type Meta gives, a voice note's
// flag, a document's name.
export const SIM_MEDIA = {
  image: { mime_type: "image/jpeg" },
  audio: { mime_type: "audio/ogg; codecs=opus", voice: true },
  document: { mime_type: "application/pdf", filename: "menu-grupos-2026.pdf" },
};

export function mockMediaId(kind) {
  return "MOCK." + kind + "." + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// One webhook `messages[]` entry's content for a simulated photo, voice note or
// PDF: `{ type, [type]: { id, mime_type, … } }`. The caption rides on a photo or a
// document; a voice note has none (WhatsApp sends no caption with audio). Null for
// a kind that is not one of the three.
export function simMediaMessage(kind, caption) {
  const shape = Object.prototype.hasOwnProperty.call(SIM_MEDIA, kind) ? SIM_MEDIA[kind] : null;
  if (!shape) return null;
  const part = Object.assign({ id: mockMediaId(kind) }, shape);
  const c = typeof caption === "string" ? caption.trim() : "";
  if (c && kind !== "audio") part.caption = c;
  return { type: kind, [kind]: part };
}
