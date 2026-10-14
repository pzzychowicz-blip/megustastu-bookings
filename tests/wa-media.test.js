// tests/wa-media.test.js
//
// v18.8.0 — the stored shape of a photo, a voice note or a document
// (`sanitizeMedia`), what it is called where no picture is drawn
// (`mediaLabel`, `mediaSnippet`), and when Meta no longer has the file
// (`mediaExpired`). The webhook that stores it is run in api-handlers.test.js.
//
// Phase 5 adds what may be SENT (`sendKindOf`, the server's list) and what the
// reply composer does with a picked file first (`src/lib/wa-attach.js`): which
// files it takes, the sentence it shows for one it will not, and the size a
// photo is drawn at. The canvas itself needs a browser and is checked live.
//
// Phase 6 adds the simulator's media (`src/lib/wa-mock-media.js`): the message a
// customer's photo, voice note or PDF is built as, and the one spelling of a
// MOCK id. The handlers that store and serve one are run in api-handlers.test.js.

import { describe, it, expect } from "vitest";
import {
  sanitizeMedia, mediaLabel, mediaSnippet, mediaExpired, sendKindOf,
  WA_MEDIA_KEEP_IN_MS, WA_MEDIA_KEEP_OUT_MS, WA_FILENAME_LEN, WA_SEND_MAX_BYTES,
} from "../src/lib/whatsapp.js";
import { attachKind, attachRefusal, fitWithin, PHOTO_MAX_SIDE } from "../src/lib/wa-attach.js";
import { SIM_MEDIA, mockMediaId, simMediaMessage } from "../src/lib/wa-mock-media.js";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { stripComments } from "../scripts/strip-comments.mjs";

const Composer = stripComments(readFileSync(new URL("../src/components/whatsapp/ReplyComposer.jsx", import.meta.url), "utf8")).join("\n");

describe("sanitizeMedia", () => {
  it("keeps the three kinds with an id, and refuses anything else", () => {
    expect(sanitizeMedia({ kind: "image", mediaId: "123" })).toEqual({ kind: "image", mediaId: "123" });
    expect(sanitizeMedia({ kind: "audio", mediaId: "MOCK.audio.ab-1" })).toEqual({ kind: "audio", mediaId: "MOCK.audio.ab-1" });
    for (const bad of [null, undefined, "image", {}, { kind: "video", mediaId: "1" }, { kind: "image" }, { kind: "image", mediaId: 123 }]) {
      expect(sanitizeMedia(bad)).toBe(null);
    }
  });
  it("refuses an id that is not one: a path, a climb, a query, an empty one, a huge one", () => {
    for (const id of ["../x", "..", ".hidden", "a/b", "a?b=c", "a b", "", "x".repeat(129)]) {
      expect(sanitizeMedia({ kind: "image", mediaId: id })).toBe(null);
    }
    expect(sanitizeMedia({ kind: "image", mediaId: "x".repeat(128) })).not.toBe(null);
  });
  it("keeps a mime type only when it reads as one, codec parameters included", () => {
    expect(sanitizeMedia({ kind: "audio", mediaId: "1", mime: "audio/ogg; codecs=opus" }).mime).toBe("audio/ogg; codecs=opus");
    expect(sanitizeMedia({ kind: "image", mediaId: "1", mime: "image/jpeg" }).mime).toBe("image/jpeg");
    for (const mime of ["jpeg", "image/", "/jpeg", "image/jpeg\r\nX: y", 42, "a/" + "b".repeat(120)]) {
      expect("mime" in sanitizeMedia({ kind: "image", mediaId: "1", mime })).toBe(false);
    }
  });
  it("keeps a file name for a document only, trimmed, capped, with no control characters", () => {
    expect(sanitizeMedia({ kind: "document", mediaId: "1", filename: "  menu.pdf " }).filename).toBe("menu.pdf");
    expect(sanitizeMedia({ kind: "document", mediaId: "1", filename: "a\r\nb\u0000.pdf" }).filename).toBe("ab.pdf");
    expect(sanitizeMedia({ kind: "document", mediaId: "1", filename: "x".repeat(300) }).filename).toHaveLength(WA_FILENAME_LEN);
    expect("filename" in sanitizeMedia({ kind: "document", mediaId: "1", filename: "  " })).toBe(false);
    expect("filename" in sanitizeMedia({ kind: "image", mediaId: "1", filename: "a.jpg" })).toBe(false);
  });
  it("keeps voice only on audio and only when it is true, and a size only when it is one", () => {
    expect(sanitizeMedia({ kind: "audio", mediaId: "1", voice: true }).voice).toBe(true);
    expect("voice" in sanitizeMedia({ kind: "audio", mediaId: "1", voice: "true" })).toBe(false);
    expect("voice" in sanitizeMedia({ kind: "image", mediaId: "1", voice: true })).toBe(false);
    expect(sanitizeMedia({ kind: "image", mediaId: "1", size: 2048.4 }).size).toBe(2048);
    for (const size of [0, -1, NaN, Infinity, "2048"]) expect("size" in sanitizeMedia({ kind: "image", mediaId: "1", size })).toBe(false);
  });
  it("never returns an undefined property, which RTDB would refuse", () => {
    const m = sanitizeMedia({ kind: "document", mediaId: "1", mime: undefined, filename: undefined, voice: undefined, size: undefined });
    expect(Object.values(m).includes(undefined)).toBe(false);
  });
});

