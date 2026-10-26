# api/ — the serverless functions

Moved from the root `CLAUDE.md` File Structure block on 2026-09-18, so it loads when
Claude opens a file here instead of in every session. Same words, rewrapped.

**serverless functions — new to `main` in v18.0.0 phase 5**, and the first code in this
repo that does not run in the browser. Vercel deploys the directory WHOLESALE, so there
is no build-time way to keep a file out of production: every gate here is a RUNTIME one,
checked as the handler's first statement. `wa-inbound.js` is a **public URL the moment
this merges** — the single riskiest fact in the release, and the reason phase 5b exists.
`_lib/` holds the shared halves (`env` · `gemini` · `inbound-core` · `meta` · `rtdb`, and
since v18.9.0 `coexist-core` · `sim-events` · `request`, the body reader and bearer parse
every staff endpoint shares: a handler that writes either out again fails the tests);
`rtdb.js` writes through **firebase-admin**, which bypasses the security rules entirely
— see the CAS exemptions under the Rule of law below, which are about exactly that. The
three `wa-sim-*.js` endpoints are the simulator's and must return 404 unless
`WA_SIM_ENABLED === "1"`. Node ESM resolves these imports, so anything under `src/lib`
they reach must carry explicit `.js` extensions — the chain is `api/* → whatsapp.js →
customers.js → booking-logic.js → booking-fields/constants/day/phone-countries`, plus
`whatsapp.js → tags.js` and `_lib/rtdb.js → tags.js` (v18.11.0, `readOccasionTags`, which
the three parse callers read beside the hours and `gemini.js` turns into the schema's
enum and one prompt line; `tags.js` imports nothing), and
`booking-fields.js → constants/vouchers` (v18.3.4). **v18.0.0 phase 5b gates the
three sim handlers on `simEnabled()`** (`WA_SIM_ENABLED === "1"`), as each handler's
FIRST statement — before the method check and before staff auth, so the answer is
indistinguishable from "no such endpoint": a 405 or a 401 would both confirm the handler
is there. Fail-closed, and measured across five env values — absent, empty, `"0"`,
`"true"` and `"1"` — where only the last opens it. **Since the phase-5 review those
three are also excluded from a deployment by `.vercelignore`**, so PRODUCTION routes
EIGHT functions (`wa-inbound` · `wa-send` · `wa-recheck` · `wa-config` · `wa-media` ·
`wa-prune`, those two since v18.8.0 · `wa-onboard`, since v18.9.0 · `wa-usage`, since v18.10.0; Hobby allows 12) and the `sandbox`
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
one list in two places. **Beside the booleans it reports three non-secret VALUES**, each
through the function the backend itself runs on, so the Admin tab shows what runs and never
the raw variable (CT-WA-07): the two modes (`llmMode()`, `sendMode()`), and since v18.9.2
the Gemini model (`llmModel`, `geminiModel()` in `_lib/env.js`, which every Gemini call
uses: the default when `GEMINI_MODEL` is unset; in env.js and not gemini.js so this endpoint
never loads the booking-logic chain)

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
Four rules, each the reason for a line of it:
- **Never trust a client media id.** The browser names a MESSAGE (`phoneKey` + `msgId`);
  the id is read from the database (`getMessage`). It goes into a Graph path with the
  restaurant's token on it, so one taken from a query string would let any signed-in
  account fetch any media that token can reach. The id was checked when it was stored
  (`sanitizeMedia`), and the URL Meta hands back is fetched with the token only on Meta's
  hosts, over https (`isMediaHost`, `_lib/meta.js`).
