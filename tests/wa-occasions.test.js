// tests/wa-occasions.test.js — v18.11.0
//
// A WhatsApp draft recognises the restaurant's OCCASION tags (Patryk,
// 2026-10-18): "es un cumpleaños" opens the booking form with Birthday pressed.
// The list is the restaurant's own (`settings/tags.occasion`), sent to Gemini as
// the schema's enum, so a tag added in Settings is recognised from the next
// message and nothing outside the list can come back. Guest tags are not read
// from a message (they follow the person; Patryk's call). The same version
// widens the name rule to the name a booking is made UNDER, and the draft card
// shows the name and the occasions.
//
// What the model DOES with the rule is measured live on the sandbox; this file
// holds what reaches the request, and what the app keeps of the answer.
import { describe, it, expect, vi, afterEach } from "vitest";
import process from "node:process";
import { readFileSync } from "node:fs";
import { stripComments } from "../scripts/strip-comments.mjs";
import { parseMessage, parseThread, mockParse, responseSchemaFor, occasionList, knownOccasions } from "../api/_lib/gemini.js";
import { sanitizeParse, mergeDraft, draftOccasions, occasionIdsIn } from "../src/lib/whatsapp.js";
import { draftPrefill } from "../src/lib/draft-check.js";
import { DEFAULT_TAG_LIST } from "../src/lib/tags.js";
import { SCENARIOS } from "../src/lib/wa-sim-scenarios.js";

vi.mock("../src/lib/wa-sim", () => ({ simulateInbound: (args, ctx) => ctx && ctx.__capture && ctx.__capture(args) }));

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); delete process.env.WA_LLM_MODE; delete process.env.GEMINI_API_KEY; });

const OCC = [{ id: "o-birthday", label: "Birthday" }, { id: "o-anniversary", label: "Anniversary" }, { id: "o-grad", label: "Graduación" }];

// One live call with a stubbed Gemini: what the request carried, and what the
// parse returned for the stubbed answer.
async function liveCall(run, answer) {
  process.env.WA_LLM_MODE = "live";
  process.env.GEMINI_API_KEY = "test-key";
  let body = null;
  vi.stubGlobal("fetch", async (url, init) => {
    body = JSON.parse(init.body);
    return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(answer || { intent: "other", language: "es", confidence: "high" }) }] } }] }) };
  });
  vi.spyOn(console, "log").mockImplementation(() => {});
  const parsed = await run();
  expect(body).not.toBe(null);
  return { prompt: body.contents[0].parts[0].text, schema: body.generationConfig.responseSchema, parsed };
}

describe("the request names the restaurant's occasions, and only them", () => {
  it("puts the ids in the schema as an enum and the labels in the prompt", async () => {
    const { prompt, schema } = await liveCall(() => parseMessage("mesa para 4 el sábado, es un cumpleaños", { occasions: OCC }));
    expect(schema.properties.occasions).toEqual({ type: "ARRAY", nullable: true, items: { type: "STRING", enum: ["o-birthday", "o-anniversary", "o-grad"] }, description: expect.any(String) });
    expect(prompt).toMatch(/- occasions:[^\n]*o-birthday: "Birthday", o-anniversary: "Anniversary", o-grad: "Graduación"/);
    expect(prompt).toMatch(/- occasions:[^\n]*not in the list, or none -> null/);
  });
  it("says nothing about occasions when the restaurant has none", async () => {
    const { prompt, schema } = await liveCall(() => parseMessage("mesa para 4, es un cumpleaños", { occasions: [] }));
    expect(schema.properties.occasions).toBeUndefined();
    expect(prompt).not.toMatch(/occasions/);
    expect(responseSchemaFor(undefined).properties.occasions).toBeUndefined();
  });
  it("is the same for a staff Re-check", async () => {
    const { prompt, schema } = await liveCall(() => parseThread([{ direction: "in", text: "Para 2, es nuestro aniversario" }], { occasions: OCC }));
    expect(schema.properties.occasions.items.enum).toEqual(["o-birthday", "o-anniversary", "o-grad"]);
    expect(prompt).toMatch(/- occasions:/);
  });
  it("leaves out a malformed entry of the list", () => {
    expect(occasionList([{ id: "o-ok", label: "OK" }, { id: "bad id", label: "X" }, { id: "o-x", label: "  " }, null, "o-y"])).toEqual([{ id: "o-ok", label: "OK" }]);
    expect(occasionList(null)).toEqual([]);
  });
});

