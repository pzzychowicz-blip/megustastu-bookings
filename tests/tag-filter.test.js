// tests/tag-filter.test.js — v18.5.1: filter and search by tag.
import { describe, it, expect } from "vitest";
import { bookingTagIds, liveTagIds, filterByTags, onlyFinishedMatch, dayTagChips, toggleTagId, tagNames,
  customerTagIds, guestTagChoices, customersWithTag } from "../src/lib/tag-filter.js";
import { guestTagMap, customerIndex } from "../src/lib/customers.js";
import { readFileSync } from "node:fs";
import { stripComments } from "../scripts/strip-comments.mjs";

const read = (rel) => stripComments(readFileSync(new URL("../src/" + rel, import.meta.url), "utf8")).join("\n");

const LIST = {
  guest: [{ id: "g-allergy", label: "Allergy" }, { id: "g-vegan", label: "Vegan" }, { id: "g-vip", label: "VIP" }],
  occasion: [{ id: "o-birthday", label: "Birthday" }],
};
const ANA = "+34 600 000 001", BEA = "+34 600 000 002";
const bk = (id, extra) => Object.assign(
  { id, name: id, phone: "", date: "2026-10-10", time: "20:00", status: "confirmed", tags: [], guestTags: [], guestTagsAt: 0 }, extra || {});

// Ana's allergy is stated on a booking LAST WEEK; tonight's booking states nothing.
const old = bk("a0", { phone: ANA, date: "2026-10-03", guestTags: ["g-allergy"], guestTagsAt: 5, status: "completed" });
const a1 = bk("a1", { phone: ANA });
const b1 = bk("b1", { phone: BEA, tags: ["o-birthday"] });
const c1 = bk("c1");                                             // nobody's, no tags
const v1 = bk("v1", { guestTags: ["g-vegan"], guestTagsAt: 3 });  // nobody's, states its own
const all = [old, a1, b1, c1, v1];
const map = guestTagMap(all);
const day = [a1, b1, c1, v1];
const ids = (l) => l.map((b) => b.id);

describe("bookingTagIds", () => {
  it("reads the guest's tags through the map, so a statement on another booking counts", () => {
    expect(bookingTagIds(a1, map, LIST)).toEqual(["g-allergy"]);
  });
  it("adds the booking's own occasion tags, guest tags first", () => {
    const both = bk("x", { phone: ANA, tags: ["o-birthday"] });
    expect(bookingTagIds(both, guestTagMap(all.concat([both])), LIST)).toEqual(["g-allergy", "o-birthday"]);
  });
  it("a tag no longer in the list is not a tag", () => {
    expect(bookingTagIds(bk("x", { tags: ["o-gone"], guestTags: ["g-gone"], guestTagsAt: 1 }), {}, LIST)).toEqual([]);
    expect(bookingTagIds(a1, map, { guest: [], occasion: [] })).toEqual([]);
    expect(bookingTagIds(a1, map, null)).toEqual([]);
  });
});

describe("filterByTags", () => {
  it("nothing chosen is the same array back", () => {
    expect(filterByTags(day, map, LIST, [])).toBe(day);
    expect(filterByTags(day, map, LIST, null)).toBe(day);
    expect(filterByTags(day, map, LIST, ["g-removed"])).toBe(day);     // chosen, then removed from the list
  });
  it("one tag: the bookings that have it", () => {
    expect(ids(filterByTags(day, map, LIST, ["g-allergy"]))).toEqual(["a1"]);
    expect(ids(filterByTags(day, map, LIST, ["o-birthday"]))).toEqual(["b1"]);
    expect(ids(filterByTags(day, map, LIST, ["g-vip"]))).toEqual([]);
  });
  it("several: any of them, in the day's order", () => {
    expect(ids(filterByTags(day, map, LIST, ["g-vegan", "g-allergy"]))).toEqual(["a1", "v1"]);
    expect(ids(filterByTags(day, map, LIST, ["o-birthday", "g-allergy", "g-vegan"]))).toEqual(["a1", "b1", "v1"]);
  });
});

