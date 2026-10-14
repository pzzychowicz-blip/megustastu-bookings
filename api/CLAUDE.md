# api/ — the serverless functions

Moved from the root `CLAUDE.md` File Structure block on 2026-09-18, so it loads when
Claude opens a file here instead of in every session. Same words, rewrapped.

**serverless functions — new to `main` in v18.0.0 phase 5**, and the first code in this
repo that does not run in the browser. Vercel deploys the directory WHOLESALE, so there
is no build-time way to keep a file out of production: every gate here is a RUNTIME one,
checked as the handler's first statement. `wa-inbound.js` is a **public URL the moment
this merges** — the single riskiest fact in the release, and the reason phase 5b exists.
`_lib/` holds the shared halves (`env` · `gemini` · `inbound-core` · `meta` · `rtdb`);
`rtdb.js` writes through **firebase-admin**, which bypasses the security rules entirely
— see the CAS exemptions under the Rule of law below, which are about exactly that. The
three `wa-sim-*.js` endpoints are the simulator's and must return 404 unless
`WA_SIM_ENABLED === "1"`. Node ESM resolves these imports, so anything under `src/lib`
they reach must carry explicit `.js` extensions — the chain is `api/* → whatsapp.js →
customers.js → booking-logic.js → booking-fields/constants/day/phone-countries`, and
`booking-fields.js → constants/vouchers` (v18.3.4). **v18.0.0 phase 5b gates the
three sim handlers on `simEnabled()`** (`WA_SIM_ENABLED === "1"`), as each handler's
FIRST statement — before the method check and before staff auth, so the answer is
indistinguishable from "no such endpoint": a 405 or a 401 would both confirm the handler
is there. Fail-closed, and measured across five env values — absent, empty, `"0"`,
`"true"` and `"1"` — where only the last opens it. **Since the phase-5 review those
three are also excluded from a deployment by `.vercelignore`**, so PRODUCTION routes
FIVE functions (`wa-inbound` · `wa-send` · `wa-recheck` · `wa-config` · `wa-media`, the
last since v18.8.0) and the `sandbox`
branch gets its three back through one appended `!api/wa-sim-*.js`. Since v18.4.3 that
branch is GENERATED from main by `.github/workflows/sandbox.yml`, which writes the line;
it is never written on main and never by hand. The runtime gate stays: two independent answers, and
the 404 is the one that still holds if the ignore file is ever edited. `_lib/` is
underscore-prefixed so Vercel does not route it. **`wa-config.js` (phase 5) answers
"which server-side keys are configured" as a BOOLEAN PER KEY and never a value** — it is
what the Admin tab's Integrations section renders. It cannot leak a secret by mistake
because it never holds one (`Boolean(env(k, null))` is the whole of it), and it is
staff-auth gated because a map of which integrations are unconfigured is a map of where
a deployment is soft. The client keeps its own labels and groups and asks only the
question a browser cannot answer — presentation there, fact here, so the key list is not
one list in two places

**The `jose` override in `package.json` is load-bearing for every function here**
(`"overrides": { "jose": "^5.9.6" }`, currently resolving to 5.10.0). firebase-admin
verifies ID tokens through `jwks-rsa`, which declares `jose ^6.1.3` and loads it with
`require('jose')`. But jose 6 is ESM-only, and Vercel's function runtime could not
`require()` an ES module: every function died with `ERR_REQUIRE_ESM` /
`FUNCTION_INVOCATION_FAILED` (commits `9a0e232` and `850713c`, 2026-06-25/26, where
pinning Node 22 alone was not enough). jose 5 ships a CommonJS build, and the JWKS API
`jwks-rsa` uses is the same in both. **Local Node cannot reproduce the failure**,
because it supports `require(esm)`, so a green local run proves nothing about this.
**After any firebase-admin or `jwks-rsa` bump, call one deployed function**
(`wa-config` with a staff token is the cheapest) and check that `npm ls jose` still
shows 5.x. The override can go when Vercel's runtime loads ESM through `require()`,
or when `jwks-rsa` stops requiring `jose` synchronously. Before deleting it, show one
of those is true on a deployment, not locally.

**`wa-media.js` — the media proxy (v18.8.0).** One function for both directions of a
conversation's files, to keep the count low: GET views (phase 4), POST sends (phase 5).
Three rules, each the reason for a line of it:
- **Never trust a client media id.** The browser names a MESSAGE (`phoneKey` + `msgId`);
  the id is read from the database (`getMessage`). It goes into a Graph path with the
  restaurant's token on it, so one taken from a query string would let any signed-in
  account fetch any media that token can reach. The id was checked when it was stored
  (`sanitizeMedia`), and the URL Meta hands back is fetched with the token only on Meta's
  hosts, over https (`isMediaHost`, `_lib/meta.js`).
