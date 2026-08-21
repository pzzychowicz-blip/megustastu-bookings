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
// It skips over string literals AND regex literals, so a `//` inside a URL and a
// `/*` inside a regex are both left alone.
//
// /code-review: the first version claimed the regex half and did not do it. A
// regex is not a string, so `/https:\/\//` was read as code up to its escaped
// `//`, which then truncated the rest of the LINE — and for a `/*` it would have
// swallowed everything up to the next `*/`, i.e. real code across many lines.
// No source line in this repo trips it today, so it was a blind spot with a
// comment asserting it did not exist: the exact defect both callers were written
// to avoid. A regex literal is told from division by what PRECEDES the slash —
// after a value (identifier, number, `)`, `]`) a `/` is division; anywhere else
// it opens a regex.

// A `/` opens a regex literal unless the previous significant character could
// end a VALUE — in which case it is division. Deliberately conservative: a wrong
// "yes" only means a slash-delimited run is copied through verbatim, which is
// what the old code did to everything anyway.
function regexAllowedAfter(sofar) {
  const prev = sofar.replace(/\s+$/, "").slice(-1);
  if (!prev) return true;
  return !/[\w$)\]]/.test(prev);
}

// Copy a regex literal through verbatim, honouring backslash escapes and
// character classes (where an unescaped `/` is legal). Returns the index just
// past the closing delimiter; on an unterminated literal it returns the end of
// the line, which fails SAFE — the line is kept as code and still gets checked.
function skipRegex(line, start, emit) {
  let i = start + 1, cls = false;
  emit("/");
  while (i < line.length) {
    const c = line[i];
    emit(c);
    if (c === "\\") { if (i + 1 < line.length) emit(line[i + 1]); i += 2; continue; }
    if (c === "[") cls = true;
    else if (c === "]") cls = false;
    else if (c === "/" && !cls) return i + 1;
    i++;
  }
  return i;
}

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
      if (c === "/" && regexAllowedAfter(res)) { i = skipRegex(line, i, (t) => { res += t; }); continue; }
      res += c; i++;
    }
    out.push(res);
  }
  return out;
}

