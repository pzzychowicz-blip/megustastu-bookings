// tests/wa-reply-drafts.test.js — v18.10.0
//
// WhatsApp reply drafts kept on this device as they are typed
// (src/lib/wa-reply-drafts.js): the pure core, the store over a stubbed
// localStorage, and the three places that must forget a conversation's drafts.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { stripComments } from "../scripts/strip-comments.mjs";
import { sanitizeDrafts, withDraft, withoutKeys, withOnlyKeys, DRAFT_MAX, DRAFTS_KEY } from "../src/lib/wa-reply-drafts.js";
import { appCode } from "./app-source.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => stripComments(readFileSync(join(ROOT, p), "utf8")).join("\n");

describe("the pure core", () => {
  it("keeps only well-formed drafts", () => {
    expect(sanitizeDrafts(null)).toEqual({});
    expect(sanitizeDrafts([1])).toEqual({});
    expect(sanitizeDrafts({
      u1: { "+34600": { text: "hola", at: 5 }, "+44": { text: "" }, x: { text: 3 }, y: null },
      u2: "nope",
      u3: { a: { text: "hi" } },
      u4: {},
    })).toEqual({ u1: { "+34600": { text: "hola", at: 5 } }, u3: { a: { text: "hi", at: 0 } } });
  });
  it("caps a draft's length", () => {
    const long = "x".repeat(DRAFT_MAX + 50);
    expect(sanitizeDrafts({ u: { k: { text: long, at: 1 } } }).u.k.text).toHaveLength(DRAFT_MAX);
    expect(withDraft({}, "u", "k", long, 1).u.k.text).toHaveLength(DRAFT_MAX);
  });
  it("sets, replaces and empties a draft per account and conversation", () => {
    const a = withDraft({}, "u1", "+34600", "Hola", 10);
    expect(a).toEqual({ u1: { "+34600": { text: "Hola", at: 10 } } });
    const b = withDraft(a, "u2", "+34600", "Hi", 11);
    expect(b.u1).toBe(a.u1);
    expect(b.u2).toEqual({ "+34600": { text: "Hi", at: 11 } });
    const c = withDraft(b, "u1", "+34600", "", 12);
    expect(c).toEqual({ u2: { "+34600": { text: "Hi", at: 11 } } });
  });
  it("returns the same store when nothing changes", () => {
    const a = withDraft({}, "u1", "k", "Hola", 10);
    expect(withDraft(a, "u1", "k", "Hola", 99)).toBe(a);
    expect(withDraft(a, "u1", "other", "", 99)).toBe(a);
    expect(withoutKeys(a, ["nobody"])).toBe(a);
  });
  it("forgets conversations for every account", () => {
    let s = withDraft({}, "u1", "+1", "a", 1);
    s = withDraft(s, "u1", "+2", "b", 1);
    s = withDraft(s, "u2", "+1", "c", 1);
    expect(withoutKeys(s, ["+1"])).toEqual({ u1: { "+2": { text: "b", at: 1 } } });
  });
  it("keeps only the conversations that exist, for every account", () => {
    let s = withDraft({}, "u1", "+1", "a", 1);
    s = withDraft(s, "u1", "+2", "b", 1);
    s = withDraft(s, "u2", "+3", "c", 1);
    expect(withOnlyKeys(s, ["+2"])).toEqual({ u1: { "+2": { text: "b", at: 1 } } });
    expect(withOnlyKeys(s, ["+1", "+2", "+3", "+9"])).toBe(s);
    expect(withOnlyKeys(s, [])).toEqual({});
  });
});

