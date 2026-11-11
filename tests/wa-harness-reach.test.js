// tests/wa-harness-reach.test.js
//
// Who can reach the local WhatsApp harness (scripts/wa-backend-dev.mjs), from
// the 2026-11-10 security review. Its webhook is unsigned and /dev/* has no
// gate, with the DEV service account and the Gemini key behind them, so two
// properties must hold: it listens on this machine's loopback unless `--host`
// was asked for, and it refuses a request a web page elsewhere could make.
//
// The harness listens the moment it is imported, so it is READ here, not run
// (it was checked live with curl, in both modes, when this was written). The
// two patterns are rebuilt from the file's own one list of names.

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { stripComments } from "../scripts/strip-comments.mjs";
import { harnessCmd } from "../src/lib/wa-backend";

// Code only: the file's comments name the calls this test looks for.
const code = stripComments(fs.readFileSync(new URL("../scripts/wa-backend-dev.mjs", import.meta.url), "utf8")).join("\n");

function only(re, what) {
  const all = code.match(re) || [];
  if (all.length !== 1) throw new Error("expected exactly one " + what + ", found " + all.length);
  return all[0];
}

describe("the harness listens on the loopback unless --host", () => {
  it("every listen names its host", () => {
    expect(only(/\.listen\([^)]*\)/g, ".listen( call")).toBe(".listen(PORT, host, onListening)");
  });
  it("every interface is behind the flag, and the default is both loopbacks", () => {
    expect(only(/const LAN = [^;]+;/g, "LAN definition")).toBe('const LAN = process.argv.includes("--host");');
    const calls = code.match(/listenOn\((?!host)[^)]*\)/g) || [];
    expect(calls).toEqual(['listenOn(undefined, banner)', 'listenOn("127.0.0.1", banner)', 'listenOn("::1")']);
    expect(code).toContain('if (LAN) listenOn(undefined, banner);\nelse { listenOn("127.0.0.1", banner); listenOn("::1"); }');
  });
});

describe("the harness refuses what a web page elsewhere could send", () => {
  const list = JSON.parse(only(/const DEV_HOST = ("(?:[^"\\]|\\.)*");/g, "DEV_HOST").replace(/^const DEV_HOST = /, "").replace(/;$/, ""));
  const ORIGIN = new RegExp("^http://" + list + ":\\d+$");
  const HOST = new RegExp("^" + list + "(:\\d+)?$");

  it("both patterns are built from that one list", () => {
    expect(code).toContain('const DEV_ORIGIN_RE = new RegExp("^http://" + DEV_HOST + ":\\\\d+$");');
    expect(code).toContain('const DEV_HOST_RE = new RegExp("^" + DEV_HOST + "(:\\\\d+)?$");');
  });
  it("the dev app's origins pass, a site's do not", () => {
    for (const o of ["http://localhost:5173", "http://127.0.0.1:5179", "http://[::1]:5173", "http://192.168.1.34:5179", "http://10.0.0.7:5173", "http://172.16.0.2:5173"]) {
      expect(ORIGIN.test(o), o).toBe(true);
    }
    for (const o of ["https://example.com", "http://example.com:3999", "null", "https://localhost:5173", "http://localhost.evil.test:5173", "http://172.32.0.1:5173", "http://8.8.8.8:5173"]) {
      expect(ORIGIN.test(o), o).toBe(false);
    }
  });
  it("this machine's Host passes, a re-pointed name's does not", () => {
    for (const h of ["localhost:3999", "127.0.0.1:3999", "[::1]:3999", "192.168.1.42:3999", "localhost"]) expect(HOST.test(h), h).toBe(true);
    for (const h of ["attacker.example:3999", "localhost.evil.test:3999", "abc.ngrok.app", "8.8.8.8:3999"]) expect(HOST.test(h), h).toBe(false);
  });
  it("the refusal comes before anything is answered or routed", () => {
    const body = code.slice(code.indexOf("async function handle(req, res)"));
    const refuse = body.indexOf("originRefused(req)");
    expect(refuse).toBeGreaterThan(-1);
    expect(refuse).toBeLessThan(body.indexOf("cors(req, res)"));
    expect(refuse).toBeLessThan(body.indexOf("vercelify(req, res)"));
  });
});

describe("harnessCmd: the command that makes it reachable from this page", () => {
  it("on the Mac itself, the plain command", () => {
    for (const h of ["localhost", "127.0.0.1", "[::1]", "", undefined]) expect(harnessCmd(h), String(h)).toBe("npm run wa:backend");
  });
  it("from a LAN address, the opt-in", () => {
    expect(harnessCmd("192.168.1.42")).toBe("npm run wa:backend -- --host");
  });
  // Every DEV hint reads the one string: a hand-typed copy tells a phone to
  // start a harness that is already running.
  it("no hint under src/ types the command itself", () => {
    const typed = [];
    (function walk(dir) {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const f = new URL(e.name + (e.isDirectory() ? "/" : ""), dir);
        if (e.isDirectory()) { walk(f); continue; }
        if (!/\.jsx?$/.test(e.name)) continue;
        const n = (stripComments(fs.readFileSync(f, "utf8")).join("\n").match(/npm run wa:backend/g) || []).length;
        if (n) typed.push(e.name + " x" + n);
      }
    })(new URL("../src/", import.meta.url));
    expect(typed).toEqual(["wa-backend.js x1"]);
  });
});
