// tests/wa-draft-source.test.js — v18.4.9
//
// Accept & open remembers which conversation the booking form was opened for
// (`draftSourceRef`), and the save marks that conversation accepted. Only a
// saved new booking took the source, so a form closed unsaved left it set and
// the next new booking, from any door, was credited to that conversation
// (reproduced on DEV: Accept, Back, + New, Save, and the abandoned draft read
// "accepted", linked to the unrelated booking). The source now lasts as long
// as the form: the hook drops it when the form closes.
//
// No test mounts the hook (tests/CLAUDE.md), so this reads it, stripped.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { stripComments } from "../scripts/strip-comments.mjs";

const read = (p) => stripComments(readFileSync(new URL(p, import.meta.url), "utf8")).join("\n");
const HOOK = read("../src/hooks/useWhatsApp.js");
const APP = read("../src/App.jsx");

describe("an accepted draft's source lasts as long as the form it opened", () => {
  it("the hook drops it when the form closes", () => {
    expect(HOOK).toMatch(/useEffect\(function \(\) \{ if \(!formOpen\) draftSourceRef\.current = null; \}, \[formOpen\]\);/);
  });
  it("App tells the hook whether the form is open", () => {
    const call = APP.slice(APP.indexOf("useWhatsApp({"), APP.indexOf("});", APP.indexOf("useWhatsApp({")));
    expect(call).toContain("formOpen: showForm,");
  });
  it("Accept & open sets it only once the form's door has let it through", () => {
    const fn = HOOK.slice(HOOK.indexOf("function handleAcceptDraft("), HOOK.indexOf("function takeDraftSource("));
    const open = fn.indexOf("if (!openNew("), set = fn.indexOf("draftSourceRef.current = conv.phoneKey;");
    expect(open).toBeGreaterThan(-1);
    expect(set).toBeGreaterThan(open);
  });
  it("and nothing else sets it", () => {
    const sets = HOOK.match(/draftSourceRef\.current = (?!null)[^;]+;/g) || [];
    expect(sets).toEqual(["draftSourceRef.current = conv.phoneKey;"]);
  });
  it("a save takes it in its handler, ahead of closing the form", () => {
    const fn = APP.slice(APP.indexOf("function doSaveNew("), APP.indexOf("function doSave("));
    const take = fn.indexOf("wa.takeDraftSource()"), close = fn.indexOf("setShowForm(false)");
    expect(take).toBeGreaterThan(-1);
    expect(close).toBeGreaterThan(take);
  });
});