describe("what the app keeps of the answer", () => {
  it("keeps only ids the restaurant has, cleaned", async () => {
    const { parsed } = await liveCall(() => parseMessage("x", { occasions: OCC }), { intent: "new_booking", language: "es", confidence: "high", occasions: ["o-grad", "o-gone", "o-birthday", "o-birthday"] });
    expect(parsed.occasions).toEqual(["o-birthday", "o-grad"]);
  });
  it("reads none as null, and a restaurant with no occasion tags gets none back", async () => {
    expect((await liveCall(() => parseMessage("x", { occasions: OCC }), { intent: "new_booking", language: "es", confidence: "high", occasions: [] })).parsed.occasions).toBe(null);
    expect((await liveCall(() => parseMessage("x", {}), { intent: "new_booking", language: "es", confidence: "high", occasions: ["o-birthday"] })).parsed.occasions).toBe(null);
    expect(knownOccasions(["o-birthday"], OCC)).toEqual(["o-birthday"]);
  });
  it("sanitizeParse cleans the list and leaves a parse without one alone", () => {
    expect(sanitizeParse({ intent: "new_booking", occasions: ["o-b", "o-a", "o-a", "no way", 3] }).occasions).toEqual(["o-a", "o-b"]);
    expect(sanitizeParse({ intent: "new_booking", occasions: [] }).occasions).toBe(null);
    expect("occasions" in sanitizeParse({ intent: "new_booking" })).toBe(false);
  });
  it("a follow-up that names none keeps the draft's; one that names some replaces them", () => {
    const old = { intent: "new_booking", size: 4, occasions: ["o-birthday"] };
    expect(mergeDraft(old, { intent: "new_booking", size: 5 }).occasions).toEqual(["o-birthday"]);
    expect(mergeDraft(old, { intent: "new_booking", occasions: ["o-anniversary"] }).occasions).toEqual(["o-anniversary"]);
    expect(mergeDraft({ intent: "new_booking" }, { intent: "new_booking" }).occasions).toBe(null);
  });
});

// /code-review: a failed read of settings/tags (readOccasionTags → null) must
// not wipe a pending draft's occasions; a list that was read, even empty, is
// the answer.
describe("when the occasion list could not be read", () => {
  const draft = { intent: "new_booking", size: 4, occasions: ["o-birthday"] };
  it("keeps the pending draft's occasions, live and in a Re-check", async () => {
    const answer = { intent: "new_booking", language: "es", confidence: "high", size: 5 };
    const one = await liveCall(() => parseMessage("somos 5", { existingDraft: draft, occasions: null }), answer);
    expect(one.schema.properties.occasions).toBeUndefined();
    expect(one.parsed.occasions).toEqual(["o-birthday"]);
    const thread = await liveCall(() => parseThread([{ direction: "in", text: "somos 5" }], { existingDraft: draft, occasions: null }), answer);
    expect(thread.parsed.occasions).toEqual(["o-birthday"]);
  });
  it("drops them when the list was read and no longer has them", async () => {
    const answer = { intent: "new_booking", language: "es", confidence: "high", size: 5, occasions: ["o-birthday"] };
    expect((await liveCall(() => parseMessage("somos 5", { existingDraft: draft, occasions: [] }), answer)).parsed.occasions).toBe(null);
  });
});

describe("the one rule for the ids a list still has", () => {
  it("is what Accept and the server's answer both ask", () => {
    expect(occasionIdsIn(["o-grad", "o-gone", "o-birthday", "o-birthday", "bad id"], OCC)).toEqual(["o-birthday", "o-grad"]);
    expect(occasionIdsIn(["o-birthday"], undefined)).toEqual([]);
    expect(knownOccasions(["o-gone"], OCC)).toBe(null);
  });
});

describe("the mock parser (no network) reads occasions too", () => {
  it("by each tag's label, and by the seed tags' Spanish and English words", () => {
    expect(mockParse("mesa para 4 mañana a las 21, es un cumpleaños", OCC).occasions).toEqual(["o-birthday"]);
    expect(mockParse("table for 2 tomorrow at 8pm, our anniversary", OCC).occasions).toEqual(["o-anniversary"]);
    expect(mockParse("somos 6 el viernes a las 21, cena de graduación", OCC).occasions).toEqual(["o-grad"]);
    expect(mockParse("somos 6 el viernes a las 21", OCC).occasions).toBe(null);
  });
  // /code-review: the mock is the production default, so a substring match was a
  // false Birthday on "se cumplen 2 años" and a tag called "Cena" on "cenamos".
  it("by whole words only, labels of two words included", () => {
    const more = OCC.concat([{ id: "o-cena", label: "Cena" }, { id: "o-date", label: "Date night" }]);
    expect(mockParse("se cumplen 2 años, mesa para 2 mañana", more).occasions).toBe(null);
    expect(mockParse("cenamos 4 el viernes a las 21", more).occasions).toBe(null);
    expect(mockParse("mesa para 2 mañana, cena de empresa", more).occasions).toEqual(["o-cena"]);
    expect(mockParse("table for 2 tomorrow, date night!", more).occasions).toEqual(["o-date"]);
    expect(mockParse("Cumple de Ana, mesa para 6 mañana", more).occasions).toEqual(["o-birthday"]);
  });
  it("only on a booking intent, and only from the list", () => {
    expect(mockParse("¿abrís el día de mi cumpleaños?", OCC).occasions).toBe(null);
    expect(mockParse("mesa para 4 mañana, es un cumpleaños", []).occasions).toBe(null);
  });
});