// v18.6.0: a filter whose only matches are finished would show no card, so App
// opens "Completed & cancelled" for it (on choosing a tag, and on arriving at
// such a day with the filter kept).
describe("onlyFinishedMatch", () => {
  const done = bk("d1", { phone: ANA, status: "completed" });
  const gone = bk("d2", { tags: ["o-birthday"], status: "cancelled" });
  it("true when every match is completed or cancelled", () => {
    expect(onlyFinishedMatch([done, c1], guestTagMap([old, done]), LIST, ["g-allergy"])).toBe(true);
    expect(onlyFinishedMatch([gone, c1], {}, LIST, ["o-birthday"])).toBe(true);
    expect(onlyFinishedMatch([done, gone], guestTagMap([old, done]), LIST, ["g-allergy", "o-birthday"])).toBe(true);
  });
  it("false when an active booking matches too", () => {
    expect(onlyFinishedMatch([done, a1], map, LIST, ["g-allergy"])).toBe(false);
    expect(onlyFinishedMatch([gone, b1], map, LIST, ["o-birthday"])).toBe(false);
  });
  it("false with no filter, a removed tag, or nothing matching", () => {
    expect(onlyFinishedMatch([done], map, LIST, [])).toBe(false);
    expect(onlyFinishedMatch([done], map, LIST, ["g-removed"])).toBe(false);
    expect(onlyFinishedMatch([done], map, LIST, ["g-vip"])).toBe(false);
    expect(onlyFinishedMatch(null, map, LIST, ["g-allergy"])).toBe(false);
  });
  it("App asks it where a tag is chosen and where the day changes, and only ever opens the fold from the first", () => {
    const APP = read("App.jsx");
    const fn = APP.slice(APP.indexOf("function changeListTags(next){"), APP.indexOf("function toggleShowFinished(next){"));
    expect(fn).toContain("if(onlyFinishedMatch(bookings.filter(function(b){return b.date===viewDate;}),guestTags,tagList,next)) setShowFinished(true);");
    expect(fn).not.toContain("setShowFinished(false)");
    expect(APP).toContain("setSelectedListId(null);setShowFinished(onlyFinishedMatch(bookings.filter(function(x){return x.date===viewDate;}),guestTags,tagList,listTagFilter));");
  });
});

describe("dayTagChips", () => {
  it("one chip per tag somebody on the day has, in the list's order, counting who is still to come or seated", () => {
    expect(dayTagChips(day, map, LIST, [])).toEqual([
      { id: "g-allergy", label: "Allergy", count: 1 },
      { id: "g-vegan", label: "Vegan", count: 1 },
      { id: "o-birthday", label: "Birthday", count: 1 },
    ]);
  });
  it("a day with no tagged booking has no chips", () => {
    expect(dayTagChips([c1], map, LIST, [])).toEqual([]);
    expect(dayTagChips([], map, LIST, [])).toEqual([]);
  });
  it("a chosen tag keeps its chip on a day nobody has it, so it can be switched off", () => {
    expect(dayTagChips([c1], map, LIST, ["g-vip"])).toEqual([{ id: "g-vip", label: "VIP", count: 0 }]);
  });
  it("completed and cancelled bookings keep the chip and are not counted", () => {
    const done = [Object.assign({}, a1, { status: "completed" }), Object.assign({}, b1, { status: "cancelled" }), v1];
    expect(dayTagChips(done, map, LIST, [])).toEqual([
      { id: "g-allergy", label: "Allergy", count: 0 },
      { id: "g-vegan", label: "Vegan", count: 1 },
      { id: "o-birthday", label: "Birthday", count: 0 },
    ]);
  });
  it("counts each booking once per tag, and two bookings of one guest twice", () => {
    const two = [a1, bk("a2", { phone: ANA, time: "21:00" })];
    expect(dayTagChips(two, guestTagMap(all.concat([two[1]])), LIST, [])[0]).toEqual({ id: "g-allergy", label: "Allergy", count: 2 });
  });
});

describe("the chosen set", () => {
  it("a tap puts an id in, and a second takes it out", () => {
    expect(toggleTagId([], "g-vip")).toEqual(["g-vip"]);
    expect(toggleTagId(["g-vip", "g-vegan"], "g-vip")).toEqual(["g-vegan"]);
    expect(toggleTagId(null, "g-vip")).toEqual(["g-vip"]);
  });
  it("liveTagIds keeps only ids still in the list, in the list's order", () => {
    expect(liveTagIds(LIST, ["o-birthday", "g-gone", "g-allergy"])).toEqual(["g-allergy", "o-birthday"]);
  });
  it("tagNames reads as a sentence fragment", () => {
    expect(tagNames(LIST, [])).toBe("");
    expect(tagNames(LIST, ["g-vip"])).toBe("VIP");
    expect(tagNames(LIST, ["g-vegan", "g-allergy"])).toBe("Allergy or Vegan");
    expect(tagNames(LIST, ["o-birthday", "g-vegan", "g-allergy"])).toBe("Allergy, Vegan or Birthday");
  });
});

