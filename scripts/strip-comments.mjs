// scripts/strip-comments.mjs
//
// v17.13.0 — one comment-stripper, for the two checkers that need one.
//
// Both `check-style-invariants.mjs`'s colour rule and `tests/a11y.test.js` have
// to answer "does this file DO X", and in this repo the commentary is the
// hazard: half the apparent colour literals are prose about colour literals,
// and `ConnectionStatus.jsx` contains the sentence "NOT `aria-modal` and no
// focus trap" — which a grep for `aria-modal` reads as the opposite of what it
// says. Both checkers found that out by reporting a false positive on their
// first run, one after the other, which is why this is shared rather than
// written twice.
//
// It skips over string literals, so a `//` inside a URL or a `/*` inside a
// regex is not read as a comment.

export function stripComments(text) {
  const out = [];
  let block = false;
  for (const line of text.split("\n")) {
    let res = "", quote = null, i = 0;
    while (i < line.length) {
      const c = line[i], d = line[i + 1];
      if (block) {
        if (c === "*" && d === "/") { block = false; i += 2; } else i++;
        continue;
      }
      if (quote) {
        res += c;
        if (c === "\\") { res += d === undefined ? "" : d; i += 2; continue; }
        if (c === quote) quote = null;
        i++;
        continue;
      }
      if (c === '"' || c === "'" || c === "`") { quote = c; res += c; i++; continue; }
      if (c === "/" && d === "/") break;
      if (c === "/" && d === "*") { block = true; i += 2; continue; }
      res += c; i++;
    }
    out.push(res);
  }
  return out;
}

