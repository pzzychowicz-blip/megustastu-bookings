// src/lib/wa-attach.js
//
// v18.8.0 — what the reply composer does with a file before it is sent: which
// files it takes, and a photo made small enough to send.
//
// A PHOTO is always re-drawn on a canvas and sent as a JPEG, longest side at
// most PHOTO_MAX_SIDE, at PHOTO_QUALITY. A phone's photo is 3–12 MB; drawn
// again it is a few hundred kB, well inside what a function may receive
// (WA_SEND_MAX_BYTES), and the re-draw drops the file's metadata, the place it
// was taken among it, which is not the customer's business. A PDF is sent as
// it is, so one over the cap is refused here, before anything is uploaded.
//
// Client-only (a canvas). The size and type rules are `whatsapp.js`', which
// the server reads too.

import { WA_SEND_MAX_BYTES, fileSizeLabel } from "./whatsapp.js";

export const PHOTO_MAX_SIDE = 1600;
export const PHOTO_QUALITY = 0.8;

// What a picked file is, by its type: "photo", "pdf", or null for anything
// else. `accept` on the input is a hint a picker may ignore ("All files").
export function attachKind(file) {
  const type = String((file && file.type) || "").toLowerCase();
  if (type === "application/pdf") return "pdf";
  if (type.startsWith("image/") && type !== "image/svg+xml") return "photo";
  return null;
}

// The sentence the composer shows instead of attaching, or null. A photo is
// never too large here: it is about to be drawn smaller. A PDF a few kB over
// the cap rounds to the cap's own label, so it reads "just over", never
// "4.2 MB … the most is 4.2 MB".
export function attachRefusal(file) {
  const kind = attachKind(file);
  if (!kind) return "Only a photo or a PDF can be sent from here.";
  if (kind === "pdf" && file.size > WA_SEND_MAX_BYTES) {
    const size = fileSizeLabel(file.size);
    const cap = fileSizeLabel(WA_SEND_MAX_BYTES);
    return "This PDF is " + (size === cap ? "just over " : "") + size + ". The most that can be sent from here is " + cap + ".";
  }
  return null;
}

// The size a w × h picture is drawn at: unchanged when it already fits, else
// scaled so its longest side is `max`. Whole pixels, never below 1.
export function fitWithin(w, h, max) {
  const long = Math.max(w, h);
  if (!(long > max)) return { w: Math.max(1, Math.round(w)), h: Math.max(1, Math.round(h)) };
  const k = max / long;
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) };
}

// A picked photo as a JPEG Blob. `createImageBitmap` honours the photo's
// rotation (`imageOrientation: "from-image"`), which a portrait from a phone
// needs. A transparent PNG is drawn over white, since JPEG has no transparency
// and would make it black. Rejects when the browser cannot read the picture.
export async function shrinkPhoto(file) {
  const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
  try {
    const { w, h } = fitWithin(bmp.width, bmp.height, PHOTO_MAX_SIDE);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no canvas");
    // A JPEG has no transparency: a PNG is flattened onto white, as a viewer
    // would show it. A canvas pixel, never a themed surface.
    ctx.fillStyle = "#fff"; /* @fixed-fill */
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bmp, 0, 0, w, h);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", PHOTO_QUALITY));
    if (!blob) throw new Error("the photo could not be encoded");
    return blob;
  } finally {
    if (bmp.close) bmp.close();
  }
}
