// tests/tags.test.js — v18.5.0, the tag list (`settings/tags`).
//
// `lib/tags.js` decides what the stored list is read as and what each edit in
// Settings does to it. A booking stores tag IDS, so the properties worth
// holding are about ids: unique across both kinds, minted once, never reused.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  TAG_KINDS, TAG_LABEL_MAX, TAG_LIST_MAX, DEFAULT_TAG_LIST,
  sanitizeTagList, sameTagList, cleanTagLabel, tagLabelRefusal,
  addTag, renameTag, removeTag, tagIdFor, tagsOf, tagLabels,
} from "../src/lib/tags.js";
import { stripComments } from "../scripts/strip-comments.mjs";

const list = (guest, occasion) => ({ v: 1, guest: guest || [], occasion: occasion || [] });
const t = (id, label) => ({ id, label });

describe("the seed", () => {
  it("is Patryk's list of 2026-10-08", () => {
    expect(DEFAULT_TAG_LIST.guest.map((x) => x.label)).toEqual(["Allergy", "Vegetarian", "Vegan", "Gluten-free", "VIP"]);
    expect(DEFAULT_TAG_LIST.occasion.map((x) => x.label)).toEqual(["Birthday", "Anniversary"]);
  });

  it("has fixed ids, unique across both kinds, so two devices agree before anything is stored", () => {
    const ids = TAG_KINDS.flatMap((k) => DEFAULT_TAG_LIST[k].map((x) => x.id));
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain("g-allergy");
    expect(ids).toContain("o-birthday");
  });

  it("survives its own sanitiser unchanged", () => {
    expect(sameTagList(sanitizeTagList(DEFAULT_TAG_LIST), DEFAULT_TAG_LIST)).toBe(true);
  });
});

describe("sanitizeTagList — what a read makes of the node", () => {
  it("reads an ABSENT node as the seed", () => {
    for (const absent of [null, undefined, "", 0, "x"]) {
      expect(sameTagList(sanitizeTagList(absent), DEFAULT_TAG_LIST)).toBe(true);
    }
  });

  it("hands out a fresh seed each time, so nothing can edit the constant through it", () => {
    const a = sanitizeTagList(null);
    a.guest.push(t("g-x", "X"));
    a.occasion[0].label = "Changed";
    expect(DEFAULT_TAG_LIST.guest).toHaveLength(5);
    expect(DEFAULT_TAG_LIST.occasion[0].label).toBe("Birthday");
  });

  it("reads a PRESENT node's missing list as EMPTY, never as the seed", () => {
    // RTDB drops an empty array: `{v: 1}` is a restaurant that removed every tag.
    expect(sanitizeTagList({ v: 1 })).toEqual(list([], []));
    expect(sanitizeTagList({ v: 1, occasion: [t("o-birthday", "Birthday")] })).toEqual(list([], [t("o-birthday", "Birthday")]));
  });

  it("reads an array RTDB handed back as an object, in index order", () => {
    const got = sanitizeTagList({ v: 1, guest: { 2: t("g-c", "C"), 0: t("g-a", "A"), 10: t("g-k", "K") } });
    expect(got.guest.map((x) => x.id)).toEqual(["g-a", "g-c", "g-k"]);
  });

  it("drops what is not a tag", () => {
    const got = sanitizeTagList({ v: 1, guest: [
      null, "Vegan", 7, {}, t("", "No id"), t("g-ok", ""), t("g-ok2", "   "), t("has space", "Bad id"),
      t("a/b", "Path"), { id: 5, label: "Number id" }, t("g-fine", "Fine"),
    ] });
    expect(got.guest).toEqual([t("g-fine", "Fine")]);
  });

  it("keeps the first of two tags with one id, across BOTH kinds", () => {
    const got = sanitizeTagList({ v: 1, guest: [t("x-1", "Vegan"), t("x-1", "Again")], occasion: [t("x-1", "Birthday"), t("o-2", "Party")] });
    expect(got.guest).toEqual([t("x-1", "Vegan")]);
    expect(got.occasion).toEqual([t("o-2", "Party")]);
  });

  it("keeps the first of two tags with one name in a kind, whatever the capitals, and lets the kinds share a name", () => {
    const got = sanitizeTagList({ v: 1, guest: [t("g-1", "VIP"), t("g-2", "vip"), t("g-3", " Vip ")], occasion: [t("o-1", "VIP")] });
    expect(got.guest).toEqual([t("g-1", "VIP")]);
    expect(got.occasion).toEqual([t("o-1", "VIP")]);
  });

  it("tidies a label to one line of at most " + TAG_LABEL_MAX + " characters", () => {
    expect(cleanTagLabel("  Gluten \n  free  ")).toBe("Gluten free");
    expect(cleanTagLabel("x".repeat(60))).toHaveLength(TAG_LABEL_MAX);
    expect(cleanTagLabel(null)).toBe("");
    expect(cleanTagLabel(12)).toBe("12");
    // Cut at the limit, then trimmed again: no label ends on a space.
    expect(cleanTagLabel("a".repeat(TAG_LABEL_MAX - 1) + " tail")).toBe("a".repeat(TAG_LABEL_MAX - 1));
  });

  it("stops at " + TAG_LIST_MAX + " tags of a kind", () => {
    const many = Array.from({ length: TAG_LIST_MAX + 5 }, (_, i) => t("g-" + i, "Tag " + i));
    expect(sanitizeTagList({ v: 1, guest: many }).guest).toHaveLength(TAG_LIST_MAX);
  });

  it("writes only v, guest and occasion", () => {
    const got = sanitizeTagList({ v: 9, guest: [Object.assign(t("g-1", "A"), { colour: "red" })], extra: true });
    expect(got).toEqual(list([t("g-1", "A")], []));
  });
});

