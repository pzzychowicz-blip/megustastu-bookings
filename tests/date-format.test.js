// tests/date-format.test.js — v18.2.0, the design critique's C1: one way to
// write a day on screen. "Thu 24.09", and "Thu 24.09.2027" when it is not this
// year.
//
// Measured on DEV before: ISO "2026-09-24" in Customers, Vouchers, Find a
// booking, the draft card, the block modal, a waitlist's title and a reminder's
// "Once on"; "24.09" in the Activity log; "Sep 21 – 27, 2026" in the Week view;
// "24 Sept 2026" in a booking's history; "Fri 18/09" in the voucher carry
// prompt and "24/09" in the carried-voucher note. After, on DEV: "Thu 24.09"
// in all of them, "Fri 15.01.2027" for a 2027 booking, "21.09 – 27.09" for the
// week, "Thursday · 24.09.2026" on the printed Day sheet, and a booking's
// history entry "date 2027-01-15→2027-01-16" displayed as "date Fri
// 15.01.2027→Sat 16.01.2027".

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import process from "node:process";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { stripComments } from "../scripts/strip-comments.mjs";
import { formatDay, showsYear, localDay, formatDaysIn, todayStr } from "../src/lib/day.js";
import { formatRelativeTime } from "../src/lib/whatsapp.js";

const REAL_TZ = process.env.TZ;
function withTZ(tz, fn) {
  const prev = process.env.TZ;
  process.env.TZ = tz;
  try { return fn(); } finally { process.env.TZ = prev; }
}
beforeAll(() => { process.env.TZ = "UTC"; });
afterAll(() => { process.env.TZ = REAL_TZ; });

const TODAY = "2026-09-24";

describe("formatDay — the house date", () => {
  it("is weekday, day and month, this year", () => {
    expect(formatDay("2026-09-24", { today: TODAY })).toBe("Thu 24.09");
    expect(formatDay("2026-01-01", { today: TODAY })).toBe("Thu 01.01");
  });

  it("adds the year when it is not this year, in either direction", () => {
    expect(formatDay("2027-01-15", { today: TODAY })).toBe("Fri 15.01.2027");
    expect(formatDay("2025-12-31", { today: TODAY })).toBe("Wed 31.12.2025");
  });

  it("drops the weekday where one is asked not to be printed", () => {
    expect(formatDay("2026-09-24", { today: TODAY, weekday: false })).toBe("24.09");
    expect(formatDay("2027-03-17", { today: TODAY, weekday: false })).toBe("17.03.2027");
  });

  it("prints the year always, for a record that outlives the year", () => {
    expect(formatDay("2026-09-24", { today: TODAY, year: "always" })).toBe("Thu 24.09.2026");
    expect(formatDay("2026-09-24", { today: TODAY, year: "always", weekday: false })).toBe("24.09.2026");
  });

  it("reads this year from the clock when not told", () => {
    const y = todayStr().slice(0, 4);
    expect(formatDay(y + "-06-01")).not.toMatch(/\.\d{4}$/);
    expect(formatDay(String(Number(y) + 1) + "-06-01")).toMatch(/\.\d{4}$/);
  });

  // A broken date is the one somebody needs to SEE in order to repair it, so
  // it comes back as stored rather than as "" or as a plausible wrong day.
  it("hands back anything that is not a canonical date, as it was", () => {
    for (const v of ["2026-8-3", "31/08/2026", "Sep 13 2026", "2026-02-30", "nonsense"]) {
      expect(formatDay(v, { today: TODAY })).toBe(v);
    }
    expect(formatDay("", { today: TODAY })).toBe("");
    expect(formatDay(null)).toBe("");
    expect(formatDay(undefined)).toBe("");
  });

  it("takes the weekday in UTC, like every date-only string in the app", () => {
    withTZ("Pacific/Honolulu", () => { expect(formatDay("2026-09-24", { today: TODAY })).toBe("Thu 24.09"); });
    withTZ("Pacific/Kiritimati", () => { expect(formatDay("2026-09-24", { today: TODAY })).toBe("Thu 24.09"); });
  });
});

describe("showsYear — the one place the year is decided", () => {
  it("is true only for a canonical date in another year", () => {
    expect(showsYear("2027-01-15", TODAY)).toBe(true);
    expect(showsYear("2025-12-31", TODAY)).toBe(true);
    expect(showsYear("2026-09-24", TODAY)).toBe(false);
    for (const v of ["2027-1-15", "15/01/2027", "", null, undefined]) expect(showsYear(v, TODAY)).toBe(false);
  });

  it("agrees with formatDay on every date it prints", () => {
    for (const d of ["2026-09-24", "2027-01-15", "2025-12-31"]) {
      expect(/\.\d{4}$/.test(formatDay(d, { today: TODAY }))).toBe(showsYear(d, TODAY));
    }
  });
});

