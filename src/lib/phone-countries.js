// src/lib/phone-countries.js
//
// v18.1.0 — the world's country calling codes, and the two functions that
// turn one stored phone string into (country, number) and back.
//
// ── Why the phone is still ONE string ────────────────────────────────────────
// The booking form shows the country code and the number as two controls, but
// `booking.phone` stays exactly what it was: "+34 600 123 456". Everything
// downstream keys on that string — `normalizePhone` (the customer identity),
// the WhatsApp phoneKey, history diffs, `enteredPhone` — and a split STORED
// shape would be a new per-booking field, which has to join five lists
// (CLAUDE.md's gotcha) and would re-key every existing customer. The split is a
// view of the string, not a new shape of the data.
//
// ── The list ─────────────────────────────────────────────────────────────────
// Source: countrycode.org's table (Patryk's reference), as a static file — the
// app cannot fetch it at runtime (CSP `connect-src`, and it must work offline).
// `dial` is DIGITS ONLY, no "+". Where countrycode.org writes a code with an
// area code ("1-876" Jamaica, "44-1481" Guernsey) the area code is part of
// `dial` here, because that is what makes a stored "+1 876 …" parse back to
// Jamaica rather than to the USA. Shared codes (+1 USA/Canada, +7
// Russia/Kazakhstan, +61 Australia/Christmas Island…) are resolved by
// `PRIMARY` unless the caller's own preference already carries that code.
//
// Rows are "ISO|Name|dial". One string per row keeps 240 rows greppable and
// the file a third the size of an array of objects.