describe("the three edits", () => {
  const base = list([t("g-vegan", "Vegan"), t("g-vip", "VIP")], [t("o-birthday", "Birthday")]);

  it("add puts the tag at the end of its kind and leaves the input alone", () => {
    const r = addTag(base, "guest", "  Nut  allergy ", "g-new1");
    expect(r.refuse).toBeUndefined();
    expect(r.list.guest).toEqual([t("g-vegan", "Vegan"), t("g-vip", "VIP"), t("g-new1", "Nut allergy")]);
    expect(r.list.occasion).toEqual(base.occasion);
    expect(base.guest).toHaveLength(2);
  });

  it("add refuses an empty name, a name already in that kind, a full list and a used id", () => {
    expect(addTag(base, "guest", "   ", "g-n").refuse).toBe("Type a name for the tag.");
    expect(addTag(base, "guest", "vegan", "g-n").refuse).toBe("There is already a tag called “vegan”.");
    expect(addTag(base, "occasion", "Vegan", "o-n").list.occasion).toHaveLength(2);
    const full = list(Array.from({ length: TAG_LIST_MAX }, (_, i) => t("g-" + i, "Tag " + i)), []);
    expect(addTag(full, "guest", "One more", "g-n").refuse).toBe("Up to " + TAG_LIST_MAX + " tags of each kind.");
    // An id is unique across both kinds: a clash would make two tags one.
    expect(addTag(base, "occasion", "Party", "g-vip").refuse).toMatch(/Try again/);
    expect(addTag(base, "guest", "Party", "").refuse).toMatch(/Try again/);
    expect(addTag(base, "table", "Party", "t-1").refuse).toBe("Unknown kind of tag.");
  });

  it("rename keeps the id and the position", () => {
    const r = renameTag(base, "g-vegan", "Plant-based");
    expect(r.list.guest).toEqual([t("g-vegan", "Plant-based"), t("g-vip", "VIP")]);
    expect(base.guest[0].label).toBe("Vegan");
  });

  it("rename lets a tag keep its own name in other capitals, and refuses another tag's", () => {
    expect(renameTag(base, "g-vip", "Vip").list.guest[1]).toEqual(t("g-vip", "Vip"));
    expect(renameTag(base, "g-vip", "VEGAN").refuse).toBe("There is already a tag called “VEGAN”.");
    expect(renameTag(base, "g-vip", " ").refuse).toBe("Type a name for the tag.");
    expect(renameTag(base, "g-gone", "X").refuse).toBe("That tag is no longer in the list.");
  });

  it("remove takes the tag out and nothing else; an unknown id changes nothing", () => {
    const r = removeTag(base, "g-vegan");
    expect(r.list).toEqual(list([t("g-vip", "VIP")], [t("o-birthday", "Birthday")]));
    expect(removeTag(base, "g-gone").list).toBe(base);
    expect(removeTag(list([t("g-1", "A")], []), "g-1").list).toEqual(list([], []));
  });

  it("a removed name added again is a NEW tag: the old id never comes back", () => {
    const gone = removeTag(base, "g-vegan").list;
    const back = addTag(gone, "guest", "Vegan", tagIdFor("guest", "mabc123")).list;
    expect(back.guest.map((x) => x.id)).not.toContain("g-vegan");
    // So a booking that carried the removed tag does not read as tagged again.
    expect(tagLabels(back, "guest", ["g-vegan"])).toEqual([]);
  });

  it("every edit's result is what the sanitiser would store", () => {
    const a = addTag(base, "occasion", "Hen party", "o-n1").list;
    const b = renameTag(a, "o-n1", "Stag party").list;
    const c = removeTag(b, "g-vip").list;
    for (const x of [a, b, c]) expect(sanitizeTagList(x)).toEqual(x);
  });
});

