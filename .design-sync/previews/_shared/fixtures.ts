// Shared by the screen previews — not a component of the design system.
//
// One evening service at Me Gustas Tú, frozen at 20:10, plus five weeks either
// side of it for the week and month views. Every booking has the shape the
// app's `sanitize` (src/lib/booking-logic.js) gives a stored booking, so the
// views render it exactly as they render live data.
//
// TODAY is the REAL local date, computed the way the app's `todayStr()` does.
// It cannot be a fixed literal: PlanView and WeekView read the clock
// themselves to decide which day is "today" (the Now button, the live
// occupancy, the highlighted row), so a fixed date would render every preview
// as a day in the past.
import { DEFAULT_LAYOUT } from "megustastu-bookings";

const pad = (n: number) => String(n).padStart(2, "0");
const localStr = (d: Date) => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());

export const TODAY = localStr(new Date());
export const NOW = 20 * 60 + 10; // 20:10 — mid-service: some parties seated, most still to come

// Same all-UTC arithmetic as the app's addDays (src/lib/day.js).
export function addDaysStr(date: string, n: number) {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

let stamp = 1_700_000_000_000;
export function bk(p: any) {
  const duration = p.duration || 90;
  return {
    id: p.id, name: p.name || "", phone: p.phone || "", date: p.date || TODAY,
    time: p.time, scheduledTime: p.time, size: p.size || 2,
    duration, originalDuration: duration, preference: p.preference || "auto",
    notes: p.notes || "", status: p.status || "confirmed", tables: p.tables || [],
    customDur: p.customDur || null, _manual: !!p._manual, _locked: !!p._locked, _conflict: false,
    preferredTables: p.preferredTables || [], returnOf: null, history: [],
    noShow: !!p.noShow, deposit: p.deposit || 0, voucherCode: p.voucherCode || "",
    recurringId: null, recurringDate: null, anonymized: false, guestId: null,
    stayedMin: p.stayedMin || 0, updatedAt: stamp++,
  };
}

// ── Today: lunch is over, the evening is under way ────────────────────────────
export const DAY_BOOKINGS = [
  bk({ id: "b01", name: "Carmen Delgado", phone: "+34 611 204 118", time: "13:00", size: 2, tables: ["1A"], status: "completed", stayedMin: 75 }),
  bk({ id: "b02", name: "Familia Ortega", phone: "+34 622 918 440", time: "13:30", size: 4, tables: ["7"], status: "completed", stayedMin: 95 }),
  bk({ id: "b03", name: "Jonas Weber", phone: "+49 151 2233 8190", time: "14:00", size: 2, tables: ["i1"], status: "completed", stayedMin: 60 }),
  bk({ id: "b04", name: "Hannah Clarke", phone: "+44 7700 900 412", time: "14:15", size: 3, tables: ["2", "3"], status: "cancelled" }),
  bk({ id: "b07", name: "Sophie Martin", phone: "+33 6 12 44 90 21", time: "18:45", size: 2, tables: ["i2"], status: "seated" }),
  bk({ id: "b05", name: "Marco Bianchi", phone: "+39 347 555 0192", time: "19:00", size: 2, tables: ["5A"], status: "seated" }),
  bk({ id: "b06", name: "Familia Pérez", phone: "+34 633 781 002", time: "19:15", size: 4, tables: ["7"], status: "seated", notes: "Birthday — cake at 21:00" }),
  bk({ id: "b08", name: "Ana Ruiz", phone: "+34 644 120 577", time: "19:45", size: 2, tables: ["1A"], status: "confirmed" }),
  bk({ id: "b09", name: "Lucía Hernández", phone: "+34 612 345 678", time: "20:00", size: 3, tables: ["2", "3"], status: "seated", duration: 120, deposit: 30 }),
  bk({ id: "b18", name: "Daniel Cruz", phone: "+34 655 300 921", time: "20:20", size: 2, tables: ["i2"], status: "confirmed" }),
  bk({ id: "b10", name: "Pierre Laurent", phone: "+33 7 81 22 30 45", time: "20:30", size: 2, tables: ["i3"], status: "pending" }),
  bk({ id: "b11", name: "Elena Moreno", phone: "+34 699 410 233", time: "20:30", size: 2, tables: ["4"], status: "confirmed", preferredTables: ["4"], notes: "Terrace, by the railing" }),
  bk({ id: "b12", name: "Tom Fischer", phone: "+49 170 889 1204", time: "20:45", size: 2, tables: ["6"], status: "confirmed", _manual: true, _locked: true }),
  bk({ id: "b14", name: "Yuki Tanaka", phone: "+81 90 1234 5678", time: "21:00", size: 2, tables: ["i1"], status: "confirmed" }),
  bk({ id: "b13", name: "Grupo Martín", phone: "+34 677 015 336", time: "21:15", size: 6, tables: ["1A", "1B"], status: "confirmed", deposit: 60 }),
  bk({ id: "b15", name: "Rafael Gómez", phone: "+34 688 902 114", time: "21:15", size: 2, tables: ["5B"], status: "pending" }),
  bk({ id: "b16", name: "Olivia Brown", phone: "+44 7911 123 456", time: "21:30", size: 2, tables: ["5A"], status: "confirmed" }),
];

// The history the day's markers read: Elena is a regular (2+ completed
// visits), Pierre has two past no-shows on the same phone.
const HISTORY = [
  bk({ id: "h01", name: "Elena Moreno", phone: "+34 699 410 233", date: addDaysStr(TODAY, -9), time: "20:30", size: 2, tables: ["4"], status: "completed", stayedMin: 80 }),
  bk({ id: "h02", name: "Elena Moreno", phone: "+34 699 410 233", date: addDaysStr(TODAY, -23), time: "21:00", size: 2, tables: ["4"], status: "completed", stayedMin: 85 }),
  bk({ id: "h03", name: "Elena Moreno", phone: "+34 699 410 233", date: addDaysStr(TODAY, -30), time: "20:00", size: 3, tables: ["2", "3"], status: "completed", stayedMin: 100 }),
  bk({ id: "h04", name: "Pierre Laurent", phone: "+33 7 81 22 30 45", date: addDaysStr(TODAY, -12), time: "20:00", size: 2, tables: ["i3"], status: "cancelled", noShow: true }),
  bk({ id: "h05", name: "Pierre Laurent", phone: "+33 7 81 22 30 45", date: addDaysStr(TODAY, -33), time: "21:00", size: 2, tables: ["i2"], status: "cancelled", noShow: true }),
];

// Five weeks either side, for WeekView's week list, month grid and stats.
// Deterministic (a seeded PRNG), so every capture draws the same calendar.
function mulberry32(seed: number) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// A mix of full names and bare surnames, as bookings are actually taken.
const NAMES = ["García", "Laura Rodríguez", "Müller", "James Smith", "Rossi", "Claire Dubois", "Santos", "Mette Jensen", "Novak", "Anna Kowalska", "Pablo Suárez", "Molina", "Emma Baker", "Costa", "Erik Lindqvist", "Javier Álvarez"];
const SINGLES = ["1A", "1B", "2", "3", "4", "5A", "5B", "6", "i1", "i2", "i3", "i4"];
function generated() {
  const rnd = mulberry32(20260926);
  const out: any[] = [];
  for (let off = -35; off <= 35; off++) {
    if (off === 0) continue;
    const date = addDaysStr(TODAY, off);
    const dow = new Date(date + "T00:00:00Z").getUTCDay(); // 0 Sun … 6 Sat
    const weekend = dow === 5 || dow === 6 || dow === 0;
    // Busier at weekends; the far future is still filling up.
    const base = weekend ? 16 : 9;
    const fill = off > 14 ? 0.35 : off > 0 ? 0.75 : 1;
    const n = Math.round((base + rnd() * 7) * fill);
    for (let i = 0; i < n; i++) {
      const slot = Math.floor(rnd() * 34);                    // 13:00 … 21:15 in quarters
      const mins = 13 * 60 + slot * 15;
      const size = rnd() < 0.55 ? 2 : rnd() < 0.6 ? 4 : rnd() < 0.5 ? 3 : 6;
      const status = off < 0
        ? (rnd() < 0.08 ? "cancelled" : "completed")
        : (rnd() < 0.15 ? "pending" : "confirmed");
      out.push(bk({
        id: "g" + (off + 100) + "_" + i,
        name: NAMES[Math.floor(rnd() * NAMES.length)],
        phone: "+34 600 " + String(100000 + Math.floor(rnd() * 899999)).slice(0, 3) + " " + String(Math.floor(rnd() * 999)).padStart(3, "0"),
        date, time: pad(Math.floor(mins / 60)) + ":" + pad(mins % 60), size,
        tables: [size > 4 ? "7" : SINGLES[Math.floor(rnd() * SINGLES.length)]],
        status, stayedMin: status === "completed" ? 60 + Math.floor(rnd() * 50) : 0,
      }));
    }
  }
  return out;
}

export const ALL_BOOKINGS = [...DAY_BOOKINGS, ...HISTORY, ...generated()];

// ── The live maps App derives and hands to the views ──────────────────────────
// lateMap: Ana was due at 19:45 and has not arrived.
export const LATE: Record<string, string> = { b08: "warn" };
// Freeing-soon predictions (minutes until the table is free), seated only.
export const FREEING: Record<string, number> = { b05: 20, b06: 35 };
// Overlap warnings: Sophie (seated since 18:45 on i2) is due off the table in
// time for Daniel's 20:20 — ten minutes from now.
export const WARNINGS: Record<string, any> = {
  b07: { next: "Daniel Cruz", nextTime: "20:20", gap: 10, overdue: false, nextId: "b18" },
};
// Table blocks: i4 is held for a staff dinner at the end of the night.
export const BLOCKS = [{ id: "blk1", date: TODAY, tableId: "i4", from: "21:30", to: "23:00" }];

// ── The floor plan (Settings → Layout → Floor plan), in centimetres ───────────
// The dining room across the top behind its front wall, the terrace below it.
// Shapes follow the editor's sanitizeFloorPlan: square 2-tops, one rect 4-top.
const sq = (x: number, y: number) => ({ x, y, shape: "square", w: 70, h: 70, rot: 0, chairs: { top: 1, right: 0, bottom: 1, left: 0 } });
export const FLOOR = {
  v: 1,
  room: { w: 1100, h: 760 },
  walls: [
    { x1: 20, y1: 20, x2: 1080, y2: 20 },
    { x1: 20, y1: 20, x2: 20, y2: 300 },
    { x1: 1080, y1: 20, x2: 1080, y2: 300 },
    { x1: 20, y1: 300, x2: 360, y2: 300 },
    { x1: 460, y1: 300, x2: 1080, y2: 300 },
  ],
  doors: [{ x: 410, y: 300, rot: 0, width: 100, flip: false }],
  tables: {
    i1: sq(190, 160),
    i2: sq(700, 160), i3: sq(780, 160), i4: sq(860, 160),
    "1A": sq(150, 440), "1B": sq(230, 440),
    "7": { x: 190, y: 630, shape: "rect", w: 150, h: 80, rot: 0, chairs: { top: 2, right: 0, bottom: 2, left: 0 } },
    "2": sq(560, 460), "3": sq(640, 460), "4": sq(720, 460),
    "5A": sq(800, 640), "5B": sq(880, 640), "6": sq(960, 640),
  },
};
export const LAYOUT = { ...DEFAULT_LAYOUT, floorPlan: FLOOR };
