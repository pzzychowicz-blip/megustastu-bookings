# MGT Bookings

**A restaurant reservation system in active daily use.**

## What this is

A staff-facing web app that runs the day-to-day reservations of Me Gustas Tú,
a 13-table restaurant (9 outdoor, 4 indoor) in Corralejo, Fuerteventura. The
staff use it every service: a Gantt-style timeline of the day's bookings, a
list and a floor plan of the room, a week/month overview, walk-in seating,
table blocking, a waitlist, gift vouchers, and a full audit history per
booking.

- **Live:** [megustastu-bookings.vercel.app](https://megustastu-bookings.vercel.app)
  (behind a staff login: this is the restaurant's production system, not a demo)
- **Screenshots of every major feature:** [pz-my-page.vercel.app](https://pz-my-page.vercel.app/)
- **Status:** production, v18 · 790+ commits · 18 tagged releases

## Who uses it

The restaurant's front-of-house staff and management, daily, for every
service. I also work front-of-house there, so I build against the exact
operational pain points the app solves.

## What I did

Sole developer and owner, covering the full product lifecycle: requirements,
data modelling, UI design, deployment, and iterative refactoring. I build
AI-natively: directing AI coding tools (primarily Claude Code) through
planning, spec-writing, execution, and review, with conventional engineering
discipline around it.

Highlights:

- **Diagnosed two production data-loss incidents and closed both
  structurally:** a write guard against empty overwrites, then per-booking
  compare-and-swap in the Firebase security rules, so a stale device's write
  is rejected by the server.
- **Directed a multi-phase architectural refactor** from a monolithic app
  into modular hooks and components.
- **Encoded the restaurant's operational constraints** directly into the app:
  table-clustering rules, per-cluster capacity logic, kitchen load limits,
  seating-displacement protection.
- **Roles and permissions enforced server-side:** staff / manager / admin
  levels with per-person extras and denies, checked by the security rules as
  well as the UI; the last admin can't be removed.
- **WhatsApp booking intake in production:** guest messages parsed into draft
  bookings by an LLM (Gemini Flash) via serverless functions, behind an admin
  switch. No LLM output changes a booking without a staff action.
- **Built to serve more than one restaurant:** one codebase, one Firebase
  project per restaurant, per-restaurant module switches, credentials kept out
  of the database.
- **Tested adversarially, not just automatically:** 1,245 unit tests and 257
  security-rules tests against the Firebase emulator in CI, with lint and
  design-token gates; plus written crash-test campaigns, each finding filed
  with a reproduction, a root cause and why the existing tests missed it.
- **Process discipline:** Git with semantic versioning and changelogs,
  dev/prod Firebase environment separation, AST-based structural verification
  of AI-generated changes.

## Stack

React 19 · Vite · Firebase Realtime Database + Auth · Vercel (hosting +
serverless functions) · Vitest · GitHub Actions · Gemini API

## Development

```bash
npm install
npm run dev          # local dev server against the dev Firebase project
npm test             # unit tests (Vitest)
npm run test:rules   # security-rules tests on a local Firebase emulator (needs Java + firebase-tools)
npm run lint         # ESLint
npm run check:style  # design-token and style invariants
npm run build        # production build
```

Sister app: [MGT Scheduling](https://github.com/pzzychowicz-blip/megustastu-scheduling),
staff shift scheduling for the same restaurant, sharing the design system and
conventions established here.
