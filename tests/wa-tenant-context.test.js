// tests/wa-tenant-context.test.js
//
// v18.0.0 phase 5c. The Gemini prompts describe the restaurant they are working
// for, and that sentence must come from the tenant rather than from the source.
//
// **This guard exists because the de-hardcoding pass itself nearly missed one.**
// The release plan named two sites ("~74 and ~179"); there were THREE — the
// classifier, the customer-reply generator and the scenario generator. A literal
// that survives a de-hardcoding pass is the ordinary outcome, not the unlucky
// one, and the next prompt somebody adds is the next place it happens.
//
// It is deliberately a check on the SOURCE and not on a rendered prompt: the
// prompt builders are internal and reaching them means stubbing `fetch` and a
// live-mode key. That was done once, by hand, and it confirmed the substitution
// reaches the wire — unset gives the MGT fallback, `TENANT_WA_CONTEXT="a beach
// bar in Tarifa"` gives "…sent by a customer to a beach bar in Tarifa and
// extract…". What a build gate can hold cheaply forever is the absence of a new
// literal, which is the thing that actually regresses.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { stripComments } from "../scripts/strip-comments.mjs";

const read = (p) => stripComments(readFileSync(new URL("../" + p, import.meta.url), "utf8")).join("\n");

describe("the Gemini prompts take the restaurant from the tenant", () => {
  it("no prompt carries a hardcoded description of this restaurant", () => {
    const src = read("api/_lib/gemini.js");
    // The MGT wording, and the two halves it could be broken into. Comments are
    // stripped, so the accessor's own fallback — which SHOULD hold this string —
    // is the only place it may legitimately appear.
    const literals = [...src.matchAll(/"[^"]*\b(?:Canary Islands|Canarias)\b[^"]*"/g)].map((m) => m[0]);
    expect(
      literals,
      "a prompt names this restaurant directly. Prompts must read waContext(), "
        + "or a second tenant inherits Me Gustas Tú's description — and every one "
        + "of these was found by grep rather than by review."
    ).toEqual(['"a small restaurant in the Canary Islands"']);
    // …and that one occurrence is the accessor's fallback, not a prompt.
    expect(src).toMatch(/function waContext\(\)\s*\{\s*return env\("TENANT_WA_CONTEXT",\s*"a small restaurant in the Canary Islands"\)/);
  });

  it("every prompt that mentions the restaurant uses the accessor", () => {
    const src = read("api/_lib/gemini.js");
    const uses = (src.match(/waContext\(\)/g) || []).length;
    // Three call sites plus the definition's own `function waContext()` is not
    // matched by this pattern, so three is the whole of it. A FLOOR rather than
    // an equality: a fourth prompt is welcome, a third that lost its accessor is
    // what this catches — together with the literal check above, which is what
    // makes "it stopped using the accessor" impossible to do silently.
    expect(uses, "a prompt stopped reading the tenant's description").toBeGreaterThanOrEqual(3);
  });

  it("the tenant profile is where the value lives, and it is Node-importable", async () => {
    // The comment beside `waContext` used to say the backend "cannot import this
    // file". Measured false — nothing in the module touches import.meta.env — and
    // corrected in phase 5c, because a wrong REASON outlives the decision it was
    // written to justify and blocks whoever later wants to revisit it.
    const mod = await import("../src/tenants/mgt.js");
    expect(typeof mod.profile.waContext).toBe("string");
    expect(mod.profile.waContext.length).toBeGreaterThan(10);
    // The env var's fallback and the profile must agree: an unset variable has to
    // behave exactly like the tenant that ships today, or "unset changes nothing"
    // is false the moment somebody edits one of them.
    expect(
      read("api/_lib/gemini.js"),
      "the prompt fallback and src/tenants/mgt.js's waContext have drifted — an "
        + "unset TENANT_WA_CONTEXT no longer reproduces this tenant"
    ).toContain('"' + mod.profile.waContext + '"');
  });
});
