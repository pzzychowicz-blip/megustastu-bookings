// scripts/privacy-page.mjs
//
// v18.7.0 — fills `public/privacy.html` from the tenant's profile.
//
// The page is the one PUBLIC document this deployment serves: Meta will not
// publish a WhatsApp app without a reachable privacy-policy URL, and the people
// it is written for are the restaurant's customers, who never sign in. It is a
// static file because it must load with no bundle, no Firebase and no script.
//
// A static file imports nothing, so the facts that belong to a RESTAURANT (its
// name, who legally runs it, how to reach them) are tokens in the source and
// are filled here from `src/tenants/<slug>.js`, the same way `tenantManifest()`
// in `vite.config.js` fills the install card. One function, called by the dev
// middleware and by `closeBundle`, and by `tests/privacy.test.js`.
//
// An EMPTY value is printed as a visible "to be confirmed", never as nothing:
// a policy that silently names nobody reads as finished.

const TBC = "[to be confirmed]";

function esc(s) {
  return String(s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function val(v) {
  const s = v == null ? "" : String(v).trim();
  return s ? esc(s) : TBC;
}

// The tokens the template may carry. A token outside this list is a typo in the
// template, and `renderPrivacy` throws on it rather than shipping `{{…}}`.
export const PRIVACY_TOKENS = [
  "restaurant", "controller", "phone", "email", "address", "updated_en", "updated_es",
];

// `privacy.updated` is stored once, as YYYY-MM-DD, and printed in the language of
// the section it sits in. A date typed out in words is one language's date, and
// the notice has two. UTC throughout: a date has no time zone to drift across.
function longDate(iso, locale) {
  const s = iso == null ? "" : String(iso).trim();
  if (!s) return TBC;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  const d = m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null;
  if (!d || d.getUTCMonth() !== +m[2] - 1) {
    throw new Error("privacy.updated must be a real date as YYYY-MM-DD, got: " + s);
  }
  return esc(new Intl.DateTimeFormat(locale, {
    day: "numeric", month: "long", year: "numeric", timeZone: "UTC",
  }).format(d));
}

export function renderPrivacy(template, profile) {
  const p = profile || {};
  const priv = p.privacy || {};
  const values = {
    restaurant: val(p.name),
    controller: val(priv.controller),
    // v18.12.1: the controller's contact details, which GDPR Art. 13(1)(a)
    // asks for beside its identity.
    phone: val(priv.phone),
    email: val(priv.email),
    address: val(priv.address),
    updated_en: longDate(priv.updated, "en-GB"),
    updated_es: longDate(priv.updated, "es-ES"),
  };
  // The template's HTML comments are notes for whoever edits it. They come off
  // first: they are not for the public, and they mention tokens by name.
  const body = String(template).replace(/<!--[\s\S]*?-->\n?/g, "");
  const out = body.replace(/\{\{(\w+)\}\}/g, function (whole, key) {
    if (!Object.prototype.hasOwnProperty.call(values, key)) {
      throw new Error("privacy.html: unknown token {{" + key + "}}");
    }
    return values[key];
  });
  return out;
}

// True while the page still has a blank a customer would see. Read by the test
// that keeps ROADMAP honest about it, and nothing else.
export function privacyIncomplete(profile) {
  const priv = (profile && profile.privacy) || {};
  return ["controller", "phone", "email", "address"]
    .some((k) => !String(priv[k] || "").trim());
}
