# MGT Bookings

**A restaurant reservation system in active daily use.**

## What this is

A staff-facing web app that runs the day-to-day reservations of Me Gustas Tú,
a 13-table restaurant (9 outdoor, 4 indoor) in Corralejo, Fuerteventura. The
staff use it every service: a Gantt-style timeline of the day's bookings, a
week/month overview, walk-in seating, table blocking, and a full audit history
per booking.

- **Live:** [megustastu-bookings.vercel.app](https://megustastu-bookings.vercel.app)
  (behind a staff login: this is the restaurant's production system, not a demo)
- **Screenshots of every major feature:** [pz-my-page.vercel.app](https://pz-my-page.vercel.app/)
- **Status:** production, v15.9.0 · 131 commits · 4 tagged releases with changelogs

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

- **Diagnosed a production data-loss incident** and designed a write-guard
  pattern (Firebase security rule rejecting stale writes) to prevent it
  recurring.
- **Directed a multi-phase architectural refactor** from a monolithic app
  into modular hooks and components.
- **Encoded the restaurant's operational constraints** directly into the app:
  table-clustering rules, per-cluster capacity logic, kitchen load limits,
  seating-displacement protection.
- **Process discipline:** Git with semantic versioning and changelogs,
  dev/prod Firebase environment separation, AST-based structural verification
  of AI-generated changes.
- **In progress:** WhatsApp booking intake parsed by an LLM (Gemini Flash)
  via serverless functions.

## Stack

React 19 · Vite · Firebase Realtime Database + Auth · Vercel CI/CD

## Development

```bash
npm install
npm run dev     # local dev server against the dev Firebase project
npm run build   # production build
```

Sister app: [MGT Scheduling](https://github.com/pzzychowicz-blip/megustastu-scheduling),
staff shift scheduling for the same restaurant, sharing the design system and
conventions established here.
