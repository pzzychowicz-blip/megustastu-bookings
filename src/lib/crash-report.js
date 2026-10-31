// src/lib/crash-report.js
//
// v18.13.0 (#28): what one crash on a device leaves behind. Until this version
// ErrorBoundary called `console.error` and nothing listened to `window`, so every fault
// on a restaurant device depended on staff reporting it or on the USB rig. A crash now
// becomes one `activity` entry of kind `crash`, written by `main.jsx`, which owns the
// listeners. This file decides what the entry says, and whether to write it at all.
//
// ── NO GUEST DATA ───────────────────────────────────────────────────────────
// `.read` is `auth != null` at the root, so an entry is readable by every account, and
// a crash has no business carrying a phone number there. So nothing is copied wholesale:
//   • The stack is a WHITELIST, not a mask. A frame is kept only as a function name and
//     a file:line:col in plain characters, and every other line is dropped, which is
//     also what removes the message V8 repeats on the stack's first line.
//   • The digit mask is for the MESSAGE alone. A column in a minified bundle can be six
//     digits, and the columns are what the rebuild runbook decodes.
//   • A value that is not an Error is never described. A promise can reject with a
//     booking, and a booking's `.name` is a guest's, so `name` is read from a real Error
//     only and an object contributes nothing at all.
//   • A double-quoted run in a message is masked, first quote to last, because that is
//     where a built-in error quotes its input: V8's JSON.parse puts the text it could
//     not read there. Single quotes stay, because `(reading 'time')` is the useful half
//     of a TypeError and they only ever hold a property name.
//
// ── ONE ENTRY, NOT A FLOOD ──────────────────────────────────────────────────
// An effect that throws on every 15s tick would otherwise write a row for each one, for
// as long as the tablet stays on, to a database with no automatic backups. `crashGate`
// allows one entry per signature and five per page load.

export const MAX_PER_LOAD = 5;
const MESSAGE_MAX = 300;
// How much of a message the mask reads. Its address pattern is quadratic on a long token
// (50 KB took 2.5 s, measured), this runs on the main thread inside an error handler, and
// it runs before the gate, so a repeat pays too. A mask shortens what it matches, so it
// needs more than the cap; nothing past the cap is kept.
const MESSAGE_SCAN = MESSAGE_MAX * 4;
const TEXT_MAX = 160;
const FRAMES_MAX = 12;
const STACK_MAX = 1500;
const COMPONENT_MAX = 600;
const LABEL_MAX = 60;

// What the browser or the network says, which is no fault of the app's. Each is anchored
// to the whole message: "Failed to fetch dynamically imported module: …" is a chunk that
// went missing, which is a real failure and stays. `event.message` carries an "Uncaught "
// prefix where `event.error` is empty.
const NOISE = [
  /^(Uncaught )?ResizeObserver loop/,
  /^(Uncaught )?Script error\.?$/,
  /^(Uncaught )?(TypeError: )?(Failed to fetch|Load failed|NetworkError when attempting to fetch resource\.?)$/,
];
const EXTENSION_RE = /\b(chrome|moz|safari|safari-web)-extension:\/\//;

function cap(s, max) {
  const t = String(s == null ? "" : s);
  return t.length > max ? t.slice(0, max - 1) + "…" : t;
}