const ROWS = [
  "AF|Afghanistan|93", "AL|Albania|355", "DZ|Algeria|213", "AS|American Samoa|1684",
  "AD|Andorra|376", "AO|Angola|244", "AI|Anguilla|1264", "AQ|Antarctica|672",
  "AG|Antigua and Barbuda|1268", "AR|Argentina|54", "AM|Armenia|374", "AW|Aruba|297",
  "AU|Australia|61", "AT|Austria|43", "AZ|Azerbaijan|994", "BS|Bahamas|1242",
  "BH|Bahrain|973", "BD|Bangladesh|880", "BB|Barbados|1246", "BY|Belarus|375",
  "BE|Belgium|32", "BZ|Belize|501", "BJ|Benin|229", "BM|Bermuda|1441",
  "BT|Bhutan|975", "BO|Bolivia|591", "BA|Bosnia and Herzegovina|387", "BW|Botswana|267",
  "BR|Brazil|55", "IO|British Indian Ocean Territory|246", "VG|British Virgin Islands|1284",
  "BN|Brunei|673", "BG|Bulgaria|359", "BF|Burkina Faso|226", "BI|Burundi|257",
  "KH|Cambodia|855", "CM|Cameroon|237", "CA|Canada|1", "CV|Cape Verde|238",
  "KY|Cayman Islands|1345", "CF|Central African Republic|236", "TD|Chad|235",
  "CL|Chile|56", "CN|China|86", "CX|Christmas Island|61", "CC|Cocos Islands|61",
  "CO|Colombia|57", "KM|Comoros|269", "CK|Cook Islands|682", "CR|Costa Rica|506",
  "HR|Croatia|385", "CU|Cuba|53", "CW|Curaçao|599", "CY|Cyprus|357",
  "CZ|Czech Republic|420", "CD|Democratic Republic of the Congo|243", "DK|Denmark|45",
  "DJ|Djibouti|253", "DM|Dominica|1767", "DO|Dominican Republic|1809",
  "TL|East Timor|670", "EC|Ecuador|593", "EG|Egypt|20", "SV|El Salvador|503",
  "GQ|Equatorial Guinea|240", "ER|Eritrea|291", "EE|Estonia|372", "SZ|Eswatini|268",
  "ET|Ethiopia|251", "FK|Falkland Islands|500", "FO|Faroe Islands|298", "FJ|Fiji|679",
  "FI|Finland|358", "FR|France|33", "GF|French Guiana|594", "PF|French Polynesia|689",
  "GA|Gabon|241", "GM|Gambia|220", "GE|Georgia|995", "DE|Germany|49", "GH|Ghana|233",
  "GI|Gibraltar|350", "GR|Greece|30", "GL|Greenland|299", "GD|Grenada|1473",
  "GP|Guadeloupe|590", "GU|Guam|1671", "GT|Guatemala|502", "GG|Guernsey|441481",
  "GN|Guinea|224", "GW|Guinea-Bissau|245", "GY|Guyana|592", "HT|Haiti|509",
  "HN|Honduras|504", "HK|Hong Kong|852", "HU|Hungary|36", "IS|Iceland|354",
  "IN|India|91", "ID|Indonesia|62", "IR|Iran|98", "IQ|Iraq|964", "IE|Ireland|353",
  "IM|Isle of Man|441624", "IL|Israel|972", "IT|Italy|39", "CI|Ivory Coast|225",
  "JM|Jamaica|1876", "JP|Japan|81", "JE|Jersey|441534", "JO|Jordan|962",
  "KZ|Kazakhstan|7", "KE|Kenya|254", "KI|Kiribati|686", "XK|Kosovo|383",
  "KW|Kuwait|965", "KG|Kyrgyzstan|996", "LA|Laos|856", "LV|Latvia|371",
  "LB|Lebanon|961", "LS|Lesotho|266", "LR|Liberia|231", "LY|Libya|218",
  "LI|Liechtenstein|423", "LT|Lithuania|370", "LU|Luxembourg|352", "MO|Macau|853",
  "MG|Madagascar|261", "MW|Malawi|265", "MY|Malaysia|60", "MV|Maldives|960",
  "ML|Mali|223", "MT|Malta|356", "MH|Marshall Islands|692", "MQ|Martinique|596",
  "MR|Mauritania|222", "MU|Mauritius|230", "YT|Mayotte|262", "MX|Mexico|52",
  "FM|Micronesia|691", "MD|Moldova|373", "MC|Monaco|377", "MN|Mongolia|976",
  "ME|Montenegro|382", "MS|Montserrat|1664", "MA|Morocco|212", "MZ|Mozambique|258",
  "MM|Myanmar|95", "NA|Namibia|264", "NR|Nauru|674", "NP|Nepal|977",
  "NL|Netherlands|31", "NC|New Caledonia|687", "NZ|New Zealand|64", "NI|Nicaragua|505",
  "NE|Niger|227", "NG|Nigeria|234", "NU|Niue|683", "NF|Norfolk Island|672",
  "KP|North Korea|850", "MK|North Macedonia|389", "MP|Northern Mariana Islands|1670",
  "NO|Norway|47", "OM|Oman|968", "PK|Pakistan|92", "PW|Palau|680",
  "PS|Palestine|970", "PA|Panama|507", "PG|Papua New Guinea|675", "PY|Paraguay|595",
  "PE|Peru|51", "PH|Philippines|63", "PN|Pitcairn|64", "PL|Poland|48",
  "PT|Portugal|351", "PR|Puerto Rico|1787", "QA|Qatar|974",
  "CG|Republic of the Congo|242", "RE|Réunion|262", "RO|Romania|40", "RU|Russia|7",
  "RW|Rwanda|250", "BL|Saint Barthélemy|590", "SH|Saint Helena|290",
  "KN|Saint Kitts and Nevis|1869", "LC|Saint Lucia|1758", "MF|Saint Martin|590",
  "PM|Saint Pierre and Miquelon|508", "VC|Saint Vincent and the Grenadines|1784",
  "WS|Samoa|685", "SM|San Marino|378", "ST|São Tomé and Príncipe|239",
  "SA|Saudi Arabia|966", "SN|Senegal|221", "RS|Serbia|381", "SC|Seychelles|248",
  "SL|Sierra Leone|232", "SG|Singapore|65", "SX|Sint Maarten|1721", "SK|Slovakia|421",
  "SI|Slovenia|386", "SB|Solomon Islands|677", "SO|Somalia|252", "ZA|South Africa|27",
  "KR|South Korea|82", "SS|South Sudan|211", "ES|Spain|34", "LK|Sri Lanka|94",
  "SD|Sudan|249", "SR|Suriname|597", "SJ|Svalbard and Jan Mayen|47", "SE|Sweden|46",
  "CH|Switzerland|41", "SY|Syria|963", "TW|Taiwan|886", "TJ|Tajikistan|992",
  "TZ|Tanzania|255", "TH|Thailand|66", "TG|Togo|228", "TK|Tokelau|690", "TO|Tonga|676",
  "TT|Trinidad and Tobago|1868", "TN|Tunisia|216", "TR|Turkey|90",
  "TM|Turkmenistan|993", "TC|Turks and Caicos Islands|1649", "TV|Tuvalu|688",
  "VI|U.S. Virgin Islands|1340", "UG|Uganda|256", "UA|Ukraine|380",
  "AE|United Arab Emirates|971", "GB|United Kingdom|44", "US|United States|1",
  "UY|Uruguay|598", "UZ|Uzbekistan|998", "VU|Vanuatu|678", "VA|Vatican|379",
  "VE|Venezuela|58", "VN|Vietnam|84", "WF|Wallis and Futuna|681",
  "EH|Western Sahara|212", "YE|Yemen|967", "ZM|Zambia|260", "ZW|Zimbabwe|263",
];

