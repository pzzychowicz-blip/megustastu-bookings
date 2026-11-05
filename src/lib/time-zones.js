// src/lib/time-zones.js
//
// v18.15.0 — the restaurant's time zone as something a person picks and reads:
// the list Settings → General offers, how a zone is named on screen, and the
// header's "whose clock is this" note. Pure; the clock itself is lib/day.js.
//
// The list is the engine's own (`Intl.supportedValuesOf("timeZone")`, about
// 420 zones in Chrome and Safari), not a copy: a zone the engine cannot format
// in is one `setTimeZone` would refuse anyway, so the two cannot disagree.

import { zoneOffsetMinutes, isValidTimeZone } from "./day.js";

// Every zone this engine knows, sorted, always including `keep` (the zone in
// force), so a stored zone missing from an older engine's list still shows as
// chosen rather than vanishing from its own picker.
export function zoneList(keep) {
  let list = [];
  try {
    if (typeof Intl.supportedValuesOf === "function") list = Intl.supportedValuesOf("timeZone").slice();
  } catch { list = []; }
  if (keep && isValidTimeZone(keep) && list.indexOf(keep) < 0) list.push(keep);
  return list.sort();
}

// "Atlantic/Canary" → "Canary", "America/Argentina/Buenos_Aires" → "Buenos
// Aires": the place, for the header's note ("Canary time").
export function zonePlace(tz) {
  if (typeof tz !== "string" || !tz) return "";
  const last = tz.split("/").pop();
  return last.replace(/_/g, " ");
}

// "Atlantic/Canary" → "Atlantic / Canary", for a list row: the whole id, with
// room to wrap and no underscores.
export function zoneName(tz) {
  if (typeof tz !== "string" || !tz) return "";
  return tz.split("/").map(function (p) { return p.replace(/_/g, " "); }).join(" / ");
}

// The offset in force at `at`, as people write it: "UTC+1", "UTC", "UTC−3:30".
// A real minus sign (U+2212), so a screen reader says "minus" and the width
// matches the plus. "" for a zone this engine cannot format in.
export function offsetLabel(tz, at) {
  if (!isValidTimeZone(tz)) return "";
  const mins = zoneOffsetMinutes(at == null ? Date.now() : at, tz);
  if (!Number.isFinite(mins)) return "";
  if (mins === 0) return "UTC";
  const a = Math.abs(mins);
  const h = Math.floor(a / 60), m = a % 60;
  return "UTC" + (mins > 0 ? "+" : "−") + h + (m ? ":" + String(m).padStart(2, "0") : "");
}

// Does `tz` answer the query typed into the picker's search box? Case and
// accents ignored, "/" and "_" read as spaces, and the offset label counts, so
// "canary", "new york" and "utc+1" all find what a person expects. An empty
// query matches everything.
function fold(s) {
  return String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[/_]/g, " ").replace(/−/g, "-");
}
export function matchesZone(tz, q, at) {
  const needle = fold(q).trim();
  if (!needle) return true;
  return fold(tz).indexOf(needle) >= 0 || fold(offsetLabel(tz, at)).indexOf(needle) >= 0;
}

// The header's note: "Canary time" while THIS device's clock reads differently
// from the restaurant's at `at`, else null. Offsets are compared, not names, so
// a device in Lisbon (the same clock as the Canaries all year) shows nothing,
// and a device on the restaurant's zone under another name shows nothing either.
// No restaurant zone (null) is the device's own: nothing to say.
export function zoneNote(restaurantTz, at) {
  if (!isValidTimeZone(restaurantTz)) return null;
  const t = at == null ? Date.now() : at;
  const here = zoneOffsetMinutes(t, null);
  const there = zoneOffsetMinutes(t, restaurantTz);
  if (!Number.isFinite(here) || !Number.isFinite(there) || here === there) return null;
  return zonePlace(restaurantTz) + " time";
}
