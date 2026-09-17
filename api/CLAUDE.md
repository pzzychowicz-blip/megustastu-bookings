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
customers.js → booking-logic.js → constants/day/vouchers`. **v18.0.0 phase 5b gates the
three sim handlers on `simEnabled()`** (`WA_SIM_ENABLED === "1"`), as each handler's
FIRST statement — before the method check and before staff auth, so the answer is
indistinguishable from "no such endpoint": a 405 or a 401 would both confirm the handler
is there. Fail-closed, and measured across five env values — absent, empty, `"0"`,
`"true"` and `"1"` — where only the last opens it. **Since the phase-5 review those
three are also excluded from a deployment by `.vercelignore`**, so PRODUCTION routes
FOUR functions (`wa-inbound` · `wa-send` · `wa-recheck` · `wa-config`) and the sandbox
branch appends `!api/wa-sim-*.js` to get its three back — APPENDING, because a merge
silently reinstates a deleted line. The runtime gate stays: two independent answers, and
the 404 is the one that still holds if the ignore file is ever edited. `_lib/` is
underscore-prefixed so Vercel does not route it. **`wa-config.js` (phase 5) answers
"which server-side keys are configured" as a BOOLEAN PER KEY and never a value** — it is
what the Admin tab's Integrations section renders. It cannot leak a secret by mistake
because it never holds one (`Boolean(env(k, null))` is the whole of it), and it is
staff-auth gated because a map of which integrations are unconfigured is a map of where
a deployment is soft. The client keeps its own labels and groups and asks only the
question a browser cannot answer — presentation there, fact here, so the key list is not
one list in two places
