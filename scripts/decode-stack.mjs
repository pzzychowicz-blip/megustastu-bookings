// scripts/decode-stack.mjs — v18.13.0 (#28)
//
// Turns the minified frames in a Download crash data file back into source lines, from
// a rebuild of the commit that crashed. The steps, and why the rebuild must set
// VERCEL_ENV, are in scripts/CLAUDE.md.
//
//   node scripts/decode-stack.mjs <mgt-crashes-….json> <rebuild>/dist
//
// A frame names its file by content hash, so a frame this rebuild has no file for is
// said to be one and never guessed at: that is the check that the rebuild IS the build.
// `@jridgewell/trace-mapping` comes in through @babel/core, not package.json. If it ever
// stops, tests/decode-stack.test.js fails on the import.

import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { TraceMap, originalPositionFor } from "@jridgewell/trace-mapping";

const NOT_THIS_BUILD = "(not in this rebuild: wrong commit, or VERCEL_ENV differs)";

// "fn assets/index-x.js:1:2345" → "src/App.jsx:88:4 fn". A browser's column counts from
// 1 and a map's from 0. `mapFor(file)` answers a TraceMap, or null.
export function decodeFrame(frame, mapFor) {
  const m = /^(?:(.+) )?(\S+):(\d+):(\d+)$/.exec(frame);
  if (!m) return frame;
  const map = mapFor(basename(m[2]));
  if (!map) return frame + "   " + NOT_THIS_BUILD;
  const at = originalPositionFor(map, { line: Number(m[3]), column: Number(m[4]) - 1 });
  if (!at.source) return frame + "   (no mapping)";
  const place = at.source.replace(/^(\.\.\/)+/, "") + ":" + at.line + ":" + at.column;
  const name = at.name || m[1];
  return name ? place + " " + name : place;
}

// One crash, as a block of text. `stack` and `component` hold one frame a line.
export function decodeCrash(crash, mapFor) {
  const lines = [[crash.at, crash.version, crash.view, crash.device].filter(Boolean).join(" · ")];
  lines.push(crash.where + " " + crash.name + ": " + crash.message);
  [["stack", crash.stack], ["component", crash.component]].forEach(([label, frames]) => {
    if (!frames) return;
    lines.push(label + ":");
    frames.split("\n").forEach((f) => lines.push("  " + decodeFrame(f, mapFor)));
  });
  return lines.join("\n");
}

// Maps are read once each, from <dist>/assets. Absent is the answer for another build.
function mapsIn(dist) {
  const seen = new Map();
  return (file) => {
    if (!seen.has(file)) {
      const path = join(dist, "assets", file + ".map");
      seen.set(file, existsSync(path) ? new TraceMap(readFileSync(path, "utf8")) : null);
    }
    return seen.get(file);
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [file, dist] = process.argv.slice(2);
  if (!file || !dist) {
    console.error("usage: node scripts/decode-stack.mjs <mgt-crashes-….json> <rebuild>/dist");
    process.exit(1);
  }
  const mapFor = mapsIn(dist);
  console.log(JSON.parse(readFileSync(file, "utf8")).map((c) => decodeCrash(c, mapFor)).join("\n\n"));
}