describe("mediaLabel and mediaSnippet", () => {
  it("names each kind", () => {
    expect(mediaLabel({ kind: "image" })).toBe("Photo");
    expect(mediaLabel({ kind: "audio", voice: true })).toBe("Voice message");
    expect(mediaLabel({ kind: "audio" })).toBe("Audio");
    expect(mediaLabel({ kind: "document", filename: "menu.pdf" })).toBe("Document: menu.pdf");
    expect(mediaLabel({ kind: "document" })).toBe("Document");
    expect(mediaLabel(null)).toBe("");
  });
  it("the list's line is the label, then the caption when there is one", () => {
    expect(mediaSnippet({ kind: "image" }, " Mesa para 4 ")).toBe("Photo · Mesa para 4");
    expect(mediaSnippet({ kind: "image" }, "  ")).toBe("Photo");
    expect(mediaSnippet({ kind: "audio", voice: true })).toBe("Voice message");
  });
});

describe("mediaExpired", () => {
  const NOW = 2_000_000_000_000;
  it("a received file is gone after 7 days, a sent one after 30", () => {
    const at = (direction, ago) => ({ direction, ts: NOW - ago, media: { kind: "image", mediaId: "1" } });
    expect(mediaExpired(at("in", WA_MEDIA_KEEP_IN_MS), NOW)).toBe(false);
    expect(mediaExpired(at("in", WA_MEDIA_KEEP_IN_MS + 1), NOW)).toBe(true);
    expect(mediaExpired(at("out", WA_MEDIA_KEEP_IN_MS + 1), NOW)).toBe(false);
    expect(mediaExpired(at("out", WA_MEDIA_KEEP_OUT_MS + 1), NOW)).toBe(true);
  });
  it("a message with no media never expires; one with no readable time already has", () => {
    expect(mediaExpired({ direction: "in", ts: 1, text: "hola" }, NOW)).toBe(false);
    expect(mediaExpired({ direction: "in", media: { kind: "image", mediaId: "1" } }, NOW)).toBe(true);
    expect(mediaExpired(null, NOW)).toBe(false);
  });
});

describe("sendKindOf", () => {
  it("a JPEG or a PNG is a photo, a PDF a document, by the type's base, in any case", () => {
    expect(sendKindOf("image/jpeg")).toBe("image");
    expect(sendKindOf("IMAGE/PNG")).toBe("image");
    expect(sendKindOf("application/pdf; charset=binary")).toBe("document");
  });
  it("nothing else can be sent, and an inherited key is not a type", () => {
    for (const t of ["image/gif", "image/webp", "image/svg+xml", "text/html", "audio/ogg", "", null, undefined, "constructor", "__proto__"]) {
      expect(sendKindOf(t)).toBe(null);
    }
  });
});

describe("the composer's attachment (wa-attach)", () => {
  const file = (type, size = 1000) => ({ type, size });

  it("a picture of any type but SVG is a photo, since it is re-drawn as a JPEG; a PDF is a PDF", () => {
    for (const t of ["image/jpeg", "image/png", "image/heic", "image/webp", "IMAGE/GIF"]) expect(attachKind(file(t))).toBe("photo");
    expect(attachKind(file("application/pdf"))).toBe("pdf");
    for (const t of ["image/svg+xml", "text/html", "application/zip", "", undefined]) expect(attachKind(file(t))).toBe(null);
    expect(attachKind(null)).toBe(null);
  });

  it("refuses anything else, and a PDF over the cap, in a sentence that says what to do", () => {
    expect(attachRefusal(file("application/zip"))).toBe("Only a photo or a PDF can be sent from here.");
    // The number and its unit never break apart (fileSizeLabel's no-break space).
    const mb = (n) => n + "\u00a0MB";
    expect(attachRefusal(file("application/pdf", 9 * 1024 * 1024))).toBe("This PDF is " + mb(9) + ". The most that can be sent from here is " + mb(4.2) + ".");
    // Just over the cap rounds to the cap's own label; it must not read as equal to it.
    expect(attachRefusal(file("application/pdf", WA_SEND_MAX_BYTES + 1))).toBe("This PDF is just over " + mb(4.2) + ". The most that can be sent from here is " + mb(4.2) + ".");
    expect(attachRefusal(file("application/pdf", WA_SEND_MAX_BYTES))).toBe(null);
    // A photo is never too large here: it is about to be drawn smaller.
    expect(attachRefusal(file("image/jpeg", 40 * 1024 * 1024))).toBe(null);
  });

  it("a photo is drawn with its longest side at most PHOTO_MAX_SIDE, keeping its shape, in whole pixels", () => {
    expect(PHOTO_MAX_SIDE).toBe(1600);
    expect(fitWithin(4032, 3024, 1600)).toEqual({ w: 1600, h: 1200 });
    expect(fitWithin(3024, 4032, 1600)).toEqual({ w: 1200, h: 1600 });
    expect(fitWithin(1600, 900, 1600)).toEqual({ w: 1600, h: 900 });
    expect(fitWithin(640, 480, 1600)).toEqual({ w: 640, h: 480 });
    expect(fitWithin(10000, 3, 1600)).toEqual({ w: 1600, h: 1 });
    expect(fitWithin(0, 0, 1600)).toEqual({ w: 1, h: 1 });
  });
});

