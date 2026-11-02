// tests/settings-preload.test.js — v18.14.0 (correction 34, Patryk)
//
// Settings is the one lazy surface whose frame is drawn before its chunk: Overlay and
// Close are App's, so a first open was a bare footer that jumped 283px when the chunk
// landed. `lazyChunk`'s `preload` fetches it once the day has loaded, and from then on
// the chunk answers React.lazy with a thenable that resolves inside the call.
//
// That last part leans on how React reads a thenable, so the first describe runs it,
// with a real promise as the control, rather than trusting a comment.

import { describe, it, expect, vi } from "vitest";
import { createElement, lazy, Suspense } from "react";
import { renderToString } from "react-dom/server";
import { appCode } from "./app-source.js";
import { afterIdle } from "../src/lib/after-frame.js";

const Mod = { default: () => createElement("p", null, "ready") };
const open = (load) => renderToString(createElement(Suspense, { fallback: "waiting" }, createElement(lazy(load))));

describe("React.lazy and a thenable that has already answered", () => {
  it("renders without suspending", () => {
    const html = open(() => ({ then(ok) { ok(Mod); } }));
    expect(html).toContain("ready");
    expect(html).not.toContain("waiting");
  });
  it("is what makes the difference: a real promise suspends, however resolved", () => {
    const html = open(() => Promise.resolve(Mod));
    expect(html).toContain("waiting");
    expect(html).not.toContain("ready");
  });
});

describe("lazyChunk", () => {
  const app = appCode();
  const at = app.indexOf("function lazyChunk(load,name){");
  const fn = app.slice(at, app.indexOf("const SettingsContent = lazyChunk(", at));
  it("answers at once when the chunk is here, and takes the ordinary path when it is not", () => {
    expect(at).toBeGreaterThan(-1);
    expect(fn).toContain("if(ready){arrived(ready);return {then:function(ok){ok(ready);}};}");
    expect(fn).toContain("return load().then(arrived).catch(function(err){");
  });
  it("clears the reload flag when a surface somebody asked for arrives, on either path", () => {
    const arrived = fn.slice(fn.indexOf("function arrived(m){"), fn.indexOf("const chunk=lazy("));
    expect(arrived).toContain('sessionStorage.removeItem("mgt-chunk-reload")');
    expect(fn.match(/removeItem\("mgt-chunk-reload"\)/g)).toHaveLength(1);
  });
  // Measured with one screen's chunk refused: the preload cleared the flag at every
  // boot, so three presses were three reloads and the screen's error never showed.
  it("keeps a preload out of it: silent if it fails, and the flag is left alone if it lands", () => {
    expect(fn).toContain("chunk.preload=function(){load().then(function(m){ready=m;}).catch(function(){});};");
  });
});

describe("the preload", () => {
  const app = appCode();
  it("waits for the day, then for an idle moment", () => {
    const at = app.indexOf("SettingsContent.preload()");
    expect(at).toBeGreaterThan(-1);
    const effect = app.slice(app.lastIndexOf("useEffect(function(){", at), app.indexOf("},[bookingsReady]);", at));
    expect(effect).toContain("if(!bookingsReady) return undefined;");
    expect(effect).toContain("return afterIdle(function(){SettingsContent.preload();});");
  });
  it("is Settings' alone: every other lazy surface draws nothing until it is here", () => {
    expect(app.match(/\.preload\(\)/g)).toHaveLength(1);
  });
});

describe("afterIdle", () => {
  it("takes a timer where there is no requestIdleCallback, and cancels", () => {
    vi.useFakeTimers();
    try {
      const fn = vi.fn();
      afterIdle(fn)();
      vi.runAllTimers();
      expect(fn).not.toHaveBeenCalled();
      afterIdle(fn);
      vi.runAllTimers();
      expect(fn).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
