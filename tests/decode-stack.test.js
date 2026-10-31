// tests/decode-stack.test.js — v18.13.0 (#28)
//
// The tool that reads a crash's frames. A wrong answer here is the worst kind, a line
// that looks right, so the two things pinned are the off-by-one between a browser's
// column and a map's, and that a frame from another build is said and never decoded.

import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { TraceMap } from "@jridgewell/trace-mapping";
import { decodeFrame, decodeCrash } from "../scripts/decode-stack.mjs";

// "AAAA" maps column 0 to src/a.js line 1 column 0, and "SAAS" column 9 to column 9,
// with `run` as the name. So a browser's column 10 is the second one.
const MAP = new TraceMap({ version: 3, sources: ["../../src/a.js"], names: ["run"], mappings: "AAAA,SAASA" });
const mapFor = (file) => (file === "index-abc.js" ? MAP : null);

describe("decodeFrame", () => {
  it("counts a browser's column from 1 and a map's from 0, and prints the way an editor counts", () => {
    expect(decodeFrame("Qx assets/index-abc.js:1:1", mapFor)).toBe("src/a.js:1:1 Qx");
    expect(decodeFrame("Qx assets/index-abc.js:1:10", mapFor)).toBe("src/a.js:1:10 run");
  });
  it("needs no function name", () => {
    expect(decodeFrame("assets/index-abc.js:1:1", mapFor)).toBe("src/a.js:1:1");
  });
  it("a frame from another build is said, and never guessed at", () => {
    expect(decodeFrame("Qx assets/index-other.js:1:10", mapFor)).toBe(
      "Qx assets/index-other.js:1:10   (not in this rebuild: wrong commit, or VERCEL_ENV differs)");
  });
  it("a position the map does not cover is said too", () => {
    expect(decodeFrame("assets/index-abc.js:7:1", mapFor)).toBe("assets/index-abc.js:7:1   (no mapping)");
  });
  it("leaves alone what is not a frame", () => {
    expect(decodeFrame("something else", mapFor)).toBe("something else");
  });
});

describe("the command", () => {
  it("runs through a symlink, as a checkout under /tmp on a Mac is", () => {
    const dir = mkdtempSync(join(tmpdir(), "mgt-decode-"));
    const link = join(dir, "decode-stack.mjs");
    symlinkSync(fileURLToPath(new URL("../scripts/decode-stack.mjs", import.meta.url)), link);
    const run = spawnSync(process.execPath, [link], { encoding: "utf8" });
    rmSync(dir, { recursive: true });
    expect(run.status).toBe(1);
    expect(run.stderr).toContain("usage:");
  });
});

describe("decodeCrash", () => {
  it("reads a line of the download", () => {
    expect(decodeCrash({
      at: "2026-11-01T20:15:00.000Z", version: "18.13.0", view: "timeline", device: "Android · Chrome",
      where: "render", name: "TypeError", message: "x is undefined",
      stack: "Qx assets/index-abc.js:1:10", component: "App assets/index-abc.js:1:1",
    }, mapFor)).toBe([
      "2026-11-01T20:15:00.000Z · 18.13.0 · timeline · Android · Chrome",
      "render TypeError: x is undefined",
      "stack:",
      "  src/a.js:1:10 run",
      "component:",
      "  src/a.js:1:1 App",
    ].join("\n"));
  });
  it("a crash with no stack is still a crash", () => {
    expect(decodeCrash({ where: "error", name: "Error", message: "x" }, mapFor)).toBe("\nerror Error: x");
  });
});
