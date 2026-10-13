// tests/privacy.test.js
//
// v18.7.0 — the public privacy notice (`public/privacy.html`, served at
// `/privacy`). Meta will not publish a WhatsApp app without this URL, and it is
// the one page of the deployment a customer can open, so the ways it can break
// are all silent ones: a script the CSP blocks only in production, a token
// nobody filled, a route that exists on the dev server and not on Vercel.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { renderPrivacy, privacyIncomplete, PRIVACY_TOKENS } from "../scripts/privacy-page.mjs";
import { profile } from "../src/tenants/mgt.js";
import { APP_NAME } from "../src/lib/constants.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (...p) => readFileSync(join(ROOT, ...p), "utf8");
const TEMPLATE = read("public", "privacy.html");
// The leading HTML comment is notes for whoever edits the file. It names the
// things the rules below hunt for, so it comes off before they look.
const BODY = TEMPLATE.replace(/<!--[\s\S]*?-->/g, "");
const VERCEL = JSON.parse(read("vercel.json"));

const FULL = {
  name: "Casa Prueba",
  privacy: { controller: "Prueba Hostelería S.L.", contact: "datos@example.com", updated: "1 January 2027" },
};

describe("the privacy notice — the template", () => {
  // vercel.json's script-src is 'self' plus the hash of index.html's one inline
  // script. Anything inline here runs on the dev server and is blocked in
  // production, with no error anywhere.
  it("carries no script and no inline event handler", () => {
    expect(/<script/i.test(BODY)).toBe(false);
    expect(/\son[a-z]+\s*=/i.test(BODY)).toBe(false);
  });

  it("loads nothing from another origin", () => {
    const urls = [...BODY.matchAll(/\s(?:src|href)="([^"]+)"/g)].map((m) => m[1]);
    const loaded = urls.filter((u) => !u.startsWith("#") && !u.startsWith("/"));
    // The one outbound LINK is the authority a customer can complain to. A link
    // is not a load; it is listed so a second one is a decision.
    expect(loaded).toEqual(["https://www.aepd.es", "https://www.aepd.es"]);
  });

  it("uses only the tokens the generator knows", () => {
    const used = new Set([...BODY.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]));
    expect([...used].sort()).toEqual([...PRIVACY_TOKENS].sort());
  });

  // A restaurant's name typed into the static file is another tenant's page
  // wearing this one's name; the app's name is pinned by count elsewhere
  // (tests/stylesheet.test.js), and this file is deliberately not a site.
  it("names no restaurant and not the app", () => {
    expect(TEMPLATE.includes(profile.name)).toBe(false);
    expect(TEMPLATE.includes(APP_NAME)).toBe(false);
  });

  it("says the same thing in English and in Spanish", () => {
    const section = (id) => new RegExp('<section id="' + id + '"[\\s\\S]*?</section>').exec(BODY)[0];
    const shape = (s) => ({
      h2: (s.match(/<h2>/g) || []).length,
      li: (s.match(/<li>/g) || []).length,
      p: (s.match(/<p[ >]/g) || []).length,
      tokens: (s.match(/\{\{\w+\}\}/g) || []).sort(),
    });
    expect(shape(section("es"))).toEqual(shape(section("en")));
  });
});

describe("the privacy notice — the generator", () => {
  it("fills every token", () => {
    const out = renderPrivacy(TEMPLATE, FULL);
    expect(/\{\{\w*\}\}/.test(out)).toBe(false);
    // The editing notes at the top of the template are not published.
    expect(out.includes("<!--")).toBe(false);
    expect(out.startsWith("<!doctype html>")).toBe(true);
    expect(out).toContain("Prueba Hostelería S.L.");
    expect(out).toContain("datos@example.com");
    expect(out).toContain("<title>Privacy notice — Casa Prueba</title>");
    expect(out).toContain("1 January 2027");
  });

  // An empty value must be SEEN. A sentence that closes cleanly around nothing
  // reads as a finished policy that names nobody.
  it("prints a visible blank for a missing value, never nothing", () => {
    const out = renderPrivacy(TEMPLATE, { name: "Casa Prueba" });
    expect(out).toContain("The data controller is [to be confirmed], which operates Casa Prueba.");
    expect(out).toContain("Write\nto [to be confirmed],");
  });

  it("escapes what it is given", () => {
    const out = renderPrivacy("<p>{{controller}}</p>", { privacy: { controller: 'A & B <S.L.> "x"' } });
    expect(out).toBe("<p>A &amp; B &lt;S.L.&gt; &quot;x&quot;</p>");
  });

  it("refuses a token it does not know, rather than shipping it", () => {
    expect(() => renderPrivacy("<p>{{controler}}</p>", FULL)).toThrow(/unknown token/);
  });
});

describe("the privacy notice — the route", () => {
  // The dev server answers /privacy from a middleware; production only does
  // because of this line.
  it("is served at /privacy by a rewrite in vercel.json", () => {
    expect(VERCEL.rewrites).toEqual([{ source: "/privacy", destination: "/privacy.html" }]);
  });

  // The rewrite must not become a catch-all: the app is one page at "/", and a
  // `/(.*)` rewrite would answer /api/* misses and the worker's own file with
  // HTML.
  it("rewrites nothing else", () => {
    for (const r of VERCEL.rewrites) expect(/[(*:]/.test(r.source)).toBe(false);
  });
});

describe("the privacy notice — what is still owed", () => {
  // The owner's legal name and a contact are not ours to invent. While either
  // is blank the page says "[to be confirmed]" in public, so ROADMAP must keep
  // saying so; the day both are filled, this fails until the entry is removed.
  it("ROADMAP lists the missing legal details exactly as long as they are missing", () => {
    const listed = read("ROADMAP.md").includes("`profile.privacy`");
    expect(listed).toBe(privacyIncomplete(profile));
  });
});