// The List and its keyboard must hide the same cards: ↑/↓ walk App's
// `listDaySorted`, and a card the filter hides must not be a keyboard target.
describe("the List is wired to it", () => {
  const LISTVIEW = read("components/ListView.jsx");
  const APP = read("App.jsx");
  it("ListView narrows the day and builds its chips from the WHOLE day", () => {
    expect(LISTVIEW).toContain("const day = useMemo(() => filterByTags(dayAll, guestTags, tagList, tagFilter), [dayAll, guestTags, tagList, tagFilter]);");
    expect(LISTVIEW).toMatch(/dayTagChips\(dayAll, guestTags, tagList, tagFilter\)/);
    expect(LISTVIEW).toContain("const nameCol = nameColFor(dayAll);");
    expect(LISTVIEW).toContain("onTagFilter(toggleTagId(tagFilter, id));");
  });
  it("the chip row and the empty line are there only when there is something to say", () => {
    expect(LISTVIEW).toContain("<Reveal show={tagChips.length > 0}>");
    // v18.6.0: in a Reveal, and never beside the empty-day prompt.
    expect(LISTVIEW).toContain("const noneTagged = filtering && !day.length && !isEmpty;");
    expect(LISTVIEW).toContain("<Reveal show={noneTagged}>{noneTagged ? (");
  });
  it("App's keyboard list goes through the same call, and the state is App's", () => {
    expect(APP).toMatch(/const listDaySorted=useMemo\(function\(\)\{return filterByTags\(bookings[\s\S]{0,400}?,guestTags,tagList,listTagFilter\);\},\[bookings,viewDate,showFinished,guestTags,tagList,listTagFilter\]\);/);
    expect(APP).toContain("const [listTagFilter, setListTagFilter] = useState(NO_LIST_TAGS);");
    expect(APP).toContain("tagFilter={listTagFilter}");
    expect(APP).toContain("onTagFilter={VA.onTagFilter}");
    expect(APP).toContain("onTagFilter:function(next){R.current.changeListTags(next);},");
  });
  // /code-review: a card the filter hides must not stay selected (the List's
  // shortcuts act on the selection), and a booking picked in Find a booking
  // must be on screen when the List opens on it.
  it("a filter change drops a selection it hides, and a search pick clears a filter that would hide it", () => {
    const fn = APP.slice(APP.indexOf("function changeListTags(next){"), APP.indexOf("function toggleShowFinished(next){"));
    expect(fn).toContain("if(sel&&!filterByTags([sel],guestTags,tagList,next).length) setSelectedListId(null);");
    expect(fn).toContain("setListTagFilter(next);");
    expect(APP).toContain('setView("list");if(!filterByTags([b],guestTags,tagList,listTagFilter).length) setListTagFilter(NO_LIST_TAGS);');
  });
  it("the guest-tag map is declared above the memo that reads it (a const read early blanks the app)", () => {
    expect(APP.indexOf("const guestTags=useMemo(")).toBeGreaterThan(-1);
    expect(APP.indexOf("const guestTags=useMemo(")).toBeLessThan(APP.indexOf("const listDaySorted=useMemo("));
    expect(APP.indexOf("const { tagList,")).toBeLessThan(APP.indexOf("const listDaySorted=useMemo("));
  });
});

// Settings → Customers: a customer has guest tags only, read by the index's key.
describe("the Customers tab's tag chips", () => {
  const idx = customerIndex(all);
  const customers = Object.keys(idx).map((k) => idx[k]);
  const ana = customers.find((c) => c.name === a1.name && c.bookings.some((b) => b.id === "a1"));
  it("a customer's tags come from the same map as a booking's", () => {
    expect(customerTagIds(ana, map, LIST)).toEqual(["g-allergy"]);
    expect(customerTagIds(ana, null, LIST)).toEqual([]);
    expect(customerTagIds(ana, { [ana.key]: ["gone", "g-allergy"] }, LIST)).toEqual(["g-allergy"]);
  });
  it("offers the guest tags somebody has, in the list's order, and never an occasion tag", () => {
    expect(guestTagChoices(customers, map, LIST)).toEqual([{ id: "g-allergy", label: "Allergy" }]);
    const both = Object.assign({}, map, { [customers.find((c) => c !== ana).key]: ["g-vegan", "o-birthday"] });
    expect(guestTagChoices(customers, both, LIST).map((t) => t.id)).toEqual(["g-allergy", "g-vegan"]);
    expect(guestTagChoices([], map, LIST)).toEqual([]);
  });
  it("narrows to the customers with the tag", () => {
    expect(customersWithTag(customers, map, LIST, "g-allergy")).toEqual([ana]);
    expect(customersWithTag(customers, map, LIST, "g-vegan")).toEqual([]);
  });
  it("the tab falls back to All when the chosen tag is gone, and offers no chip nobody has", () => {
    const C = read("components/CustomersSettings.jsx");
    expect(C).toContain("const tagChoices = guestTagChoices(all, guestTags, tagList);");
    expect(C).toContain("const tagOn = tagId && tagChoices.some(function (t) { return t.id === tagId; }) ? tagId : null;");
    expect(C).toContain("? customersWithTag(all, guestTags, tagList, tagOn).sort(byVisits)");
    expect(C).toContain('{tagChoices.map(function (t) { return filterChip("tag:" + t.id, t.label); })}');
  });
});