describe("localDay — the local day an instant fell on", () => {
  it("is the LOCAL day, not the UTC one", () => {
    // 23:30 UTC on the 24th is 00:30 on the 25th in the Canaries (UTC+1 in
    // September): the same instant, two different days.
    const at = Date.UTC(2026, 8, 24, 23, 30);
    withTZ("UTC", () => { expect(localDay(at)).toBe("2026-09-24"); });
    withTZ("Atlantic/Canary", () => { expect(localDay(at)).toBe("2026-09-25"); });
  });

  it("takes an ISO date-time string as well as milliseconds", () => {
    withTZ("Atlantic/Canary", () => { expect(localDay("2026-09-24T23:30:00.000Z")).toBe("2026-09-25"); });
  });

  it("is empty for anything that is not an instant", () => {
    for (const v of [null, undefined, "", "nonsense", NaN]) expect(localDay(v)).toBe("");
  });
});

describe("formatDaysIn — stored text, written the house way on the way out", () => {
  it("rewrites every canonical date in a line and leaves the rest alone", () => {
    expect(formatDaysIn("edited: date 2026-09-24→2026-09-25", { today: TODAY })).toBe("edited: date Thu 24.09→Fri 25.09");
    expect(formatDaysIn("deleted Rosa · 2026-09-24 20:30", { today: TODAY })).toBe("deleted Rosa · Thu 24.09 20:30");
    expect(formatDaysIn("cleared the activity log · 2026-09-01 to 2027-01-02 · 5 entries", { today: TODAY }))
      .toBe("cleared the activity log · Tue 01.09 to Sat 02.01.2027 · 5 entries");
  });

  it("never touches a recurring occurrence's id or a date that is not one", () => {
    expect(formatDaysIn("rabc_2026-09-24", { today: TODAY })).toBe("rabc_2026-09-24");
    expect(formatDaysIn("date 2026-02-30→2026-03-01", { today: TODAY })).toBe("date 2026-02-30→Sun 01.03");
    expect(formatDaysIn("20260924 and 2026-9-24", { today: TODAY })).toBe("20260924 and 2026-9-24");
  });

  it("is a string for anything", () => {
    expect(formatDaysIn(null)).toBe("");
    expect(formatDaysIn(undefined)).toBe("");
    expect(formatDaysIn(42)).toBe("42");
  });
});

describe("formatRelativeTime — past a week, the house date", () => {
  it("writes the day it was, where it wrote the locale's '17 Sept'", () => {
    const ts = Date.now() - 10 * 86400000;
    expect(formatRelativeTime(ts)).toBe(formatDay(localDay(ts)));
    expect(formatRelativeTime(ts)).toMatch(/^(Sun|Mon|Tue|Wed|Thu|Fri|Sat) \d\d\.\d\d(\.\d{4})?$/);
  });

  it("keeps the relative words inside the week", () => {
    expect(formatRelativeTime(Date.now() - 3 * 86400000)).toBe("3 days ago");
  });
});

// ── The sites ────────────────────────────────────────────────────────────────
const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
const read = (rel) => stripComments(readFileSync(join(SRC, rel), "utf8")).join("\n");

