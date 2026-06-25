// src/lib/wa-sim-scenarios.js
//
// Canned scenario library for the WhatsApp simulator + the WA-SIM sample
// bookings some scenarios link to. Each scenario is a one-click recipe that
// calls simulateInbound with a realistic message + pre-baked parse, covering the
// full UI matrix (intents, confidence, languages, first-time vs regular, linked
// cancel/modify, large group, append-to-existing, expired window, auto-ack).
//
// All date math is UTC (new Date + getUTC*/setUTC* + toISOString) to match the
// app's "YYYY-MM-DD" convention — mixing local getDate() with UTC toISOString()
// shifts the date a day in UTC+ zones. Dates are computed at RUN time so
// "tomorrow"/"Saturday" are always relative to today.
//
// Sample bookings are tagged `_waSim:true` (and name-prefixed "WA-SIM ") so they
// are obvious on the timeline and reliably removable via clearWaSimBookings.

import { simulateInbound } from "./wa-sim";

// ── UTC date helpers (call at run time) ──────────────────────────────────────
function isoPlus(days) { const d = new Date(); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); }
function nextDow(dow) { const d = new Date(); const diff = (dow - d.getUTCDay() + 7) % 7 || 7; d.setUTCDate(d.getUTCDate() + diff); return d.toISOString().slice(0, 10); }

// ── Phone numbers used across scenarios (so links/regular history line up) ────
const PH = {
  juan: "+34600123456",     // regular (3 completed)
  maria: "+34611987654",    // has history; used for a plain question
  tom: "+34622334455",      // upcoming wasimT2 → cancel (linked)
  sofia: "+34655667788",    // upcoming wasimS1 → modify (linked)
  firstTimer: "+34700111222",
  enLow: "+447700900321",
  largeGroup: "+34644556677",
  cancelNoLink: "+34788999000",
  expired: "+34699888777",
  // Link targets for the extra linked cancel/modify/late scenarios below.
  liam: "+447900111222",    // upcoming wasimL1 (today dinner) — UK tourist (EN)
  greta: "+34655443322",    // upcoming wasimG1 (today lunch)
  ines: "+34633221100",     // upcoming wasimI1 (tomorrow dinner)
  klaus: "+4915112345678",  // upcoming wasimK1 (weekend large group) — DE tourist (EN)
};

// ── WA-SIM sample bookings (computed fresh each call) ─────────────────────────
function makeBooking(o) {
  return Object.assign({
    scheduledTime: o.time, duration: o.size >= 3 ? 120 : 90, originalDuration: o.size >= 3 ? 120 : 90,
    preference: "auto", notes: "", customDur: null, _conflict: false, preferredTables: [], history: [], _waSim: true,
  }, o);
}
export function sampleBookings() {
  return [
    // Juan Pérez — regular (3 completed) on +34600123456
    makeBooking({ id: "wasimJ1", name: "WA-SIM Juan Pérez", phone: PH.juan, date: isoPlus(-21), time: "20:30", size: 4, status: "completed", tables: ["2", "3"], _manual: false, _locked: false }),
    makeBooking({ id: "wasimJ2", name: "WA-SIM Juan Pérez", phone: PH.juan, date: isoPlus(-42), time: "21:00", size: 2, status: "completed", tables: ["3"], _manual: false, _locked: false }),
    makeBooking({ id: "wasimJ3", name: "WA-SIM Juan Pérez", phone: PH.juan, date: isoPlus(-70), time: "20:00", size: 4, status: "completed", tables: ["2", "3"], notes: "Anniversary", _manual: false, _locked: false }),
    // Maria López — 2 completed on +34611987654
    makeBooking({ id: "wasimM1", name: "WA-SIM Maria López", phone: PH.maria, date: isoPlus(-14), time: "13:30", size: 2, status: "completed", tables: ["i3"], notes: "Vegetarian", _manual: false, _locked: false }),
    makeBooking({ id: "wasimM2", name: "WA-SIM Maria López", phone: PH.maria, date: isoPlus(-35), time: "14:00", size: 2, status: "completed", tables: ["i3"], _manual: false, _locked: false }),
    // Tom Richards — 1 completed + 1 upcoming (link target for cancel)
    makeBooking({ id: "wasimT1", name: "WA-SIM Tom Richards", phone: PH.tom, date: isoPlus(-7), time: "21:30", size: 3, status: "completed", tables: ["2", "3"], _manual: false, _locked: false }),
    makeBooking({ id: "wasimT2", name: "WA-SIM Tom Richards", phone: PH.tom, date: isoPlus(2), time: "21:30", size: 3, status: "confirmed", tables: ["2", "3"], _manual: true, _locked: true }),
    // Sofía García — upcoming (link target for modify)
    makeBooking({ id: "wasimS1", name: "WA-SIM Sofía García", phone: PH.sofia, date: isoPlus(3), time: "20:30", size: 4, status: "confirmed", tables: ["5A", "5B"], _manual: true, _locked: true }),
    // Extra upcoming link targets (cancel / modify / running-late / add-person).
    makeBooking({ id: "wasimL1", name: "WA-SIM Liam O'Brien", phone: PH.liam, date: isoPlus(0), time: "20:30", size: 2, status: "confirmed", tables: ["4"], _manual: true, _locked: true }),       // today dinner
    makeBooking({ id: "wasimG1", name: "WA-SIM Greta Nilsson", phone: PH.greta, date: isoPlus(0), time: "13:30", size: 2, status: "confirmed", tables: ["i1"], _manual: true, _locked: true }),      // today lunch
    makeBooking({ id: "wasimI1", name: "WA-SIM Inés Romero", phone: PH.ines, date: isoPlus(1), time: "21:00", size: 4, status: "confirmed", tables: ["5A", "5B"], _manual: true, _locked: true }),    // tomorrow dinner
    makeBooking({ id: "wasimK1", name: "WA-SIM Klaus Bauer", phone: PH.klaus, date: nextDow(6), time: "20:00", size: 8, status: "confirmed", tables: ["1A", "1B", "2"], _manual: true, _locked: true }), // weekend large group
  ];
}