- **Streamed, never buffered.** Vercel caps a function's request and response body at
  4.5 MB, and its guide says a streamed response does not have the cap; the bytes are
  piped as they arrive (`pipeline(Readable.fromWeb(…), res)`). The cap here is the
  browser's: over `MEDIA_VIEW_MAX` (16 MB) is 413, "open WhatsApp on the phone". The real
  measurement needs a deployment (the plan's A5-6, after merge).
- **Only harmless types keep their type.** A customer chooses what they send, and the
  client opens a document from a blob URL on this origin, so an HTML or SVG file would run
  as the app there. `INLINE_TYPES` (pictures without SVG, audio, PDF, plain text) keep
  theirs; anything else is `application/octet-stream` with `attachment`, plus `nosniff`.
  The client asks the same question (`opensInline`, `src/lib/wa-backend.js`).

Guards in order: 405 → the staff gate (`staffAuthError`) → 400 → 404 → 410 (Meta answers
4xx: it keeps a received file 7 days, a sent one 30) → 413 → 502. **Mock media:** while
`WA_SEND_MODE` is mock, an id starting `MOCK.` is answered with a bundled sample of its
kind (`_lib/mock-media/`: `photo.jpg`, `voice.ogg`, `menu.pdf`, a few kB each), read
through static `new URL(…, import.meta.url)`s so the deployment's file tracing includes
them. On a live deployment a MOCK id is 410. The harness routes it (`/api/wa-media`).
**Phase 6: the simulator's customer sends one too.** Its id has ONE spelling,
`mockMediaId` in `src/lib/wa-mock-media.js` (pure, shared with the server, imported in
`src/` by the simulator's stubbed client alone), which `uploadMedia`'s mock calls as well.
`/api/wa-sim-inbound` takes `media` as a KIND (`image` · `audio` · `document`) and mints the
id itself; anything else, a `{kind, mediaId}` object included, is 400. A media id from a
browser is what this function exists not to trust, sandbox or not. `inboundContent` lives in
`_lib/inbound-core.js` (re-exported by `wa-inbound.js`), so a sim photo is read exactly as
Meta's is.

**The POST sends a photo or a PDF (phase 5).** The file is the RAW body (`bodyParser` off, so a 4 MB
PDF costs 4 MB of Vercel's 4.5 MB request cap, not a base64 field's 5.3), its type the Content-Type,
and the caption and a document's name ride in `X-Caption` / `X-Filename`, percent-encoded, so neither
lands in a URL or a request log (the harness's CORS allows both headers). Guards in order: 405 → the
staff gate → 400 (phoneKey, a header that does not decode, a caption over `WA_CAPTION_MAX`) → 415
(only `WA_SEND_TYPES`: JPEG, PNG, PDF) → 413 (over `WA_SEND_MAX_BYTES`, 4.2 MiB, by Content-Length
and again while reading) → 400 (empty, or the first bytes are not what the Content-Type says:
`sniffType`) → 404 → 410 (the window) → 502. The body is read BEFORE the conversation, so a refusal
never leaves a request half-read. Then `uploadMedia` (`POST /{phone-number-id}/media`, multipart)
and `sendMedia`: **ONE `/messages` call, the caption inside it** (checklist A4-5; `sendText` and
`sendMedia` share `postMessage`, the one function that POSTs a message). The outbound message is
stored with `media` (through `sanitizeMedia`, so a sent name is cleaned before it is SENT too) and
`authorEmail`, the snippet updated and the conversation un-archived, as `wa-send` does. In mock mode
the upload returns `MOCK.<kind>.<random>`, which the GET above answers with the sample.

**Tests (v18.4.5).** `tests/api-handlers.test.js` RUNS `wa-send`, `wa-recheck`, `wa-config`,
`_lib/inbound-core.js` and `_lib/meta.js`: it replaces the three `firebase-admin` modules
with an in-memory tree, so `_lib/rtdb.js` itself runs, and calls each handler with a
request and a response object. A new handler joins its `describe.each` for the shared
method and staff-auth gate. **v18.8.0 runs the other four**: `wa-inbound` from a raw byte
stream (`rawCall`, since `bodyParser` is off and the HMAC needs Meta's exact bytes), with a
stub request context collecting what `waitUntil` was handed so a test can wait for the parse;
and the three `wa-sim-*` handlers, whose 404 is swept over five env values, two methods and
three tokens before their own gate is asked anything. **And `wa-media` both ways**: the GET joins the
shared gate, and the POST's own refusals, the stored shape, and A4-5 as an assertion: one Graph
`/messages` call per `wa-send` and per `wa-media` POST, an upload that is not one, and a caption that
never becomes a second message (mutation-checked: a caption sent as its own text fails it).

**A timestamp taken from a remote party** (the root `CLAUDE.md`'s Gotchas row, moved
here verbatim on 2026-10-09; root keeps the rule in two sentences). **Clamp it to facts, not policies:** not finite or not positive → now; in the future → now (a delivery cannot be timestamped after it arrived, so this only absorbs clock skew); an OLD one is left alone, because a redelivery after an outage is real. The trap was `m.timestamp ? … : Date.now()` guarding `parseInt(m.timestamp, 10) * 1000` on a Meta webhook field (Meta sends SECONDS) — a ternary covering ABSENT, the one case that was never a problem. Measured with correctly-signed payloads (CT-WA-02): `"abc"` → `NaN` → **RTDB refuses the write** → 500 → **Meta redelivers for up to SEVEN DAYS**, so the customer's message is never stored and the function runs on a schedule for a week; `"-1"` → `windowExpiresAt` in 1970, so `api/wa-send.js` answers 410 forever and staff can never reply to that customer, with nothing on screen saying why; `99999999999` → a window in the year 5138. **Correct retry semantics plus a permanently-failing input is a retry loop**, and an input the database REFUSES is what turns a bad field into a bad week