describe("every date on screen goes through formatDay", () => {
  const sites = [
    ["components/SearchPanel.jsx", /minWidth: dateCol \}\}>\{formatDay\(b\.date\)\}<\/span>/],
    ["components/CustomersSettings.jsx", /minWidth: dateCol \}\}>\{formatDay\(b\.date\)\}<\/span>/],
    ["components/VouchersSettings.jsx", /return formatDay\(localDay\(ms\), \{ weekday: false \}\);/],
    ["components/HistoryPopup.jsx", /const dateStr = formatDay\(localDay\(h\.at\)\);/],
    ["components/HistoryPopup.jsx", /\{formatDaysIn\(h\.action\)\}/],
    ["components/HistoryPopup.jsx", /booking\.name \+ " — " \+ formatDay\(booking\.date\)/],
    ["components/Reminders.jsx", /recText = "Once on " \+ formatDay\(rec\.date\);/],
    ["components/WaitlistPanel.jsx", /\{"Waitlist — "\+formatDay\(date\)\}/],
    ["components/DaySheet.jsx", /weekdayName\(date\) \+ " · " \+ formatDay\(date, \{ weekday: false, year: "always" \}\)/],
    ["components/BlockModal.jsx", /"Table " \+ tableId \+ " — " \+ formatDay\(date\)/],
    ["components/BlockModal.jsx", /marginBottom: 16 \}\}>\{formatDay\(date\)\}<\/div>/],
    ["components/VoucherCarryModal.jsx", /return formatDay\(date\) \+ \(time \? " at " \+ time : ""\);/],
    ["components/ActivityLogModal.jsx", /return formatDay\(localDay\(ms\)\);/],
    ["components/WeekView.jsx", /return formatDay\(days\[0\], \{ weekday: false \}\) \+ " – " \+ formatDay\(days\[6\], \{ weekday: false \}\);/],
    ["components/BookingFormModal.jsx", /\(formatDay\(b\.date\)\|\|"\?"\)\+" · "/],
    ["components/BookingFormModal.jsx", /" on "\+formatDay\(form\.date\)\+":"/],
    ["components/BookingFormModal.jsx", /"Carried from the "\+formatDay\(src\.date\)\+" visit"/],
    ["components/BookingFormModal.jsx", /"Return guest · "\+src\.name\+" · "\+formatDay\(src\.date\)/],
    ["components/BookingFormModal.jsx", /" {2}· {2}last "\+formatDay\(r\.latestDate\)/],
    ["App.jsx", /"This conversation is linked to a booking on "\+formatDay\(bk\.date\)/],
    ["lib/vouchers.js", /" on " \+ formatDay\(other\.date\) \+ "\."/],
    ["lib/whatsapp.js", /return formatDay\(localDay\(ts\)\);/],
  ];
  for (const [file, re] of sites) {
    it(file + " — " + String(re).slice(1, 48), () => { expect(read(file)).toMatch(re); });
  }

  it("the WhatsApp cards, both lines of each", () => {
    expect((read("components/whatsapp/DraftCard.jsx").match(/\(formatDay\(d\.date\) \|\| "\? date"\)/g) || []).length).toBe(2);
    expect((read("components/whatsapp/LinkedBookingCard.jsx").match(/\(formatDay\(booking\.date\) \|\| "\?"\)/g) || []).length).toBe(2);
  });

  // The one locale date left is SPOKEN — the day announcement a screen reader
  // reads, "Thursday 24 September", which is for the ear and not the eye.
  it("leaves one toLocaleDateString in the app, and it is the spoken one", () => {
    const hits = [];
    for (const f of readdirSync(SRC, { recursive: true })) {
      if (!/\.jsx?$/.test(f)) continue;
      const n = (read(f).match(/toLocaleDateString\(/g) || []).length;
      if (n) hits.push(f + ":" + n);
    }
    expect(hits).toEqual(["App.jsx:1"]);
    expect(read("App.jsx")).toMatch(/d\.toLocaleDateString\("en-GB",\{weekday:"long",day:"numeric",month:"long",timeZone:"UTC"\}\)/);
  });

  it("no longer builds a dd/mm by hand anywhere", () => {
    for (const f of ["App.jsx", "components/BookingFormModal.jsx", "components/VoucherCarryModal.jsx"]) {
      expect(read(f), f).not.toMatch(/slice\(8, ?10\) ?\+ ?"\/"/);
    }
  });

  it("stores the carried voucher's day as ISO, so the screen can write it", () => {
    expect(read("App.jsx")).toMatch(/const fromLabel=c\.from\|\|"";/);
  });

  it("keeps the Activity log's CSV on ISO — a spreadsheet sorts it", () => {
    const log = read("components/ActivityLogModal.jsx");
    expect((log.match(/const text = formatDaysIn\(rowText\(r, byId\)\);/g) || []).length, "the filter and the row read one string").toBe(2);
    expect(read("lib/activity.js")).toMatch(/rowText\(r, byId \|\| \{\}\),/);
    expect(read("lib/activity.js")).not.toMatch(/formatDay/);
  });
});

describe("a column of dates is as wide as its widest date", () => {
  it("Find a booking: 68px, or 104 when a date prints its year", () => {
    const s = read("components/SearchPanel.jsx");
    expect(s).toMatch(/const dateCol = results\.some\(function \(b\) \{ return showsYear\(b\.date\); \}\) \? 104 : 68;/);
  });

  // Measured at 375px: the name was squeezed to 21.5px by the old 84px column
  // and to 1.5px by a year's 104; with the basis it is 104 and 140, and the
  // 1280px tablet keeps every row on one line.
  it("Find a booking: the name has a basis, so a wrapping row cannot crush it", () => {
    expect(read("components/SearchPanel.jsx")).toMatch(/<span style=\{\{ flex: "1 1 64px", minWidth: 0, fontSize: T\.lead/);
  });

  it("Customers: 68px or 104, and the visit row wraps rather than overflow", () => {
    const c = read("components/CustomersSettings.jsx");
    expect(c).toMatch(/const dateCol = open && c\.bookings\.some\(function \(b\) \{ return showsYear\(b\.date\); \}\) \? 104 : 68;/);
    expect(c).toMatch(/display: "flex", alignItems: "center", flexWrap: "wrap", gap: 8, padding: "6px 8px"/);
  });

  it("the Activity log: 54px or 84", () => {
    expect(read("components/ActivityLogModal.jsx")).toMatch(/const dateCol = showDate && shown\.some\(function \(r\) \{ return showsYear\(localDay\(r\.at\)\); \}\) \? 84 : 54;/);
  });
});