// An address, a quoted value, and six digits or more, counted through a phone's own
// spaces and dashes: "+34 600 123 456" is three runs of three, and still one number.
//
// A quoted value runs from the FIRST quote to the LAST, and a lone quote to the end.
// V8 prints a short text it could not parse whole, its own quotes included, so masking
// in pairs turned `"x{"n":"Ana"}"` into `"#"n"#"Ana"#"` and left the value standing.
export function maskText(s) {
  return String(s == null ? "" : s)
    .replace(/[^\s@"']+@[^\s@"']+\.[^\s@"']+/g, "#")
    .replace(/"[\s\S]*"/, '"#"')
    .replace(/^([^"]*)"[^"]*$/, '$1"#"')
    .replace(/\+?\(?\d(?:[\s().-]*\d){5,}/g, "#");
}

// One stack line → "fn path:line:col", or null for anything that is not a frame. V8
// writes `at fn (loc)` or `at loc`; Safari and Firefox write `fn@loc`.
function frameOf(line) {
  const m = /^\s*at\s+(?:(.*?)\s+\()?(.*?)\)?\s*$/.exec(line) || /^\s*(.*?)@(.*)$/.exec(line);
  if (!m) return null;
  const loc = /^(?:[a-z-]+:\/\/[^/]*)?\/?([\w./-]+)(?:\?[^:]*)?:(\d+):(\d+)$/i.exec(m[2]);
  if (!loc) return null;
  const fn = /^[\w$.<>[\] -]{1,80}$/.test(m[1] || "") ? m[1] : "";
  return (fn ? fn + " " : "") + loc[1] + ":" + loc[2] + ":" + loc[3];
}

export function framesOf(stack) {
  return String(stack == null ? "" : stack).split("\n").map(frameOf).filter(Boolean).slice(0, FRAMES_MAX);
}

// Whose error it is: the frame that threw. An extension that wraps fetch, a timer or
// addEventListener sits further down an app crash's stack without having caused it.
function thrownByExtension(stack) {
  return EXTENSION_RE.test(stack.split("\n").find(frameOf) || "");
}

// What a throw can be: anything. Only an Error is believed about itself.
function describe(thrown) {
  if (thrown instanceof Error) {
    return {
      name: /^[A-Za-z]{1,40}$/.test(thrown.name) ? thrown.name : "Error",
      message: thrown.message || "(no message)",
      stack: typeof thrown.stack === "string" ? thrown.stack : "",
    };
  }
  const text = typeof thrown === "string" || typeof thrown === "number" ? String(thrown) : "";
  return { name: "Error", message: text || "(not an Error)", stack: "" };
}

// crashEntry(thrown, {where, version, view, device, componentStack}) → null for noise,
// or {signature, entry}. `where` is "render" · "error" · "rejection". Every field the
// caller hands in is a label of the app's own, capped so the rule's bound always holds.
export function crashEntry(thrown, ctx) {
  const c = ctx || {};
  const d = describe(thrown);
  if (NOISE.some((re) => re.test(d.message)) || thrownByExtension(d.stack)) return null;
  const message = cap(maskText(String(d.message).slice(0, MESSAGE_SCAN)), MESSAGE_MAX);
  const frames = framesOf(d.stack);
  const crash = {
    where: cap(c.where || "error", LABEL_MAX),
    name: d.name,
    message,
    version: cap(c.version || "unknown", LABEL_MAX),
  };
  // Optional keys are omitted, never undefined: `set()` throws on one (root Gotchas).
  if (frames.length) crash.stack = cap(frames.join("\n"), STACK_MAX);
  const component = framesOf(c.componentStack);
  if (component.length) crash.component = cap(component.join("\n"), COMPONENT_MAX);
  if (c.view) crash.view = cap(c.view, LABEL_MAX);
  if (c.device) crash.device = cap(c.device, LABEL_MAX);
  return {
    signature: [d.name, message, frames[0] || ""].join("|"),
    entry: {
      kind: "crash",
      auto: true,
      text: cap("crash" + (crash.view ? " in " + crash.view : "") + ": " + d.name + ": " + message, TEXT_MAX),
      crash,
    },
  };
}

// One gate per page load, in `main.jsx`. A signature that has been written, or any
// signature past the cap, answers false, so a loop costs one row and a cascade five.
export function crashGate(max = MAX_PER_LOAD) {
  const seen = new Set();
  return function admit(signature) {
    if (seen.has(signature) || seen.size >= max) return false;
    seen.add(signature);
    return true;
  };
}

// The view on screen, kept here because `main.jsx` sits above `BookingApp` and the tree
// that held the state is gone by the time a crash is reported. `BookingApp` notes it.
let viewNow = "";
export function noteCrashView(view) { viewNow = view || ""; }
export function crashView() { return viewNow; }

// ── THE DOWNLOAD ────────────────────────────────────────────────────────────
export const CRASH_EMPTY = "No crashes have been recorded.";
export const CRASH_UNREADABLE = "Couldn't read the crash data. Please try again.";
export const CRASH_UNSAVED = "Couldn't create the file on this device.";

// The file: crash entries and nothing else, oldest first, or "" when there are none. The
// read asks for the kind already; this filters again, because the promise is the file's.
export function crashFileText(rows) {
  const list = (Array.isArray(rows) ? rows : [])
    .filter((r) => r && r.kind === "crash")
    .sort((a, b) => (a.at || 0) - (b.at || 0))
    .map((r) => ({ at: r.at ? new Date(r.at).toISOString() : null, email: r.email || "", ...(r.crash || {}) }));
  return list.length ? JSON.stringify(list, null, 2) + "\n" : "";
}

// Resolves to what the screen should say, "" when the file was handed over. It never
// rejects, so the caller has one path. `read` and `save` are handed in, which is what
// keeps Firebase and the DOM out of this file, as `runBackup` does.
export function downloadCrashes({ read, save, today }) {
  return read().then(function (rows) {
    const text = crashFileText(rows);
    if (!text) return CRASH_EMPTY;
    try {
      save(text, "mgt-crashes-" + today + ".json", "application/json");
      return "";
    } catch {
      return CRASH_UNSAVED;
    }
  }, function () { return CRASH_UNREADABLE; });
}