describe("tagIdFor", () => {
  it("prefixes the kind and keeps a path-safe token", () => {
    expect(tagIdFor("guest", "mv1abc")).toBe("g-mv1abc");
    expect(tagIdFor("occasion", "mv1abc")).toBe("o-mv1abc");
    expect(tagIdFor("guest", "a/b.c#d$e[f]")).toBe("g-abcdef");
  });

  it("makes an id the add accepts", () => {
    expect(addTag(list(), "guest", "New", tagIdFor("guest", "mv1abc")).list.guest).toEqual([t("g-mv1abc", "New")]);
  });
});

describe("tagsOf and tagLabels — what a booking's ids read as", () => {
  const l = list([t("g-a", "Allergy"), t("g-v", "Vegan"), t("g-vip", "VIP")], [t("o-b", "Birthday")]);

  it("answers in the LIST's order, whatever order the booking stored", () => {
    expect(tagLabels(l, "guest", ["g-vip", "g-a"])).toEqual(["Allergy", "VIP"]);
    expect(tagsOf(l, "guest", ["g-vip", "g-a"])).toEqual([t("g-a", "Allergy"), t("g-vip", "VIP")]);
  });

  it("leaves out an id the list does not have, and an id of the other kind", () => {
    expect(tagLabels(l, "guest", ["g-gone", "g-v", "o-b"])).toEqual(["Vegan"]);
    expect(tagLabels(l, "occasion", ["g-v", "o-b"])).toEqual(["Birthday"]);
  });

  it("is empty for no ids, and for anything that is not a list of them", () => {
    for (const none of [[], null, undefined, "g-a", { 0: "g-a" }]) expect(tagLabels(l, "guest", none)).toEqual([]);
    expect(tagLabels(null, "guest", ["g-a"])).toEqual([]);
  });

  it("a rename reaches every booking without writing to one", () => {
    const renamed = renameTag(l, "g-v", "Plant-based").list;
    expect(tagLabels(renamed, "guest", ["g-v"])).toEqual(["Plant-based"]);
  });
});

