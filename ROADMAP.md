# ROADMAP

Pending work only — deferred features, follow-ups, and ideas that haven't shipped
yet. Nothing else belongs in this file: no rationale docs, no shipped-version
history (that's `REFACTOR_LOG.md`), no architecture notes (that's `CLAUDE.md`).

**Keep this current.** When an item ships, delete its entry here in the same
PR/commit that ships it — the shipped details go in `REFACTOR_LOG.md` instead.
An item that is SETTLED is deleted too, not annotated: a withdrawal ("it was not
there") and a deliberate won't-fix ("it is there and is not worth a version")
are both decisions rather than pending work, and an entry saying "we checked and
there is nothing here" is not pending work either. The measurement and the
decision go in `REFACTOR_LOG.md`, and any evergreen lesson in `CLAUDE.md`'s
Gotchas. When new deferred work or an idea surfaces, add it here. The `mgt-workflow`
skill is responsible for checking this file at the relevant points in a
session and keeping it in sync.

---

## Deferred

- **The v18.0.0 production deploy.** Pending from the moment the release merges,
  and ordered: the six steps, and where each one's detail lives, are
  `database.rules.README.md` § *v18.0.0 — the production deploy, in order*.
  Delete this entry when the last of them — `enforceRoles` on — is done.

- **Four code changes gate the WhatsApp go-live** (2026-09-19 plan, § A4 of
  `megustastu-bookings context/WhatsApp module/MGT_WhatsApp_Cloud_API_Go-Live_Plan.md`).
  (1) **Photos in the inbox** — staff send the menu as a picture and customers send
  photos back, while `api/_lib/meta.js` sends text only and `api/wa-inbound.js` stores
  any non-text message as `"[image message]"`; Meta holds the files (7 days received,
  30 days sent), so nothing new is stored here. (2) **A public `/privacy` page** —
  Meta will not switch the app to Live, and so will not deliver real webhooks, without
  a reachable privacy-policy URL. (3) **`GRAPH_VERSION` v21.0 → v26.0**
  (`api/_lib/meta.js`) — v21.0 stops working on 21 January 2027. (4) **A stale comment**
  — `api/_lib/env.js`'s header names `gemini-3-flash` as the fallback model; the real
  default is `gemini-3.1-flash-lite` (`api/_lib/gemini.js:216`).

- **A WhatsApp cost counter in Settings → WhatsApp**, after go-live. Meta charges for
  every message a business sends from **1 October 2026**, replies included, so the panel
  shows messages sent this month and their cost, read from Meta's Pricing Analytics API
  (`pricing_category: SERVICE`) rather than counted locally — that way it matches the
  invoice even for anything sent outside MGT. Its own visibility capability: **manager
  and admin** by default, grantable to staff by an admin, like `hoursEdit` / `layoutEdit`.
  Decided 2026-09-21; the pricing analysis is § 4a of the go-live plan.

## Designed, not implemented

- **The doc-load split has three loose ends, all scope calls rather than defects**
  (`/code-review`, 2026-09-18, measured). (1) Root restates 29–34% of what it
  relocated, word for word: the five-guard summary against `src/CLAUDE.md`, the
  service-worker summary against its skill, the `api/` pointer against
  `api/CLAUDE.md` — two copies with nothing keeping them in step, which is the
  shape CLAUDE.md's own Gotchas row names. The node inventory at 0% is what a
  pointer should look like. (2) The write guards' mechanics sit in
  `src/CLAUDE.md`, which every src session loads, where 47% of them never open
  `src/hooks/`. (3) CLAUDE.md is 94 bytes under 40,000 and nothing measures it,
  so the next added row crosses silently. Deciding any of these means deciding
  what a root-only session must still know.

## Ideas

Both come from the **2026-07-24 `/engineering:tech-debt` scan's feature shortlist**,
whose other items shipped in v17.4.0. That plan file is gone from `~/.claude/plans/`,
so **no scope was ever recorded for either** and both need one before they are work.

- **Deposits reporting.** `deposit` is per-booking and every surface shows it one
  booking at a time; nothing aggregates it. Undecided: period, which statuses, and
  whether it is its own surface or a line on the day summary.
- **Structured guest tags.** Allergies and occasions live in free-text `notes`, which
  cannot be filtered or carried between visits and which `deleteCustomer` wipes.
  Undecided: fixed vocabulary or free tags, and whether tags are erasable personal data.
