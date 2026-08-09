// tests/presence-state.test.js
//
// v17.8.0 — the presence read model. See src/lib/presence-state.js for why this
// is inference rather than fact.
//
// The through-line of every case here is the asymmetry the module is built on:
// HIDING a device is free and reversible, DELETING one is not. Most of these
// tests are really one question asked from different angles — "can this input
// cause a delete it shouldn't?"

import { describe, it, expect } from "vitest";
import { presenceState, lastProof, STALE_MS, PRUNE_MS } from "../src/lib/presence-state.js";

const NOW = 1_700_000_000_000;
const fresh = (over) => Object.assign({ email: "a@b.c", ua: "Mac · Chrome", since: NOW - 60_000, lastSeen: NOW - 5_000 }, over);

describe("lastProof", () => {
  it("prefers lastSeen", () => {
    expect(lastProof({ since: 1, lastSeen: 2 })).toBe(2);
  });
  it("falls back to since for a pre-v17.8.0 child", () => {
    expect(lastProof({ since: 7 })).toBe(7);
  });
  it("is 0 for a child with neither, and for junk", () => {
    expect(lastProof({ email: "x" })).toBe(0);
    expect(lastProof(null)).toBe(0);
    expect(lastProof({ lastSeen: "recently" })).toBe(0);
  });
});

describe("presenceState — what renders", () => {
  it("returns nothing for an empty node", () => {
    const s = presenceState(null, NOW, "me", true);
    expect(s).toEqual({ devices: [], prunable: [], mySince: null });
  });

  it("lists a device beating normally", () => {
    const s = presenceState({ k1: fresh() }, NOW, "me", false);
    expect(s.devices).toHaveLength(1);
    expect(s.devices[0]).toMatchObject({ key: "k1", email: "a@b.c", ua: "Mac · Chrome" });
  });

  it("hides a device just past STALE_MS and keeps one just inside it", () => {
    const node = {
      inside: fresh({ lastSeen: NOW - (STALE_MS - 1000) }),
      outside: fresh({ lastSeen: NOW - (STALE_MS + 1000) })
    };
    const keys = presenceState(node, NOW, "me", false).devices.map((d) => d.key);
    expect(keys).toEqual(["inside"]);
  });

  it("keeps a pre-v17.8.0 child (no lastSeen) visible for its first STALE_MS", () => {
    const young = presenceState({ old: { email: "x", since: NOW - 10_000 } }, NOW, "me", false);
    expect(young.devices.map((d) => d.key)).toEqual(["old"]);
    const aged = presenceState({ old: { email: "x", since: NOW - (STALE_MS + 1) } }, NOW, "me", false);
    expect(aged.devices).toEqual([]);
  });

  it("hides a child with no usable timestamp rather than trusting it", () => {
    const s = presenceState({ junk: { email: "x", ua: "y" } }, NOW, "me", true);
    expect(s.devices).toEqual([]);
    // …and does NOT prune it: deleting on an absence of evidence is exactly
    // what the hide/delete asymmetry rules out.
    expect(s.prunable).toEqual([]);
  });

  it("defaults a missing email and ua rather than rendering blanks", () => {
    const s = presenceState({ k: { lastSeen: NOW } }, NOW, "me", false);
    expect(s.devices[0]).toMatchObject({ email: "unknown", ua: "Device" });
  });

  it("nulls since/lastSeen it cannot read, so sinceText can skip them", () => {
    const s = presenceState({ k: { lastSeen: NOW } }, NOW, "me", false);
    expect(s.devices[0].since).toBe(null);
    expect(s.devices[0].lastSeen).toBe(NOW);
  });
});

describe("presenceState — what gets deleted", () => {
  const ancient = fresh({ lastSeen: NOW - (PRUNE_MS + 60_000), since: NOW - (PRUNE_MS + 60_000) });

  it("prunes a child past PRUNE_MS when armed", () => {
    const s = presenceState({ dead: ancient }, NOW, "me", true);
    expect(s.prunable).toEqual(["dead"]);
  });

  it("prunes NOTHING when not armed, however dead the child", () => {
    const s = presenceState({ dead: ancient }, NOW, "me", false);
    expect(s.prunable).toEqual([]);
    expect(s.devices).toEqual([]);   // still hidden — hiding is ungated
  });

  it("never prunes our own child, even when ancient", () => {
    const s = presenceState({ me: ancient }, NOW, "me", true);
    expect(s.prunable).toEqual([]);
  });

  it("hides at STALE_MS but only deletes at PRUNE_MS — the 4x gap is real", () => {
    const between = fresh({ lastSeen: NOW - (STALE_MS + PRUNE_MS) / 2 });
    const s = presenceState({ k: between }, NOW, "me", true);
    expect(s.devices).toEqual([]);      // hidden
    expect(s.prunable).toEqual([]);     // but NOT deleted
  });

  it("a clock running PRUNE_MS fast cannot wipe the node — that is what the arm gate is for", () => {
    // Simulating the ungated case: `now` is local time, wrong by 20 minutes.
    const skewed = NOW + 20 * 60 * 1000;
    const live = { a: fresh(), b: fresh() };
    // With canPrune false (no real offset yet) nothing is deletable, which is
    // the behaviour usePresence's offsetReadyRef gate produces.
    expect(presenceState(live, skewed, "me", false).prunable).toEqual([]);
    // And this is the damage that gate prevents, stated explicitly:
    expect(presenceState(live, skewed, "me", true).prunable.sort()).toEqual(["a", "b"]);
  });
});

describe("presenceState — mySince", () => {
  it("reports our own resolved since so the heartbeat can rewrite it verbatim", () => {
    const s = presenceState({ me: fresh({ since: 12345 }) }, NOW, "me", false);
    expect(s.mySince).toBe(12345);
  });

  it("is null when our child is not in the node yet", () => {
    expect(presenceState({ other: fresh() }, NOW, "me", false).mySince).toBe(null);
  });

  it("is reported even when our own child is stale, so a beat can revive it intact", () => {
    const s = presenceState({ me: fresh({ since: 999, lastSeen: NOW - (STALE_MS + 1) }) }, NOW, "me", false);
    expect(s.devices).toEqual([]);
    expect(s.mySince).toBe(999);
  });
});