describe("the store", () => {
  let mem;
  beforeEach(() => {
    vi.resetModules();
    mem = {};
    vi.stubGlobal("localStorage", {
      getItem: (k) => (k in mem ? mem[k] : null),
      setItem: (k, v) => { mem[k] = String(v); },
      removeItem: (k) => { delete mem[k]; },
    });
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it("survives a reload: what is typed is stored and read back", async () => {
    const m1 = await import("../src/lib/wa-reply-drafts.js");
    m1.setReplyDraft("u1", "+34600", "Hola, sí");
    expect(JSON.parse(mem[DRAFTS_KEY]).u1["+34600"].text).toBe("Hola, sí");
    vi.resetModules();
    const m2 = await import("../src/lib/wa-reply-drafts.js");
    expect(m2.draftsOf("u1")["+34600"].text).toBe("Hola, sí");
    expect(m2.draftsOf("u2")).toEqual({});
  });
  it("keeps a snapshot's identity until it changes, and tells subscribers", async () => {
    const m = await import("../src/lib/wa-reply-drafts.js");
    const seen = [];
    const off = m.subscribeDrafts(() => seen.push(1));
    m.setReplyDraft("u1", "k", "a");
    const snap = m.draftsOf("u1");
    expect(m.draftsOf("u1")).toBe(snap);
    m.setReplyDraft("u1", "k", "a");
    expect(seen).toHaveLength(1);
    m.setReplyDraft("u1", "k", "ab");
    expect(m.draftsOf("u1")).not.toBe(snap);
    expect(seen).toHaveLength(2);
    off();
  });
  it("reads one conversation's text, unchanged by a keystroke in another", async () => {
    const m = await import("../src/lib/wa-reply-drafts.js");
    m.setReplyDraft("u1", "a", "Hola");
    const other = m.draftTextOf("u1", "a");
    m.setReplyDraft("u1", "b", "x");
    m.setReplyDraft("u1", "b", "xy");
    // A string compares equal, so useSyncExternalStore keeps row "a" as it was.
    expect(m.draftTextOf("u1", "a")).toBe(other);
    expect(m.draftTextOf("u1", "b")).toBe("xy");
    expect(m.draftTextOf("u1", "none")).toBe("");
    expect(m.draftTextOf("u2", "a")).toBe("");
  });
  it("removes the key once the last draft is sent or emptied", async () => {
    const m = await import("../src/lib/wa-reply-drafts.js");
    m.setReplyDraft("u1", "k", "a");
    m.setReplyDraft("u1", "k", "");
    expect(DRAFTS_KEY in mem).toBe(false);
  });
  it("works in memory when storage throws", async () => {
    vi.stubGlobal("localStorage", { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); }, removeItem: () => { throw new Error("blocked"); } });
    const m = await import("../src/lib/wa-reply-drafts.js");
    m.setReplyDraft("u1", "k", "still here");
    expect(m.draftsOf("u1").k.text).toBe("still here");
    m.keepReplyDraftsFor([]);
    expect(m.draftsOf("u1")).toEqual({});
  });
  it("ignores a corrupt stored value", async () => {
    mem[DRAFTS_KEY] = "{not json";
    const m = await import("../src/lib/wa-reply-drafts.js");
    expect(m.draftsOf("u1")).toEqual({});
  });
});

// A conversation gone by any route (a delete or Delete customer on any device,
// the nightly prune, the simulator's wipe) takes its drafts on this device with
// it: the conversations listener keeps only the drafts to numbers it holds.
describe("a conversation that goes takes its drafts", () => {
  const src = read("src/hooks/useWhatsApp.js");
  const body = (name) => {
    const i = src.indexOf("function " + name + "(");
    expect(i).toBeGreaterThan(-1);
    const j = src.indexOf("\n  function ", i + 10);
    return src.slice(i, j === -1 ? undefined : j);
  };
  it("in the conversations listener, after the snapshot is read", () => {
    const at = src.indexOf('onValue(ref(db, "conversations")');
    expect(at).toBeGreaterThan(-1);
    const listener = src.slice(at, src.indexOf('dbError("conversations")', at));
    expect(listener).toMatch(/conversationsLoaded\.current = true;\s*keepReplyDraftsFor\(Object\.keys\(byKey\)\);/);
    // One mechanism: no delete path forgets by hand any more.
    ["deleteConversations", "clearAllWaData", "eraseConversation"].forEach((n) => expect(body(n)).not.toMatch(/ReplyDrafts/));
  });
  // /code-review: a reply the server refused stores nothing (no failed bubble,
  // no Retry), so the box gets its text back rather than losing the draft.
  it("a refused send puts the text back in its thread's box", () => {
    expect(body("handleSendReply")).toMatch(/return sendViaBackend\(phoneKey, text\)\.then\(function \(\) \{ return true; \}, function \(e\) \{[\s\S]*?return false;/);
    const composer = read("src/components/whatsapp/ReplyComposer.jsx");
    expect(composer).toMatch(/const went = onSend\(t\);\s*setTxt\(""\);/);
    expect(composer).toMatch(/went\.then\(\(ok\) => \{ if \(ok === false\) setTxt\(\(cur\) => cur \|\| typed, key\); \}\)/);
  });
  it("the reply box and each row read the same store, for the signed-in account", () => {
    expect(read("src/components/whatsapp/ReplyComposer.jsx")).toMatch(/useReplyDraft\(draftOwner, threadKey\)/);
    expect(read("src/components/whatsapp/ConversationRow.jsx")).toMatch(/useReplyDraft\(draftOwner, conv\.phoneKey\)/);
    // /code-review: never the whole store in the panel, which re-rendered the
    // list and the open thread's bubbles on every keystroke.
    expect(read("src/components/whatsapp/InboxPanel.jsx")).not.toMatch(/useReplyDraft/);
    expect(appCode()).toMatch(/draftOwner=\{uid\}/);
  });
});