// Seed the WA-SIM sample bookings (skip ids already present). Returns the count
// added. clearWaSimBookings removes everything tagged _waSim.
export function seedSampleBookings(ctx) {
  const samples = sampleBookings();
  let added = 0;
  ctx.saveBookings((prev) => {
    const ids = new Set(prev.map((b) => b.id));
    const add = samples.filter((b) => !ids.has(b.id));
    added = add.length;
    return add.length ? prev.concat(add) : prev;
  });
  return added;
}
export function clearWaSimBookings(ctx) {
  ctx.saveBookings((prev) => prev.filter((b) => !b._waSim));
}

// Passthrough for the custom-message form / console __waSim.custom().
export function customInbound(params, ctx) { return simulateInbound(params, ctx); }

// ── Burst: simulate a busy moment ────────────────────────────────────────────
// Fires a contextual MIX of messages — follow-ups that move the CURRENTLY ONGOING
// conversations forward (a parsed draft gets a detail, a confirmed booking asks
// to change, an unhandled cancel/modify gets a nudge, a question adds another) —
// plus a couple of brand-new conversations. Timestamps are staggered so the
// burst lands in a natural order (newest on top).
function followUpFor(c) {
  const phone = c.phone || c.phoneKey;
  const lang = c.language === "en" ? "en" : "es";
  const intent = c.draftData && c.draftData.intent;
  if (c.draftStatus === "parsed" && intent === "new_booking") {
    return { phone, language: lang, text: lang === "es" ? "Perfecto, ¿podría ser en la terraza?" : "Great — could we sit outside if possible?", parse: Object.assign({}, c.draftData, { notes: "Prefers outdoor", confidence: "high" }) };
  }
  if (c.draftStatus === "accepted" && c.acceptedBookingId) {
    return { phone, language: lang, text: lang === "es" ? "¡Gracias! ¿Podríamos cambiar la hora a las 21:00?" : "Thanks! Could we move it to 21:00?", parse: { intent: "modify", confidence: "high" }, acceptedBookingId: c.acceptedBookingId };
  }
  if (intent === "cancel" || intent === "modify") {
    // No parse → keep the existing intent draft, just bump the thread so the
    // banner re-surfaces (lastMessageAt advances past intentHandledAt).
    return { phone, language: lang, text: lang === "es" ? "¿Hola? ¿Recibieron mi mensaje?" : "Hi, did you get my last message?" };
  }
  return { phone, language: lang, text: lang === "es" ? "Otra cosa, ¿tienen aparcamiento cerca?" : "Also — is there parking nearby?", parse: { intent: "question" } };
}
export function simulateBurst(ctx) {
  const ongoing = (ctx.conversations || []).filter((c) => !c.archived).slice(0, 6);
  const actions = ongoing.map(followUpFor);
  // Two brand-new conversations
  actions.push({ phone: "+34712345678", language: "es", text: "Hola, ¿tienen mesa para 2 mañana a las 14:00?", parse: { intent: "new_booking", size: 2, date: isoPlus(1), time: "14:00", confidence: "high" } });
  actions.push({ phone: "+447811223344", language: "en", text: "Hi! Quick question — are dogs allowed on the terrace?", parse: { intent: "question" } });
  const N = actions.length;
  actions.forEach((params, i) => {
    // Stagger so each is a couple seconds newer than the previous (last = now).
    simulateInbound(Object.assign({ windowAgeMs: (N - 1 - i) * 2500 }, params), ctx);
  });
  return N;
}

