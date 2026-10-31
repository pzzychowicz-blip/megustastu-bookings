// tests/lift.js — running the app's own closures with no DOM.
//
// Moved out of tests/save-path.test.js in v18.13.0, when tests/write-gate.test.js
// became its second user: a helper this particular is one copy or it is two that
// disagree. The method is save-path's, and its header holds the reasoning:
// `App.jsx` and the hooks keep their logic in closures no test can call, this suite
// deliberately has no DOM (tests/CLAUDE.md), so a test lifts the functions out of
// the comment-stripped source and compiles them in one scope of its own.
//
// Every free name in the lifted text must be bound, and ESLint's `no-undef` decides
// which names those are, so a stub that goes missing fails the COMPILE rather than
// the one scenario that happens to reach it.

import { Linter } from "eslint";
import globals from "globals";

// Skip a string literal starting at `i`; returns the index of its closing quote.
function skipString(src, i) {
  const q = src[i];
  for (let j = i + 1; j < src.length; j++) {
    if (src[j] === "\\") { j++; continue; }
    if (src[j] === q) return j;
  }
  throw new Error("unterminated string at " + i);
}
// The index of the brace closing the one opened at `open`, skipping strings.
function closeOf(src, open) {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === '"' || c === "'" || c === "`") { i = skipString(src, i); continue; }
    if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return i;
  }
  throw new Error("unbalanced braces from " + open);
}
// `function NAME(…){…}` — exactly one declaration, or the lift is ambiguous.
export function liftFunction(src, name) {
  const head = "function " + name + "(";
  const at = src.indexOf(head);
  if (at < 0) throw new Error("no function " + name);
  if (src.indexOf(head, at + 1) >= 0) throw new Error("two functions named " + name);
  const open = src.indexOf("{", src.indexOf(")", at));
  return src.slice(at, closeOf(src, open) + 1);
}
// The `useEffect(function(){…}` callback whose body holds `marker`.
export function liftEffect(src, marker, as) {
  const m = src.indexOf(marker);
  if (m < 0) throw new Error("no marker " + marker);
  const at = src.lastIndexOf("useEffect(function(){", m);
  const open = src.indexOf("{", at);
  const close = closeOf(src, open);
  if (close < m) throw new Error("marker " + marker + " is not inside the effect before it");
  return "function " + as + "()" + src.slice(open, close + 1);
}

// `import { a, b as c } from "…/lib/x"` → { c: LIB.x.b, … } for every name the
// lifted text actually uses. Word-boundary match: binding an unused name is
// harmless, missing a used one is not (and `freeNames` below catches that).
// A name imported from anywhere that is not in `LIB` (a component, a hook,
// firebase) fails the scope build loudly rather than running without it, unless
// `env` binds it, which is the test saying so on purpose.
export function importScope(LIB, src, lifted, env) {
  const scope = {};
  const re = /import\s*\{([^}]*)\}\s*from\s*"([^"]+)"/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const lib = /(?:^|\/)lib\/([\w-]+)$/.exec(m[2]);
    m[1].split(",").map((s) => s.trim()).filter(Boolean).forEach((spec) => {
      const [imported, local] = spec.split(/\s+as\s+/).map((x) => x.trim());
      const name = local || imported;
      if (!new RegExp("\\b" + name.replace(/\$/g, "\\$") + "\\b").test(lifted)) return;
      const mod = lib && LIB[lib[1]];
      if (!mod) {
        if (name in env) return;
        throw new Error("lifted code uses `" + name + "` from " + m[2] + ", which the harness does not provide");
      }
      if (!(imported in mod)) throw new Error(m[2] + " has no export " + imported);
      scope[name] = mod[imported];
    });
  }
  return scope;
}

// Every free name in the lifted text, by ESLint's own `no-undef` (a direct
// devDependency, so this is the linter's scope analysis rather than a regex).
const freeNamesCache = new Map();
export function freeNames(text) {
  if (freeNamesCache.has(text)) return freeNamesCache.get(text);
  const msgs = new Linter().verify(text, {
    languageOptions: { ecmaVersion: 2024, sourceType: "script", globals: { ...globals.builtin } },
    rules: { "no-undef": "error" },
  });
  const fatal = msgs.filter((m) => m.ruleId !== "no-undef");
  if (fatal.length) throw new Error("lifted code does not parse: " + fatal[0].message);
  const names = Array.from(new Set(msgs.map((m) => /'([^']+)'/.exec(m.message)[1]))).sort();
  freeNamesCache.set(text, names);
  return names;
}

// `LIB` is the lib modules the lifted code may bind, by basename. The returned
// `compile` builds the lifted functions together, so they call each other as they
// do in the file, inside one scope: the file's lib imports plus `env`.
export function compiler(LIB) {
  return function compile(fileSrc, lifted, env) {
    const text = lifted.join("\n");
    const imports = importScope(LIB, fileSrc, text, env);
    Object.keys(env).forEach((k) => {
      if (k in imports) throw new Error("env shadows the import " + k);
    });
    const unbound = freeNames(text).filter((n) => !(n in imports) && !(n in env));
    if (unbound.length) throw new Error("lifted code uses names the harness does not bind: " + unbound.join(", "));
    const names = Object.keys(imports).concat(Object.keys(env));
    const exported = lifted.map((src) => /^function ([\w$]+)\(/.exec(src)[1]);
    const body = '"use strict";\n' + text + "\nreturn {" + exported.join(",") + "};";
    return new Function(...names, body)(...names.map((n) => (n in env ? env[n] : imports[n])));
  };
}
