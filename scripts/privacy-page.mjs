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
// name, who legally runs it) are tokens in the source and
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
export const PRIVACY_TOKENS = ["restaurant", "controller", "updated"];

export function renderPrivacy(template, profile) {
  const p = profile || {};
  const priv = p.privacy || {};
  const values = {
    restaurant: val(p.name),
    controller: val(priv.controller),
    updated: val(priv.updated),
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
  return !String(priv.controller || "").trim();
}