- **Streamed, never buffered.** Vercel caps a function's request and response body at
  4.5 MB, and its guide says a streamed response does not have the cap; the bytes are
  piped as they arrive (`pipeline(Readable.fromWeb(…), res)`). The cap here is the
  browser's: over `MEDIA_VIEW_MAX` (16 MB) is 413, "open WhatsApp on the phone". Measured
  on the sandbox (the plan's A5-6, 2026-10-17): a customer's 11.2 MB PDF opened.
- **Only harmless types keep their type.** A customer chooses what they send, and the
  client opens a document from a blob URL on this origin, so an HTML or SVG file would run
  as the app there. `INLINE_TYPES` (pictures without SVG, audio, PDF, plain text) keep
  theirs; anything else is `application/octet-stream` with `attachment`, plus `nosniff`.
  The client asks the same question (`opensInline`, `src/lib/wa-backend.js`).
- **The message key is a STORED key, and a customer's carries `+` and `=` (v18.9.1).** It is
  the wamid through `sanitizeKey`, which replaces only `. # $ / [ ]`, so base64's `+` and `=`
  padding stay. v18.8.0's character list refused both and every received file answered 400,
  so the check now asks the storing function itself (`isStoredMsgKey`: `sanitizeKey(k) === k`,
  bounded, no control characters). A new endpoint that takes a message key asks the same.

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

**`wa-prune.js` — the nightly message prune (v18.8.0 phase 7).** Vercel Cron calls it at
04:00 UTC (`vercel.json`'s `crons`, the first cron in the repo; `tests/sandbox-branch.test.js`
fails a cron naming a function `main` does not deploy). It deletes WhatsApp messages older than
`settings/admin.waRetentionDays` (a year by default), read through `retentionDaysOf`
(`src/lib/retention.js`, a leaf, so Node ESM can import it), the function the Admin tab uses.
Four rules:
- **The secret first.** `CRON_SECRET` unset → 503 before anything is read. A wrong bearer → 401,
  constant-time, before the method. Vercel sends the variable as a bearer token when the project
  has it, so it is also what makes the cron work. It goes on BOTH projects; the Integrations panel
  shows whether it is set.
- **Per key, never a node.** A conversation goes on its own and a thread's old messages go as one
  update of nulls under its key (`removeConversationIf`, `removeMessages`, `_lib/rtdb.js`).
  firebase-admin bypasses the rules, so this code is the only limit on what it deletes.
- **Re-check at the delete.** The conversation delete is a transaction asking "still expired?" of
  what is stored, so a message that arrived mid-run keeps its thread.
- **Age is the message's own `ts`.** In a live thread, no readable `ts` means keep. In a thread
  being deleted it means go. No readable `lastMessageAt` means the conversation is never deleted.
  Only a conversation created before the cutoff (or with no `createdAt`) is read at all
  (`mayHoldOld`).

It answers the counts and logs one line; an error in any thread makes it 500. Its tests are their own
block in `tests/api-handlers.test.js`, outside the staff-gate `describe.each`, since its gate is the
cron secret.

**`wa-usage.js` — the cost counter (v18.10.0).** GET only. Meta's Pricing Analytics for the
restaurant's WhatsApp Business account, this month and last, summed by `src/lib/wa-usage.js`
(pure, on the Node ESM chain). Nothing is stored, so no node, rule or `SCHEMA` raise. Four rules:
- **A capability, checked here too.** `assertCapability(decoded, "waCostView", …)` (`_lib/rtdb.js`)
  reads `roles/<uid>` and `settings/admin/enforceRoles` and asks the client's own `can()`; a
  refusal is `NOT_ALLOWED` → 403, a read that fails `ROLES_UNREADABLE` → 503. A new endpoint gated
  on a capability uses it rather than re-stating `can`.
- **Which account.** `waLink.wabaId` unless the link is the simulator's (`sim: true`), else
  `META_WABA_ID`; either must be a Meta id (`/^[0-9]{5,25}$/`) before it becomes a Graph path with
  the token on it. Neither → 200 `{configured: false}`. Mock send mode → 200 `{mock: true}` and no
  call. No `META_WA_TOKEN` → 503; Meta's refusal → 502 with Meta's message.
- **Daily buckets, filed by their middle.** Meta cuts a DAILY bucket at the account's own
  midnight, so a bucket is filed under the month its midpoint falls in (`monthOf`) and the range
  starts a day before last month (`monthBounds().askFrom`); the extra day is dropped.
- **Categories (Meta, from 1 Oct 2026).** `FREE_CUSTOMER_SERVICE` counts against the 1,000
  free (`FREE_TIER_MONTHLY`), `REGULAR` is billed, `FREE_ENTRY_POINT` is free and outside the
  1,000; a type Meta adds later counts only as delivered.
The harness routes it (`/api/wa-usage`). Tests: its own block in `tests/api-handlers.test.js`
(fake timers, a stubbed Graph) and `tests/wa-usage.test.js` (the arithmetic).

**Coexistence (v18.9.0) — the Business app and MGT on one number.** Six things, each
a reason for a line of `wa-inbound.js` or `_lib/coexist-core.js`:
- **Dispatch by `change.field`.** `messages` keeps its path; `smb_app_state_sync`
  (contacts), `smb_message_echoes` (a reply typed on the phone), `history` and
  `account_update` go to `COEXIST_HANDLERS`; any other field is counted `ignored` and
  answered 200. An absent field reads as `messages`. It matters beyond tidiness: a
  `history` change carries a `value.messages[]` of its own (a photo arriving after its
  placeholder), which must never reach the inbound path and its auto-reply.
- **The number guard** (`numberIsOurs` / `makeNumberGuard`). One Meta app holds several
  numbers (the sandbox app: Meta's test number AND the rehearsal's), so a change naming a
  `phone_number_id` is stored only when it is `META_PHONE_NUMBER_ID` or
  `waLink.phoneNumberId`. The second is load-bearing: the contact and history syncs are
  asked for during onboarding, before anyone can set the env var to the new id, and Meta
  sends each ONCE. No id on the change, or nothing configured (the mock sandbox, the
  harness), is allowed. `waLink` is read at most once per delivery, and only when the env
  id did not answer.
- **The retry rule still holds because every handler is keyed** (by wamid or phone key).
  A history chunk with a thread that failed answers `{ retry: true }`, which the webhook
  turns into a 500, so Meta resends the chunk and only what did not land is written. So
  does a `waLink.history` record that failed (the progress, a declined share), and the
  chunks after it are still read: a write that THROWS out of a handler is counted once and
  answered 200 whenever anything before it landed, so what it skipped is never resent.
  The counters it sums are ONE record, `freshResults()` (`_lib/coexist-core.js`), which the
  simulator's events start from too: a counter a handler bumps and the record lacks reads
  NaN, and the sum then never equals 0, so a delivery that failed everywhere is not resent.
- **What the rehearsal measures (v18.9.0 follow-up, "What a delivery measures" in
  `coexist-core.js`).** Two questions only Meta's real webhooks answer: does an echo ever
  name a message MGT sent (if never, `handleEchoes` can find a new phone reply by its key
  alone; `findMessageByWamid` keeps its scan for an echoed edit or delete of a message MGT
  sent, which the count does not see), and
  how big and how slow is a history delivery (Vercel caps a request body at 4.5 MB, Meta
  says one history webhook can describe thousands of messages, and the import runs against
  the function's time limit: a `maxDuration` for `wa-inbound` in `vercel.json` if it nears
  it). An echo found under another key is counted `mgtEchoes`, not `skipped`. Every
  delivery with a coexistence change logs one `[wa-inbound] coexistence delivery` line
  (status, bytes, ms, fields, a history delivery's threads and messages, the non-zero
  counters), and a history delivery or an echo of MGT's own is also recorded on
  `waLink/measured`, **because a Hobby project's runtime logs last one hour**. Counts only,
  held to a strict shape by the tests; a record that fails is logged and changes nothing
  about the answer. The simulator's events call the handlers directly, so never reach it.
  **That record is written at the END of the handler, before the answer**, so a history
  delivery is also counted as it begins (`recordBegun`, started beside the import and
  awaited before the answer): `historyBegun` above `historyDeliveries` is a delivery that
  never answered, an invocation the time limit ended (the /code-review; a record after
  the answer would be lost with the invocation and blur the two). **A body over the cap
  never reaches the function** (Vercel answers 413 first), so the record lists the chunks
  that did land, per phase (`historyChunks`, `{p0: {c1: 1}}`, from each chunk's
  `metadata.chunk_order`; a 500's wait for the resend): a gap in the numbers is a chunk
  that never landed.
- **`wa-onboard.js`**, the server half of Embedded Signup for `/wa-connect`. GET answers
  `{appId, configId, graphVersion}` (not secrets); POST exchanges the 30-second code, then
  writes `waLink` BEFORE asking for any sync (the guard above), then subscribes the app to
  the WABA, asks for the contacts and the history (`smb_app_data`) and reads the number's
  `is_on_biz_app`. A history request starts a new `waLink.history` record
  (`historyRequested`), keeping only what its own webhooks already wrote: the same number
  connected again otherwise showed the earlier import as declined or done. A failed
  subscribe SKIPS the two syncs, since a sync spent while no webhook can arrive is lost. `{retry: <step>}` runs one step again with `META_WA_TOKEN`
  (refused for a simulated link). **The business token is never stored or returned.**
  Guards: 405 → staff → admin (`assertWaAdmin`: `isAdminEntry` on `/roles`, the client's
  own question, whatever `enforceRoles` says, since `settingsAdmin` is always enforced; a
  `/roles` read that fails is a 503, `ROLES_UNREADABLE`, never "invalid token") → 400 → 503.
  The harness answers its POST 503 (it needs a deployment).
- **The simulator's events** (`_lib/sim-events.js`, behind `/api/wa-sim-inbound`'s
  `event`): each builds Meta's `value` (`src/lib/wa-sim-coexist.js`) and calls the
  handler above, so a simulated contact, echo, edit, history import or disconnection is
  stored as Meta's would be. "Connect (simulated)" writes a `waLink` marked `sim: true`,
  and **a real `waLink` (ids, no `sim`) is never touched**: 409, because the sandbox's
  DEV database is where the rehearsal's real connection lives.
- **A simulator conversation never reaches Meta (v18.12.0).** Its phone is made up, and
  once the sandbox sends from a real number (the rehearsal) a reply to it would reach
  whoever owns that number. A conversation the simulator CREATES is stamped `sim: true`
  (`injectSimInbound`, and `stampCreated` in `_lib/sim-events.js` for the history's two
  chats and an echo's new one); the client-mode simulator's `_waSim` counts too
  (`isSimConversation`, `src/lib/whatsapp.js`). The auto-reply, `wa-send` and
  `wa-media`'s POST pass `{ simulated }` to `_lib/meta.js`, whose `postMessage` and
  `uploadMedia` then act as mock mode does, whatever `WA_SEND_MODE` says. An existing
  conversation is never stamped, so a real chat never becomes a simulated one.

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