describe("sameTagList", () => {
  it("compares ids, labels and order", () => {
    const a = list([t("g-1", "A"), t("g-2", "B")], [t("o-1", "C")]);
    expect(sameTagList(a, JSON.parse(JSON.stringify(a)))).toBe(true);
    expect(sameTagList(a, list([t("g-2", "B"), t("g-1", "A")], [t("o-1", "C")]))).toBe(false);
    expect(sameTagList(a, list([t("g-1", "A"), t("g-2", "b")], [t("o-1", "C")]))).toBe(false);
    expect(sameTagList(a, list([t("g-1", "A")], [t("o-1", "C")]))).toBe(false);
    expect(sameTagList(list(), { v: 1 })).toBe(true);
  });
});

describe("tagLabelRefusal is the one name check", () => {
  it("the add and the rename both ask it", () => {
    const src = stripComments(readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "..", "src", "lib", "tags.js"), "utf8")).join("\n");
    const body = (name) => { const at = src.indexOf("export function " + name + "("); return src.slice(at, src.indexOf("\nexport function ", at + 1)); };
    expect(body("addTag")).toMatch(/tagLabelRefusal\(list, kind, label, null\)/);
    expect(body("renameTag")).toMatch(/tagLabelRefusal\(list, kind, label, id\)/);
    expect(tagLabelRefusal(list([t("g-1", "A")]), "guest", "a", "g-1")).toBeNull();
  });
});

describe("the editor's line under a tag says one thing", () => {
  const editor = stripComments(readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "..", "src", "components", "TagListEditor.jsx"), "utf8")).join("\n");

  it("an armed row says what removing does, even over a refused rename", () => {
    // × on a row whose box holds a refused name blurs the box and arms the row
    // in one tap. `refusal || sentence` then put the confirm under "There is
    // already a tag called…", and `aria-describedby` read that out for it.
    expect(editor).toContain("const refusalShown = !!refusal && !armed;");
    expect(editor).toMatch(/\{refusalShown \? refusal : "Bookings that carry/);
    expect(editor).not.toMatch(/\{refusal \|\| "Bookings that carry/);
    expect(editor).toContain("aria-describedby={refusalShown ? hintId : undefined}");
  });
});

describe("the hook writes the list the way the Rule of law asks", () => {
  const hook = stripComments(readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "..", "src", "hooks", "useTagSettings.js"), "utf8")).join("\n");

  it("refuses before the first read, and writes through the rev pair, never a bare set()", () => {
    expect(hook).toMatch(/if \(!loaded\.current\) \{[\s\S]*?return false;/);
    expect(hook).toMatch(/writeWithRev\("settings\/tags", next, revRef,/);
    expect(hook).toMatch(/attachRev\("settings\/tags", revRef\)/);
    expect(hook).not.toMatch(/\bset\(ref\(/);
  });

  it("says so on screen when it refuses before the first read", () => {
    // The editor keeps the draft on a false return and shows `tagError`; a
    // refusal that only logged left an Add that did nothing and said nothing.
    expect(hook).toMatch(/if \(!loaded\.current\) \{\s+console\.warn\([^\n]+\s+setTagError\("The tag list has not loaded yet[^"]*"\);\s+return false;/);
  });

  it("passes the error callback to its listener", () => {
    expect(hook).toMatch(/dbError\("settings\/tags"\)\)/);
  });

  it("puts the seed back when the node is absent: a refused write is rolled back to null", () => {
    // `sanitizeTagList(null)` is the seed, and the listener sanitises every
    // snapshot. A `if (val)` guard here would keep a tag no database holds.
    expect(hook).toMatch(/const next = sanitizeTagList\(snap\.val\(\)\);\s+listRef\.current = next;\s+setTagList\(next\);/);
  });

  it("assigns the mirror on the line above each setTagList", () => {
    const sets = hook.split("\n").map((l, i, all) => ({ l, prev: all[i - 1] || "" })).filter((x) => /^\s*setTagList\(/.test(x.l));
    expect(sets).toHaveLength(2);
    for (const s of sets) expect(s.prev).toMatch(/listRef\.current = next;/);
  });

  it("writes nothing when the list is already as asked", () => {
    expect(hook).toMatch(/if \(sameTagList\(prev, next\)\) return true;/);
  });
});