export const COUNTRIES = ROWS.map(function (r) {
  const p = r.split("|");
  return { iso: p[0], name: p[1], dial: p[2] };
}).sort(function (a, b) { return a.name.localeCompare(b.name); });

const BY_ISO = {};
COUNTRIES.forEach(function (c) { BY_ISO[c.iso] = c; });

export function countryByIso(iso) {
  return (iso && BY_ISO[String(iso).toUpperCase()]) || null;
}

// Which country a SHARED code means when nothing else says. The biggest
// population wins, which is also what a stored "+1 …" most likely is.
const PRIMARY = { "1": "US", "7": "RU", "44": "GB", "47": "NO", "61": "AU",
  "64": "NZ", "212": "MA", "262": "RE", "590": "GP", "672": "NF" };

// The restaurant's default when nothing has been chosen — the countries its
// guests most often come from. Only a SEED: Settings → General edits the list.
export const DEFAULT_PINNED = ["ES", "GB", "DE", "FR", "IT", "NL"];
export const DEFAULT_COUNTRY = "ES";
export const MAX_PINNED = 12;

// The flag as an emoji: two regional-indicator letters. Kosovo's "XK" is not
// a Unicode flag and renders as the two letters, which still identifies it.
export function flagOf(iso) {
  if (!iso || iso.length !== 2) return "";
  const A = 0x1f1e6;
  return String.fromCodePoint(A + iso.charCodeAt(0) - 65, A + iso.charCodeAt(1) - 65);
}

// "+34", "+1 876", "+44 1481" — the code as a person writes it, with the
// NANP / Crown-dependency area code set apart from the country code.
export function dialLabel(c) {
  if (!c) return "+";
  const d = c.dial;
  if (d.length === 4 && d.charAt(0) === "1") return "+1 " + d.slice(1);
  if (d.length === 6 && d.slice(0, 2) === "44") return "+44 " + d.slice(2);
  return "+" + d;
}

// ── Every dial code, longest first ───────────────────────────────────────────
// So "+1876…" matches Jamaica (1876) before the USA (1), and "+441481…"
// Guernsey before the UK.
const DIALS = Array.from(new Set(COUNTRIES.map(function (c) { return c.dial; })))
  .sort(function (a, b) { return b.length - a.length; });

function isoForDial(dial, preferIso) {
  const pref = countryByIso(preferIso);
  if (pref && pref.dial === dial) return pref.iso;
  if (PRIMARY[dial]) return PRIMARY[dial];
  const hit = COUNTRIES.find(function (c) { return c.dial === dial; });
  return hit ? hit.iso : null;
}