// ── Scenario library ─────────────────────────────────────────────────────────
export const SCENARIOS = [
  // New bookings
  {
    id: "new_es_high", group: "New bookings", label: "New booking · ES · high conf · regular (Juan)",
    note: "Regular chip shows if sample bookings are seeded.",
    run: (ctx) => simulateInbound({ phone: PH.juan, language: "es", text: "Hola, quería reservar para 4 personas el sábado a las 21h, gracias", parse: { intent: "new_booking", size: 4, date: nextDow(6), time: "21:00", confidence: "high" } }, ctx),
  },
  {
    id: "new_en_low", group: "New bookings", label: "New booking · EN · low conf (ambiguous)",
    run: (ctx) => simulateInbound({ phone: PH.enLow, language: "en", text: "hi can i book tomorrow 8pm ish? we're 2 or 3", parse: { intent: "new_booking", size: 2, date: isoPlus(1), time: "20:00", confidence: "low", ambiguity: "Size unclear — customer said '2 or 3'. Time '8pm ish' rounded to 20:00." } }, ctx),
  },
  {
    id: "new_firsttime", group: "New bookings", label: "New booking · first-time customer (auto-ack)",
    run: (ctx) => simulateInbound({ phone: PH.firstTimer, language: "es", text: "Buenas, ¿tienen mesa para 2 esta noche a las 20:00? Soy Carlos", parse: { intent: "new_booking", name: "Carlos", size: 2, date: isoPlus(0), time: "20:00", confidence: "high" } }, ctx),
  },
  {
    id: "new_large", group: "New bookings", label: "New booking · large group (12)",
    run: (ctx) => simulateInbound({ phone: PH.largeGroup, language: "es", text: "Buenas, somos 12 personas el viernes a las 20:30, ¿es posible?", parse: { intent: "new_booking", size: 12, date: nextDow(5), time: "20:30", confidence: "high" } }, ctx),
  },
  // Cancel / Modify
  {
    id: "cancel_linked", group: "Cancel / Modify", label: "Cancel · linked booking (Tom)",
    note: "Needs sample bookings seeded (links to wasimT2).",
    run: (ctx) => simulateInbound({ phone: PH.tom, language: "en", text: "Hi, sorry — need to cancel my booking, something came up. Hope that's ok!", parse: { intent: "cancel", name: "Tom Richards", confidence: "high" }, acceptedBookingId: "wasimT2" }, ctx),
  },
  {
    id: "modify_linked", group: "Cancel / Modify", label: "Modify · linked booking (Sofía)",
    note: "Needs sample bookings seeded (links to wasimS1).",
    run: (ctx) => simulateInbound({ phone: PH.sofia, language: "es", text: "Hola, ¿podríamos cambiar a 6 personas en vez de 4?", parse: { intent: "modify", name: "Sofía García", size: 6, confidence: "high" }, acceptedBookingId: "wasimS1" }, ctx),
  },
  {
    id: "cancel_nolink", group: "Cancel / Modify", label: "Cancel · NO linked booking (manual)",
    note: "Cancel button hidden — staff handles manually.",
    run: (ctx) => simulateInbound({ phone: PH.cancelNoLink, language: "en", text: "Need to cancel my reservation for tonight please", parse: { intent: "cancel", confidence: "high" } }, ctx),
  },
  // Other / edge
  {
    id: "question", group: "Other / edge", label: "Question · no draft (Maria)",
    run: (ctx) => simulateInbound({ phone: PH.maria, language: "es", text: "¿Tienen menú vegetariano?", parse: { intent: "question" } }, ctx),
  },
  {
    id: "append", group: "Other / edge", label: "Append to existing thread (Juan, resets window)",
    note: "Run a Juan scenario first; this adds a follow-up message.",
    run: (ctx) => simulateInbound({ phone: PH.juan, language: "es", text: "¿Sigue disponible la mesa? Gracias", parse: { intent: "new_booking", size: 4, date: nextDow(6), time: "21:00", confidence: "medium" } }, ctx),
  },
  {
    id: "expired", group: "Other / edge", label: "Expired window (received 25h ago)",
    note: "Composer is disabled until the customer messages again.",
    run: (ctx) => simulateInbound({ phone: PH.expired, language: "en", text: "Hello, are you open on Sunday?", windowAgeMs: 25 * 60 * 60 * 1000, parse: { intent: "question" } }, ctx),
  },

  // ════════════════════════════════════════════════════════════════════════════
  // 50 additional scenarios — broaden the UI matrix (intents · confidence ·
  // languages · sizes · windows · linked/unlinked · special requests · edge).
  // ════════════════════════════════════════════════════════════════════════════

  // ── New bookings · ES ───────────────────────────────────────────────────────
  {
    id: "nb_es_lunch2", group: "New bookings · ES", label: "Comida · 2 pers · hoy 14:00 · alta",
    run: (ctx) => simulateInbound({ phone: "+34601000001", language: "es", text: "Hola, ¿una mesa para 2 hoy a las 14:00?", parse: { intent: "new_booking", size: 2, date: isoPlus(0), time: "14:00", confidence: "high" } }, ctx),
  },
  {
    id: "nb_es_dinner6", group: "New bookings · ES", label: "Cena · 6 pers · sábado 21:00 · alta",
    run: (ctx) => simulateInbound({ phone: "+34601000002", language: "es", text: "Buenas, querríamos reservar para 6 el sábado a las 21:00", parse: { intent: "new_booking", size: 6, date: nextDow(6), time: "21:00", confidence: "high" } }, ctx),
  },
  {
    id: "nb_es_tonight3", group: "New bookings · ES", label: "Cena · 3 pers · esta noche 20:30 · alta",
    run: (ctx) => simulateInbound({ phone: "+34601000003", language: "es", text: "¿Tenéis sitio para 3 esta noche sobre las 20:30?", parse: { intent: "new_booking", size: 3, date: isoPlus(0), time: "20:30", confidence: "high" } }, ctx),
  },
  {
    id: "nb_es_terrace2", group: "New bookings · ES", label: "Cena · 2 pers · viernes · terraza (nota)",
    run: (ctx) => simulateInbound({ phone: "+34601000004", language: "es", text: "Mesa para 2 el viernes a las 21:00, a ser posible en la terraza", parse: { intent: "new_booking", size: 2, date: nextDow(5), time: "21:00", notes: "Prefiere terraza", confidence: "high" } }, ctx),
  },
  {
    id: "nb_es_birthday6", group: "New bookings · ES", label: "Cena · 6 pers · cumpleaños + tarta (nota)",
    run: (ctx) => simulateInbound({ phone: "+34601000005", language: "es", text: "Somos 6 el sábado a las 21:30, es un cumpleaños, ¿podéis sacar una tarta?", parse: { intent: "new_booking", size: 6, date: nextDow(6), time: "21:30", notes: "Cumpleaños — tarta con vela", confidence: "high" } }, ctx),
  },
  {
    id: "nb_es_highchair", group: "New bookings · ES", label: "Comida · familia 4 + trona (nota)",
    run: (ctx) => simulateInbound({ phone: "+34601000006", language: "es", text: "Mesa para 4 mañana a las 13:30, vamos con un bebé, ¿tenéis trona?", parse: { intent: "new_booking", size: 4, date: isoPlus(1), time: "13:30", notes: "Necesita trona para un bebé", confidence: "high" } }, ctx),
  },
  {
    id: "nb_es_timefuzzy", group: "New bookings · ES", label: "Hora imprecisa · 'sobre las 9' · baja",
    run: (ctx) => simulateInbound({ phone: "+34601000007", language: "es", text: "Para 2 el jueves, sobre las nueve más o menos", parse: { intent: "new_booking", size: 2, date: nextDow(4), time: null, confidence: "low", ambiguity: "Hora imprecisa — 'sobre las nueve' (¿21:00?). Sin confirmar." } }, ctx),
  },

  // ── New bookings · EN (tourists) ────────────────────────────────────────────
  {
    id: "nb_en_dinner2", group: "New bookings · EN", label: "Dinner · 2 · tomorrow 20:00 · high (UK)",
    run: (ctx) => simulateInbound({ phone: "+447900222001", language: "en", text: "Hi, could we book a table for 2 tomorrow at 8pm?", parse: { intent: "new_booking", size: 2, date: isoPlus(1), time: "20:00", confidence: "high" } }, ctx),
  },
  {
    id: "nb_en_lunch4", group: "New bookings · EN", label: "Lunch · 4 · today 13:30 · high",
    run: (ctx) => simulateInbound({ phone: "+447900222002", language: "en", text: "Table for 4 today at half one for lunch?", parse: { intent: "new_booking", size: 4, date: isoPlus(0), time: "13:30", confidence: "high" } }, ctx),
  },
  {
    id: "nb_en_seaview2", group: "New bookings · EN", label: "Dinner · 2 · sea view request (note)",
    run: (ctx) => simulateInbound({ phone: "+447900222003", language: "en", text: "Booking for 2 on Saturday 8:30pm — any chance of a table with a sea view?", parse: { intent: "new_booking", size: 2, date: nextDow(6), time: "20:30", notes: "Requests sea view", confidence: "high" } }, ctx),
  },
  {
    id: "nb_en_anniversary2", group: "New bookings · EN", label: "Dinner · 2 · anniversary (note, IE)",
    run: (ctx) => simulateInbound({ phone: "+353861234567", language: "en", text: "We'd love a table for 2 on Friday at 9, it's our anniversary :)", parse: { intent: "new_booking", size: 2, date: nextDow(5), time: "21:00", notes: "Anniversary", confidence: "high" } }, ctx),
  },
  {
    id: "nb_en_glutenfree4", group: "New bookings · EN", label: "Dinner · 4 · gluten-free (note, DE)",
    run: (ctx) => simulateInbound({ phone: "+4915112000001", language: "en", text: "Hello, table for 4 on Saturday 8pm. One of us is gluten free, is that ok?", parse: { intent: "new_booking", size: 4, date: nextDow(6), time: "20:00", notes: "One guest gluten-free", confidence: "high" } }, ctx),
  },
  {
    id: "nb_en_sizefuzzy", group: "New bookings · EN", label: "Size unclear · '4 maybe 5' · low",
    run: (ctx) => simulateInbound({ phone: "+447900222004", language: "en", text: "hey, dinner tomorrow around 8, there's 4 of us maybe 5", parse: { intent: "new_booking", size: 4, date: isoPlus(1), time: "20:00", confidence: "low", ambiguity: "Size unclear — '4 maybe 5'." } }, ctx),
  },
  {
    id: "nb_en_latedinner2", group: "New bookings · EN", label: "Late dinner · 2 · 22:00 edge (NL)",
    run: (ctx) => simulateInbound({ phone: "+31612345678", language: "en", text: "Is 10pm too late for a table for 2 tonight?", parse: { intent: "new_booking", size: 2, date: isoPlus(0), time: "22:00", confidence: "high" } }, ctx),
  },

  // ── Large groups & events ───────────────────────────────────────────────────
  {
    id: "lg_12", group: "Large groups & events", label: "12 pers · viernes 20:30 · alta",
    run: (ctx) => simulateInbound({ phone: "+34602000001", language: "es", text: "Hola, somos 12 el viernes a las 20:30, ¿es posible?", parse: { intent: "new_booking", size: 12, date: nextDow(5), time: "20:30", confidence: "high" } }, ctx),
  },
  {
    id: "lg_20_over", group: "Large groups & events", label: "20 pers · sábado (roza el aforo)",
    note: "Stress-tests a very large party (TOTAL_SEATS = 28).",
    run: (ctx) => simulateInbound({ phone: "+34602000002", language: "es", text: "Necesitaríamos mesa para 20 personas el sábado por la noche", parse: { intent: "new_booking", size: 20, date: nextDow(6), time: "20:00", confidence: "high" } }, ctx),
  },
  {
    id: "lg_business10", group: "Large groups & events", label: "Cena empresa · 10 · factura (nota)",
    run: (ctx) => simulateInbound({ phone: "+34602000003", language: "es", text: "Cena de empresa para 10 el jueves a las 21:00, necesitaremos factura", parse: { intent: "new_booking", size: 10, date: nextDow(4), time: "21:00", notes: "Cena de empresa — requiere factura", confidence: "high" } }, ctx),
  },
  {
    id: "lg_setmenu8", group: "Large groups & events", label: "8 pers · pregunta menú cerrado · media",
    run: (ctx) => simulateInbound({ phone: "+34602000004", language: "es", text: "Para 8 el sábado, ¿tenéis menú cerrado para grupos? ¿precio?", parse: { intent: "new_booking", size: 8, date: nextDow(6), time: "21:00", notes: "Pregunta por menú de grupo / precio", confidence: "medium" } }, ctx),
  },
  {
    id: "lg_kidsparty8", group: "Large groups & events", label: "Cumple infantil · 8 (4+4) · domingo comida",
    run: (ctx) => simulateInbound({ phone: "+34602000005", language: "es", text: "Cumpleaños infantil el domingo a la 13:30, 4 adultos y 4 niños", parse: { intent: "new_booking", size: 8, date: nextDow(0), time: "13:30", notes: "Cumpleaños infantil — 4 adultos, 4 niños", confidence: "high" } }, ctx),
  },
  {
    id: "lg_private_event", group: "Large groups & events", label: "Privatize terrace · 25 · enquiry (EN)",
    note: "Question intent → message only (no draft).",
    run: (ctx) => simulateInbound({ phone: "+447900222010", language: "en", text: "Hi! Do you do private events? We'd want the whole terrace for ~25 people.", parse: { intent: "question" } }, ctx),
  },

  // ── Cancellations ───────────────────────────────────────────────────────────
  {
    id: "cx_today_liam", group: "Cancellations", label: "Cancel · linked TODAY (Liam)",
    note: "Needs sample bookings seeded (links to wasimL1).",
    run: (ctx) => simulateInbound({ phone: PH.liam, language: "en", text: "So sorry, we have to cancel tonight — one of us is unwell.", parse: { intent: "cancel", name: "Liam O'Brien", confidence: "high" }, acceptedBookingId: "wasimL1" }, ctx),
  },
  {
    id: "cx_weekend_klaus", group: "Cancellations", label: "Cancel · linked weekend group (Klaus)",
    note: "Needs sample bookings seeded (links to wasimK1).",
    run: (ctx) => simulateInbound({ phone: PH.klaus, language: "en", text: "Unfortunately we must cancel our group booking for Saturday. Apologies.", parse: { intent: "cancel", name: "Klaus Bauer", confidence: "high" }, acceptedBookingId: "wasimK1" }, ctx),
  },
  {
    id: "cx_lastminute", group: "Cancellations", label: "Cancel · última hora · sin enlace",
    run: (ctx) => simulateInbound({ phone: "+34603000001", language: "es", text: "Tengo que cancelar la reserva de esta noche, lo siento mucho", parse: { intent: "cancel", confidence: "high" } }, ctx),
  },
  {
    id: "cx_apology", group: "Cancellations", label: "Cancel + disculpa larga · sin enlace (EN)",
    run: (ctx) => simulateInbound({ phone: "+34603000002", language: "en", text: "I'm really sorry to do this last minute but we need to cancel our reservation, work emergency. Hope to come another time!", parse: { intent: "cancel", confidence: "high" } }, ctx),
  },
  {
    id: "cx_rebook", group: "Cancellations", label: "Cancel sábado · pide domingo (nota)",
    run: (ctx) => simulateInbound({ phone: "+34603000003", language: "es", text: "¿Podemos anular la del sábado y pasarla al domingo a la misma hora?", parse: { intent: "cancel", notes: "Quiere recolocar al domingo, misma hora", confidence: "medium" } }, ctx),
  },
  {
    id: "cx_noshow_followup", group: "Cancellations", label: "Disculpa tras no-show (sin enlace)",
    note: "Other intent → message only; staff follows up manually.",
    run: (ctx) => simulateInbound({ phone: "+34603000004", language: "es", text: "Perdón, anoche no pudimos ir y no avisamos. ¿Podemos reservar otro día?", parse: { intent: "other" } }, ctx),
  },

  // ── Modifications ───────────────────────────────────────────────────────────
  {
    id: "md_size_up_ines", group: "Modifications", label: "Modify · 4 → 6 (Inés, mañana)",
    note: "Needs sample bookings seeded (links to wasimI1).",
    run: (ctx) => simulateInbound({ phone: PH.ines, language: "es", text: "¿Podríamos cambiar la reserva de mañana a 6 personas en vez de 4?", parse: { intent: "modify", name: "Inés Romero", size: 6, confidence: "high" }, acceptedBookingId: "wasimI1" }, ctx),
  },
  {
    id: "md_size_down_klaus", group: "Modifications", label: "Modify · 8 → 6 (Klaus, weekend)",
    note: "Needs sample bookings seeded (links to wasimK1).",
    run: (ctx) => simulateInbound({ phone: PH.klaus, language: "en", text: "Two people dropped out — can we change Saturday to 6 instead of 8?", parse: { intent: "modify", name: "Klaus Bauer", size: 6, confidence: "high" }, acceptedBookingId: "wasimK1" }, ctx),
  },
  {
    id: "md_time_tom", group: "Modifications", label: "Modify · time → 20:30 (Tom)",
    note: "Needs sample bookings seeded (links to wasimT2).",
    run: (ctx) => simulateInbound({ phone: PH.tom, language: "en", text: "Could we move our booking a bit earlier, to 8:30 instead of 9:30?", parse: { intent: "modify", name: "Tom Richards", time: "20:30", confidence: "high" }, acceptedBookingId: "wasimT2" }, ctx),
  },
  {
    id: "md_date_sofia", group: "Modifications", label: "Modify · date → otro día (Sofía)",
    note: "Needs sample bookings seeded (links to wasimS1).",
    run: (ctx) => simulateInbound({ phone: PH.sofia, language: "es", text: "¿Sería posible pasar nuestra reserva al día siguiente, misma hora?", parse: { intent: "modify", name: "Sofía García", date: isoPlus(4), confidence: "medium" }, acceptedBookingId: "wasimS1" }, ctx),
  },
  {
    id: "md_addperson_liam", group: "Modifications", label: "Modify · +1 esta noche (Liam)",
    note: "Needs sample bookings seeded (links to wasimL1).",
    run: (ctx) => simulateInbound({ phone: PH.liam, language: "en", text: "A friend is joining — can we make tonight 3 instead of 2?", parse: { intent: "modify", name: "Liam O'Brien", size: 3, confidence: "high" }, acceptedBookingId: "wasimL1" }, ctx),
  },
  {
    id: "md_terrace_ines", group: "Modifications", label: "Modify · pide terraza (Inés, nota)",
    note: "Needs sample bookings seeded (links to wasimI1).",
    run: (ctx) => simulateInbound({ phone: PH.ines, language: "es", text: "¿Nos podríais poner en la terraza mañana si hace buen tiempo?", parse: { intent: "modify", name: "Inés Romero", notes: "Prefiere terraza si el tiempo acompaña", confidence: "medium" }, acceptedBookingId: "wasimI1" }, ctx),
  },
  {
    id: "md_running_late_greta", group: "Modifications", label: "Llega tarde a comida (Greta, nota)",
    note: "Needs sample bookings seeded (links to wasimG1).",
    run: (ctx) => simulateInbound({ phone: PH.greta, language: "en", text: "We're running about 20 minutes late for our lunch booking, sorry!", parse: { intent: "modify", name: "Greta Nilsson", notes: "Running ~20 min late", confidence: "high" }, acceptedBookingId: "wasimG1" }, ctx),
  },

  // ── Questions & info ────────────────────────────────────────────────────────
  {
    id: "q_veggie", group: "Questions & info", label: "Pregunta · menú vegetariano/vegano",
    run: (ctx) => simulateInbound({ phone: "+34604000001", language: "es", text: "¿Tenéis opciones veganas además de vegetarianas?", parse: { intent: "question" } }, ctx),
  },
  {
    id: "q_parking", group: "Questions & info", label: "Question · parking nearby (EN)",
    run: (ctx) => simulateInbound({ phone: "+447900222020", language: "en", text: "Is there parking near the restaurant?", parse: { intent: "question" } }, ctx),
  },
  {
    id: "q_hours_today", group: "Questions & info", label: "Pregunta · ¿abrís hoy? horario",
    run: (ctx) => simulateInbound({ phone: "+34604000002", language: "es", text: "¿A qué hora abrís hoy?", parse: { intent: "question" } }, ctx),
  },
  {
    id: "q_dogs", group: "Questions & info", label: "Question · dogs on the terrace (EN)",
    run: (ctx) => simulateInbound({ phone: "+34604000003", language: "en", text: "Are dogs allowed on the terrace? We have a small one.", parse: { intent: "question" } }, ctx),
  },
  {
    id: "q_kidsmenu", group: "Questions & info", label: "Pregunta · menú infantil / tronas",
    run: (ctx) => simulateInbound({ phone: "+34604000004", language: "es", text: "¿Tenéis menú infantil y tronas para niños pequeños?", parse: { intent: "question" } }, ctx),
  },
  {
    id: "q_dresscode", group: "Questions & info", label: "Question · dress code (EN)",
    run: (ctx) => simulateInbound({ phone: "+34604000005", language: "en", text: "Is there a dress code for dinner?", parse: { intent: "question" } }, ctx),
  },
  {
    id: "q_voucher", group: "Questions & info", label: "Pregunta · tarjeta regalo",
    run: (ctx) => simulateInbound({ phone: "+34604000006", language: "es", text: "¿Vendéis tarjetas regalo? Quería regalar una cena", parse: { intent: "question" } }, ctx),
  },
  {
    id: "q_allergy_info", group: "Questions & info", label: "Question · nut allergy catering (EN)",
    run: (ctx) => simulateInbound({ phone: "+34604000007", language: "en", text: "One of our party has a serious nut allergy — can the kitchen accommodate?", parse: { intent: "question" } }, ctx),
  },

  // ── Special requests (booking + note) ───────────────────────────────────────
  {
    id: "sr_wheelchair", group: "Special requests", label: "Reserva · mesa accesible (silla de ruedas)",
    run: (ctx) => simulateInbound({ phone: "+34605000001", language: "es", text: "Mesa para 2 el sábado a las 14:00, uno va en silla de ruedas, ¿hay acceso?", parse: { intent: "new_booking", size: 2, date: nextDow(6), time: "14:00", notes: "Acceso silla de ruedas — mesa accesible", confidence: "high" } }, ctx),
  },
  {
    id: "sr_quiet", group: "Special requests", label: "Reserva · rincón tranquilo (reunión)",
    run: (ctx) => simulateInbound({ phone: "+34605000002", language: "es", text: "Para 2 el jueves a las 21:00, a poder ser un sitio tranquilo para hablar", parse: { intent: "new_booking", size: 2, date: nextDow(4), time: "21:00", notes: "Prefiere un rincón tranquilo", confidence: "high" } }, ctx),
  },
  {
    id: "sr_proposal", group: "Special requests", label: "Booking · marriage proposal setup (EN, note)",
    run: (ctx) => simulateInbound({ phone: "+447900222030", language: "en", text: "Table for 2 Friday 9pm — I'm planning to propose, could you help with something special?", parse: { intent: "new_booking", size: 2, date: nextDow(5), time: "21:00", notes: "Proposal — wants something special arranged", confidence: "high" } }, ctx),
  },
  {
    id: "sr_allergy_severe", group: "Special requests", label: "Booking · severe shellfish allergy (EN, note)",
    run: (ctx) => simulateInbound({ phone: "+34605000003", language: "en", text: "Booking for 2 tomorrow at 8 — severe shellfish allergy, please flag to the kitchen", parse: { intent: "new_booking", size: 2, date: isoPlus(1), time: "20:00", notes: "SEVERE shellfish allergy — flag kitchen", confidence: "high" } }, ctx),
  },

  // ── Timing & window ─────────────────────────────────────────────────────────
  {
    id: "tw_near_expiry", group: "Timing & window", label: "Window casi caducada (recibido hace 23h)",
    note: "Composer still open, but the window chip shows ~1h left.",
    run: (ctx) => simulateInbound({ phone: "+34606000001", language: "en", text: "Hi, did you manage to check availability for us?", windowAgeMs: 23 * 60 * 60 * 1000, parse: { intent: "question" } }, ctx),
  },
  {
    id: "tw_expired_es", group: "Timing & window", label: "Window caducada · ES (hace 26h)",
    run: (ctx) => simulateInbound({ phone: "+34606000002", language: "es", text: "Hola, ¿tenéis mesa para 2 el finde?", windowAgeMs: 26 * 60 * 60 * 1000, parse: { intent: "new_booking", size: 2, date: nextDow(6), time: "21:00", confidence: "medium" } }, ctx),
  },
  {
    id: "tw_append_double", group: "Timing & window", label: "Dos mensajes seguidos (append + reset)",
    note: "One thread, two inbound messages — ends as a parsed draft.",
    run: (ctx) => {
      const p = "+34606000003";
      simulateInbound({ phone: p, language: "es", text: "Hola, ¿tenéis mesa libre hoy?", windowAgeMs: 4000, parse: { intent: "question" } }, ctx);
      return simulateInbound({ phone: p, language: "es", text: "Para 2 a las 21:00 si puede ser", parse: { intent: "new_booking", size: 2, date: isoPlus(0), time: "21:00", confidence: "medium" } }, ctx);
    },
  },

  // ── Tricky / non-bookings ───────────────────────────────────────────────────
  {
    id: "tk_wrongnumber", group: "Tricky / non-bookings", label: "Número equivocado / spam",
    note: "Other intent → message only; no draft.",
    run: (ctx) => simulateInbound({ phone: "+34607000001", language: "es", text: "Hola, ¿es la peluquería? Quería pedir cita", parse: { intent: "other" } }, ctx),
  },
  {
    id: "tk_emoji", group: "Tricky / non-bookings", label: "Solo emojis 👍🎉",
    note: "Other intent → message only; no draft.",
    run: (ctx) => simulateInbound({ phone: "+34607000002", language: "es", text: "👍🎉🙏", parse: { intent: "other" } }, ctx),
  },
];

export const SCENARIOS_BY_ID = SCENARIOS.reduce((acc, s) => { acc[s.id] = s; return acc; }, {});
