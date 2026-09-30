// tests/leaving-order.test.js — v18.3.2 (O3), rows that leave the way they arrive.
//
// `placeLeaving` decides where a row that is folding away is drawn, and the
// waitlist panel and the List's cards fold through it. The first describe is
// the arithmetic; the rest pin each surface's wiring to the decisions behind it
// (385ms, arrive at full height, inert while leaving). Comments stripped
// (tests/test-hygiene.test.js).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { stripComments } from "../scripts/strip-comments.mjs";
import { placeLeaving } from "../src/lib/leaving-order.js";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
const read = (rel) => stripComments(readFileSync(join(SRC, rel), "utf8")).join("\n");

describe("placeLeaving: a leaving row holds its place", () => {
  it("draws the live list as it is when nothing is leaving", () => {
    expect(placeLeaving(["a", "b", "c"], ["a", "b", "c"], ["a", "b", "c"])).toEqual(["a", "b", "c"]);
  });
  it("keeps one leaving row where it was, as rank - 0.5 would", () => {
    expect(placeLeaving(["a", "c", "d"], ["a", "b", "c", "d"], ["a", "b", "c", "d"])).toEqual(["a", "b", "c", "d"]);
  });
  it("keeps the first row first", () => {
    expect(placeLeaving(["b", "c"], ["a", "b", "c"], ["a", "b", "c"])).toEqual(["a", "b", "c"]);
  });
  it("keeps TWO leaving rows in place, where rank - 0.5 puts the second after its successor", () => {
    // The old rule: c→1, e→2 live; d's old index 3 → 2.5, after e.
    expect(placeLeaving(["a", "c", "e"], ["a", "b", "c", "d", "e"], ["a", "b", "c", "d", "e"])).toEqual(["a", "b", "c", "d", "e"]);
  });
  it("keeps a run of leaving rows in their order", () => {
    expect(placeLeaving(["a", "d"], ["a", "b", "c", "d"], ["a", "b", "c", "d"])).toEqual(["a", "b", "c", "d"]);
  });
  it("keeps a leaving row after its predecessor while the live rows re-sort", () => {
    expect(placeLeaving(["d", "a", "c"], ["a", "b", "c", "d"], ["a", "b", "c", "d"])).toEqual(["d", "a", "b", "c"]);
  });
  it("places a second departure against a row that is already folding", () => {
    // b left a moment ago and is still drawn; now a leaves too.
    expect(placeLeaving(["c", "d"], ["a", "b", "c", "d"], ["a", "b", "c", "d"])).toEqual(["a", "b", "c", "d"]);
  });
  it("leaves out a live row that is not mounted yet", () => {
    // useRevealRows mounts a newcomer one commit later; drawn now, its Reveal would mount closed.
    expect(placeLeaving(["a", "n", "b"], ["a", "b"], ["a", "b"])).toEqual(["a", "b"]);
  });
  it("puts a leaving row it never drew last, and still returns", () => {
    expect(placeLeaving(["a", "b"], ["a", "b", "x"], ["a", "b"])).toEqual(["a", "b", "x"]);
  });
  it("does not change its inputs", () => {
    const live = ["a", "c"]; const mounted = ["a", "b", "c"]; const prev = ["a", "b", "c"];
    placeLeaving(live, mounted, prev);
    expect([live, mounted, prev]).toEqual([["a", "c"], ["a", "b", "c"], ["a", "b", "c"]]);
  });
});

describe("Reveal can mark a leaving row inert", () => {
  const atoms = read("components/atoms.jsx");
  it("takes an inert prop and renders it as a real boolean on the outer wrapper", () => {
    expect(atoms).toMatch(/export function Reveal\(\{ show, children, style, horizontal = false, speed = "reveal", presentational = false, inert = false \}\)/);
    expect(atoms).toMatch(/<div role=\{presentational \? "presentation" : undefined\} inert=\{inert === true\} style=\{\{ \.\.\.track/);
  });
});

describe("one name for a list row's fold", () => {
  it("is ROW_FOLD, --t-shift, beside the exit holds", () => {
    expect(read("lib/constants.js")).toMatch(/export var ROW_FOLD = "shift";/);
  });
  it("and the WhatsApp list, where it was measured, folds on it", () => {
    const list = read("components/whatsapp/ConversationList.jsx");
    expect(list).toMatch(/import \{ T, ROW_FOLD \} from "\.\.\/\.\.\/lib\/constants";/);
    expect(list).toMatch(/useRevealRows\(sorted\.map\(\(c\) => c\.phoneKey\), undefined, \{ speed: ROW_FOLD, instantIn: true \}\)/);
    expect(list).not.toMatch(/ROW_SPEED/);
  });
});

describe("the waitlist panel's rows leave the way they arrive", () => {
  const panel = read("components/WaitlistPanel.jsx");
  it("folds on ROW_FOLD and arrives at full height", () => {
    expect(panel).toMatch(/useRevealRows\(ids,date,\{speed:ROW_FOLD,instantIn:true\}\)/);
  });
  it("draws a leaving row where it was, from Reveal's cache, inert", () => {
    expect(panel).toMatch(/const order=useLeavingOrder\(ids,renderIds\);/);
    expect(panel).toMatch(/<Reveal key=\{id\} show=\{openIds\.has\(id\)\} speed=\{ROW_FOLD\} inert=\{i===undefined\}>\{i===undefined\?null:rowFor\(entries\[i\],i\)\}<\/Reveal>/);
  });
  it("swaps the last row for the empty line on the same curve, and drops the line at once when a party arrives", () => {
    expect(panel).toMatch(/const noneOpen=!order\.some\(function\(id\)\{return openIds\.has\(id\);\}\);/);
    expect(panel).toMatch(/\{entries\.length\?null:<Reveal show=\{noneOpen\} speed=\{ROW_FOLD\}><div/);
  });
});