// The composer is not remounted when the conversation changes, so anything it
// holds in plain state follows staff to the next customer. Measured on DEV
// before: a caption typed beside a PDF for one customer sat in the next
// customer's box as a reply, one Enter from being sent to them.
describe("the reply composer keeps its text and its file with their thread", () => {
  it("the text is a draft per thread, never one string", () => {
    expect(Composer).toMatch(/const \[drafts, setDrafts\] = useState\(\{\}\);\s*const txt = drafts\[threadKey\] \|\| "";/);
    expect(Composer).not.toMatch(/const \[txt, setTxt\] = useState/);
  });
  it("the file, its sentence, a send in flight and a photo being prepared each name their thread", () => {
    expect(Composer).toMatch(/const att = attState && attState\.key === threadKey \? attState : null;/);
    expect(Composer).toMatch(/const note = noteState && noteState\.key === threadKey \? noteState\.text : "";/);
    expect(Composer).toMatch(/const busy = busyKey !== null && busyKey === threadKey;/);
    expect(Composer).toMatch(/const preparing = readyKey !== null && readyKey === threadKey;/);
  });
  it("a sent caption is cleared in the thread it was sent from, wherever staff are now", () => {
    expect(Composer).toMatch(/setTxt\("", key\);/);
  });
});

describe("the simulator's media (wa-mock-media.js)", () => {
  it("builds each kind as a webhook carries it, with an id sanitizeMedia keeps", () => {
    const pic = simMediaMessage("image", "  La terraza ");
    expect(pic).toEqual({ type: "image", image: { id: pic.image.id, mime_type: "image/jpeg", caption: "La terraza" } });
    const doc = simMediaMessage("document", "menu");
    expect(doc.document).toMatchObject({ mime_type: "application/pdf", filename: "menu-grupos-2026.pdf", caption: "menu" });
    for (const kind of Object.keys(SIM_MEDIA)) {
      const m = simMediaMessage(kind, "");
      expect(m.type).toBe(kind);
      expect("caption" in m[kind]).toBe(false);
      expect(sanitizeMedia({ kind, mediaId: m[kind].id })).not.toBe(null);
    }
  });
  it("a voice note has no caption, whatever text came with it", () => {
    expect(simMediaMessage("audio", "hola").audio).toEqual({ id: expect.stringMatching(/^MOCK\.audio\./), mime_type: "audio/ogg; codecs=opus", voice: true });
  });
  it("is null for anything that is not one of the three kinds, the object's own keys included", () => {
    for (const k of ["video", "sticker", "", null, undefined, "__proto__", "toString", "constructor", "hasOwnProperty"]) {
      expect(simMediaMessage(k, "x")).toBe(null);
    }
  });
  it("a MOCK id names its kind and is not the same twice", () => {
    const a = mockMediaId("image");
    expect(a).toMatch(/^MOCK\.image\.[a-z0-9]+$/);
    expect(mockMediaId("image")).not.toBe(a);
  });
  // api/wa-media.js serves a sample for any id starting MOCK., so an id built
  // anywhere else would be a second spelling to keep in step.
  it("is the one place a MOCK id is built", () => {
    const root = new URL("..", import.meta.url).pathname;
    const files = [];
    (function walk(dir) {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        if (e.isDirectory()) { if (e.name !== "node_modules" && e.name !== "mock-media") walk(p); } else if (/\.(js|jsx|mjs)$/.test(e.name)) files.push(p);
      }
    })(join(root, "api"));
    (function walk(dir) {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        if (e.isDirectory()) walk(p); else if (/\.(js|jsx)$/.test(e.name)) files.push(p);
      }
    })(join(root, "src"));
    const builders = files.filter((f) => /["']MOCK\.["']\s*\+/.test(stripComments(readFileSync(f, "utf8")).join("\n")));
    expect(builders.map((f) => f.slice(root.length))).toEqual(["src/lib/wa-mock-media.js"]);
    expect(stripComments(readFileSync(join(root, "api/_lib/meta.js"), "utf8")).join("\n")).toMatch(/if \(sendMode\(\) === "mock"\) return mockMediaId\(kind\);/);
  });
});