describe("Accept opens the form with the occasions", () => {
  const conv = (d) => ({ phoneKey: "+34600111222", draftData: Object.assign({ intent: "new_booking", size: 4 }, d) });
  it("as the form's occasion tags, kept only where the list still has them", () => {
    expect(draftPrefill(conv({ occasions: ["o-birthday"] }), [], {}, DEFAULT_TAG_LIST).tags).toEqual(["o-birthday"]);
    expect(draftPrefill(conv({ occasions: ["o-birthday", "o-removed"] }), [], {}, DEFAULT_TAG_LIST).tags).toEqual(["o-birthday"]);
    expect(draftPrefill(conv({}), [], {}, DEFAULT_TAG_LIST).tags).toEqual([]);
    expect(draftOccasions({ occasions: ["o-birthday"] }, null)).toEqual([]);
  });
  it("never as a guest tag, even when one has the id's shape", () => {
    expect(draftOccasions({ occasions: ["g-vip"] }, DEFAULT_TAG_LIST)).toEqual([]);
  });
});

describe("the name rule", () => {
  it("reads the name a booking is made under, not only the customer's own", async () => {
    const { prompt } = await liveCall(() => parseMessage("mesa para 4 a nombre de Juan", {}));
    expect(prompt).toMatch(/- name:[^\n]*a nombre de Juan[^\n]*under Smith/);
    expect(prompt).toMatch(/- name:[^\n]*never a name you only infer/i);
  });
});

// /code-review: the list reaches the card by hand through three components, and
// `tagLabels` of an undefined list is quietly [], so a dropped link would make
// the card name no occasion while Accept still presses it.
describe("the tag list reaches the draft card", () => {
  const src = (f) => stripComments(readFileSync(new URL("../src/" + f, import.meta.url), "utf8")).join("\n");
  it("at every link: App, InboxPanel, ConversationView, DraftCard", () => {
    expect(src("App.jsx")).toMatch(/<InboxPanel[\s\S]*?tagList=\{tagList\}/);
    expect(src("components/whatsapp/InboxPanel.jsx")).toMatch(/<ConversationView[\s\S]*?tagList=\{tagList\}/);
    expect(src("components/whatsapp/ConversationView.jsx")).toMatch(/<DraftCard[\s\S]*?tagList=\{tagList\}/);
    expect(src("components/whatsapp/DraftCard.jsx")).toMatch(/tagLabels\(tagList, "occasion", d\.occasions\)/);
  });
  it("and the compact bar leaves the name to its detail", () => {
    const card = src("components/whatsapp/DraftCard.jsx");
    expect(card).toMatch(/\{barSummary\}<\/span>/);
    expect(card).toMatch(/"Name: " \+ draftName/);
  });
});

// Phase 10 (Patryk, after the review): a change request naming an occasion.
describe("a change request's occasion reaches the booking", () => {
  const src = (f) => stripComments(readFileSync(new URL("../src/" + f, import.meta.url), "utf8")).join("\n");
  it("Apply changes ADDS it to the booking's occasion tags", () => {
    const hook = src("hooks/useWhatsApp.js");
    const apply = hook.slice(hook.indexOf("function handleApplyModify("), hook.indexOf("function completeModifyApply("));
    expect(apply).toMatch(/const occ = draftOccasions\(d, tagList\);\s*if \(occ\.length\) changes\.tags = unionTagIds\(booking\.tags, occ\);\s*if \(!openEdit\(booking, changes\)\) return;/);
  });
  it("the banner names it, so an occasion alone offers Apply changes", () => {
    expect(src("components/whatsapp/IntentBanner.jsx")).toMatch(/tagLabels\(tagList, "occasion", draftData\.occasions\)\.forEach\(function \(l\) \{ reqParts\.push\(l\); \}\)/);
    expect(src("components/whatsapp/ConversationView.jsx")).toMatch(/<IntentBanner[^>]*tagList=\{tagList\}/);
  });
  it("the mock reads one on a modify intent too", () => {
    expect(mockParse("can we change it to 6 people? it's our anniversary", OCC)).toMatchObject({ intent: "modify", occasions: ["o-anniversary"] });
  });
  it("the scenario carries it, linked to a booking", () => {
    let args = null;
    SCENARIOS.find((x) => x.id === "modify_occasion").run({ __capture: (a) => { args = a; } });
    expect(args).toMatchObject({ acceptedBookingId: "wasimS1", parse: { intent: "modify", occasions: ["o-anniversary"] } });
  });
});

describe("the simulator scenario", () => {
  it("carries the occasion and the name the live run is expected to return", () => {
    const s = SCENARIOS.find((x) => x.id === "new_occasion");
    let args = null;
    s.run({ __capture: (a) => { args = a; } });
    expect(args.text).toMatch(/a nombre de Lucía[^\n]*cumpleaños/);
    expect(args.parse).toMatchObject({ intent: "new_booking", name: "Lucía", occasions: ["o-birthday"] });
  });
});
