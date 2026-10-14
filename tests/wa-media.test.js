// tests/wa-media.test.js
//
// v18.8.0 — the stored shape of a photo, a voice note or a document
// (`sanitizeMedia`), what it is called where no picture is drawn
// (`mediaLabel`, `mediaSnippet`), and when Meta no longer has the file
// (`mediaExpired`). The webhook that stores it is run in api-handlers.test.js.

import { describe, it, expect } from "vitest";
import {
  sanitizeMedia, mediaLabel, mediaSnippet, mediaExpired,
  WA_MEDIA_KEEP_IN_MS, WA_MEDIA_KEEP_OUT_MS, WA_FILENAME_LEN,
} from "../src/lib/whatsapp.js";

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
