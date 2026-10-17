// src/lib/wa-usage.js
//
// v18.10.0 — what the WhatsApp cost counter says (Settings → WhatsApp →
// Messages and cost), from Meta's Pricing Analytics. Pure, and shared: the
// server (`api/wa-usage.js`) builds its answer with it under Node ESM, so this
// file imports nothing, and the client and the tests read the same rules.
//
// ── Why Meta's figures and never a count of our own ─────────────────────────
// Decided 2026-09-21 (go-live plan § 4a): from 1 October 2026 Meta charges for
// every message a business sends, replies included, and the restaurant's number
// also sends from the phone under coexistence. A count MGT kept would miss
// those and would not be the invoice. `pricing_analytics` is: "pricing
// breakdowns for any messages delivered" in the range, the cost "in your
// Messaging account's currency", approximate (Meta's Analytics page, updated
// 14 Sep 2026, read in the browser on 2026-10-18).
//
// ── Meta's words, as of 1 October 2026 ──────────────────────────────────────
// `pricing_type`:
//   FREE_CUSTOMER_SERVICE  1:1 non-template messages delivered inside the
//                          number's free tier (the 1,000 a month)
//   FREE_ENTRY_POINT       messages in a free entry point's window
//   REGULAR                billable, including a non-template message after
//                          the free tier is used up
// Anything else is counted as delivered and in neither column, so a type Meta
// adds later shows up in the total rather than vanishing.

// Meta's pricing page (updated 2026-09-30, read in the browser on 2026-10-12):
// the first 1,000 service messages a month are free, per business number.
export const FREE_TIER_MONTHLY = 1000;

const DAY_S = 86400;

// The two months the counter shows, as UTC month starts in SECONDS (what
// Graph's `start()`/`end()` take), and the range to ask Meta for.
//
// The range starts a DAY before last month: Meta cuts its daily buckets at the
// account's own midnight (the page's example starts each day at 07:00 UTC, a
// Pacific account), so for an account east of UTC the 1st's bucket begins on
// the evening of the 31st, and a range starting at UTC midnight could leave it
// out. The extra day is dropped again by `monthOf`.
export function monthBounds(nowMs) {
  const d = new Date(nowMs);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  const thisStart = Date.UTC(y, m, 1) / 1000;
  const lastStart = Date.UTC(y, m - 1, 1) / 1000;
  const end = Math.floor(nowMs / 1000);
  return { lastStart, thisStart, end, askFrom: lastStart - DAY_S, askTo: end };
}

// Which month a daily bucket belongs to: "this", "last" or null. Read at the
// bucket's MIDDLE, which is midday on that day wherever the account's midnight
// falls (within 12 hours of UTC, as Spain is), so a bucket that
// starts on the evening of the 31st still counts on the 1st.
export function monthOf(point, bounds) {
  const s = Number(point && point.start);
  const e = Number(point && point.end);
  if (!Number.isFinite(s)) return null;
  const mid = Number.isFinite(e) && e > s ? (s + e) / 2 : s;
  if (mid >= bounds.thisStart) return "this";
  if (mid >= bounds.lastStart) return "last";
  return null;
}

function emptyMonth() { return { delivered: 0, free: 0, entryPoint: 0, billed: 0, cost: 0 }; }

// A non-negative finite number, else 0: Meta's answer is input like any other.
function amount(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

// Meta's `data_points` → `{ this, last }`, each `{ delivered, free, entryPoint,
// billed, cost }`. `free` is the FREE_CUSTOMER_SERVICE volume, which is what
// the 1,000 counts; `cost` is summed as Meta reports it and rounded to the
// cent only when shown.
export function summariseUsage(points, bounds) {
  const out = { this: emptyMonth(), last: emptyMonth() };
  (Array.isArray(points) ? points : []).forEach(function (p) {
    if (!p || typeof p !== "object") return;
    const which = monthOf(p, bounds);
    if (!which) return;
    const m = out[which];
    const v = amount(p.volume);
    m.delivered += v;
    if (p.pricing_type === "FREE_CUSTOMER_SERVICE") m.free += v;
    else if (p.pricing_type === "FREE_ENTRY_POINT") m.entryPoint += v;
    else if (p.pricing_type === "REGULAR") m.billed += v;
    m.cost += amount(p.cost);
  });
  return out;
}

// Every data point in a `pricing_analytics` answer. Meta wraps them as
// `{ data: [ { data_points: [...] } ] }`; anything else is no data.
export function pricingPoints(answer) {
  const pa = answer && answer.pricing_analytics;
  const data = pa && Array.isArray(pa.data) ? pa.data : [];
  return data.reduce(function (all, d) {
    return d && Array.isArray(d.data_points) ? all.concat(d.data_points) : all;
  }, []);
}

// An ISO 4217 code, or null. Meta reports the account's currency as one.
export function currencyOf(v) {
  return typeof v === "string" && /^[A-Z]{3}$/.test(v) ? v : null;
}

// The cost as shown: in the account's currency when Meta said which, else a
// plain number. Two decimals, as an invoice prints it.
export function costLabel(cost, currency) {
  const n = amount(cost);
  if (currency) {
    try {
      return new Intl.NumberFormat("en-GB", { style: "currency", currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
    } catch { /* an unknown code: fall through to the plain number */ }
  }
  return n.toFixed(2);
}

// The month's name, from its UTC start in seconds: "October".
export function monthName(startS) {
  return new Date(startS * 1000).toLocaleString("en-GB", { month: "long", timeZone: "UTC" });
}
