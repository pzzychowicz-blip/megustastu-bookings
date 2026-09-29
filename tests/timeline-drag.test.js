// tests/timeline-drag.test.js — v18.3.1
//
// The timeline block's touch drag, pinned at the source. What these hold was
// measured on the restaurant's Android tablet over USB (CDP), and none of it is
// visible to build, lint or a render test: a capture handler that listens to
// its CHILDREN's events reads exactly like one that listens to its own.
// Comments stripped (tests/test-hygiene.test.js).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { stripComments } from "../scripts/strip-comments.mjs";

const Timeline = stripComments(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "src", "components", "TimelineView.jsx"), "utf8")).join("\n");

describe("a child's lost capture does not end the drag", () => {
  it("onLostPointerCapture tears down only when the BLOCK lost it", () => {
    // `lostpointercapture` bubbles. A touch is implicitly captured to the span
    // the finger landed on; when the 800ms arm moves the capture to the block,
    // the span's loss bubbled here and ended the drag it had just armed (most
    // real drags on the tablet, Chrome 154).
    expect(Timeline).toMatch(/onLostPointerCapture: \(e\) => \{ if \(e\.target === e\.currentTarget\) endDrag\(e, false\); \},/);
    expect(Timeline).not.toMatch(/onLostPointerCapture: \(e\) => endDrag\(e, false\)/);
  });

  it("the arm still captures on the block, so a moved capture is what the guard sees", () => {
    expect(Timeline).toMatch(/try \{ el\.setPointerCapture\(pid\); \} catch/);
  });
});