// The calling code an international string STARTS with ("+44 7…" → "44",
// "0034…" → "34"), or "" when it names none yet — "+", "+3", a local number.
// PhoneField asks this while someone is typing "+44" one key at a time.
export function dialOf(phone) {
  const s = phone == null ? "" : String(phone).trim();
  const intl = s.charAt(0) === "+" ? s.slice(1) : (s.slice(0, 2) === "00" ? s.slice(2) : null);
  if (intl === null) return "";
  const digits = intl.replace(/\D/g, "");
  return DIALS.find(function (d) { return digits.slice(0, d.length) === d; }) || "";
}

// ── splitPhone ───────────────────────────────────────────────────────────────
// "+34 600 123 456" → { iso: "ES", national: "600 123 456" }. The number keeps
// whatever spacing was typed; only the "+" and the code's own digits are
// consumed. `preferIso` settles shared codes (the country the user picked, or
// the restaurant's default) and is the answer when the string names no
// country at all — empty, a lone "+", or a legacy number stored without one,
// which is shown as-is and NOT rewritten unless somebody edits it.
export function splitPhone(phone, preferIso) {
  const fallback = countryByIso(preferIso) ? countryByIso(preferIso).iso : DEFAULT_COUNTRY;
  // LEADING space only: this runs on every keystroke of the number box, and
  // trimming the END would eat the space you just typed between "600" and
  // "123". The save path trims (`enteredPhone`), as it always has.
  const s = phone == null ? "" : String(phone).replace(/^\s+/, "");
  const intl = s.charAt(0) === "+" ? s.slice(1) : (s.slice(0, 2) === "00" ? s.slice(2) : null);
  if (intl === null) return { iso: fallback, national: s };
  const digits = intl.replace(/\D/g, "");
  const dial = DIALS.find(function (d) { return digits.slice(0, d.length) === d; });
  if (!dial) return { iso: fallback, national: intl };
  // Walk the original string until the code's digits are used up, so the
  // remainder keeps its own spacing and punctuation.
  let used = 0, i = 0;
  while (i < intl.length && used < dial.length) { if (/\d/.test(intl[i])) used++; i++; }
  return { iso: isoForDial(dial, preferIso) || fallback, national: intl.slice(i).replace(/^[\s\-().]+/, "") };
}

// ── joinPhone ────────────────────────────────────────────────────────────────
// The inverse. An empty number stores NOTHING — not the bare code — so
// switching country on an empty field never writes a phone, and a booking
// without one stays without one (the `enteredPhone` rule, now at the source).
// A number typed or pasted in international form ("+44 7700…", "0044 …")
// is taken whole: it already says its own country, and the field re-reads it.
export function joinPhone(iso, national) {
  const n = national == null ? "" : String(national).replace(/^\s+/, "");
  if (!/\d/.test(n)) return "";
  if (n.charAt(0) === "+") return n;
  if (n.slice(0, 2) === "00") return "+" + n.slice(2);
  const c = countryByIso(iso) || countryByIso(DEFAULT_COUNTRY);
  return dialLabel(c) + " " + n;
}

// The pinned list as stored: known ISO codes, upper-case, no repeats, capped.
export function cleanPinned(list) {
  if (!Array.isArray(list)) return DEFAULT_PINNED.slice();
  const out = [];
  list.forEach(function (x) {
    const c = countryByIso(x);
    if (c && out.indexOf(c.iso) < 0 && out.length < MAX_PINNED) out.push(c.iso);
  });
  return out;
}

// Matches a search against a country: name (any word's start, or anywhere
// for 3+ letters), ISO code, or dial digits ("34", "+34").
export function matchesCountry(c, query) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return true;
  const d = q.replace(/^\+/, "").replace(/\D/g, "");
  if (d && d === q.replace(/^\+/, "")) return c.dial.indexOf(d) === 0;
  const name = c.name.toLowerCase();
  if (c.iso.toLowerCase() === q) return true;
  if (q.length >= 3) return name.indexOf(q) >= 0;
  return name.split(/[\s-]+/).some(function (w) { return w.indexOf(q) === 0; });
}
