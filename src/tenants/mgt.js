// src/tenants/mgt.js
//
// v18.0.0 phase 2 — the tenant configuration layer's first (and, today, only)
// tenant. One module per restaurant, selected by `VITE_TENANT` in
// `src/firebase.js`; each exports the same two things and nothing else:
//
//   firebaseConfig — that restaurant's PRODUCTION Firebase project. Never a dev
//                    project: `import.meta.env.DEV` forces the ONE shared DEV
//                    sandbox regardless of which tenant is selected, so a tenant
//                    module has no dev half to get wrong.
//   profile        — who this restaurant is, for the app rather than for
//                    Firebase.
//
// Note on API keys: Firebase web API keys are NOT secrets — they identify a
// project, they don't authorise access; the Database Rules are the security
// layer. Version-controlled tenant modules are therefore correct here, and are
// the same trade `firebase.js` has always made with the two hard-coded configs.

// Verbatim from firebase.js's `prodConfig` (v18.0.0 phase 2 — a move, not an
// edit; the values are unchanged and identify megustastu-bookings).
export const firebaseConfig = {
  apiKey:            "AIzaSyAliFpmNhdZjaix-EecY_0ZN99m0dktL-s",
  authDomain:        "megustastu-bookings.firebaseapp.com",
  databaseURL:       "https://megustastu-bookings-default-rtdb.europe-west1.firebasedatabase.app",
  projectId:         "megustastu-bookings",
  storageBucket:     "megustastu-bookings.firebasestorage.app",
  messagingSenderId: "263618028611",
  appId:             "1:263618028611:web:c851ef6291387a895020f6"
};

export const profile = {
  // Selector. Must match this file's basename — `firebase.js`'s TENANTS map is
  // keyed on the slug, and the boot banner prints it.
  slug: "mgt",

  // The restaurant's name, and the SEED for `settings/general.restaurantName`
  // (useGeneralSettings.js). A stored value always wins; this is what a device
  // shows before the first read lands, and what the login screen — which
  // renders before sign-in, so it physically cannot read the node — falls back
  // to on a device that has never signed in.
  //
  // It lives here rather than as a literal in the hook because that literal was
  // MGT's name in code every tenant would run: a fresh restaurant reading
  // another restaurant's table layout sees a starting point it will edit, but a
  // fresh restaurant reading another restaurant's NAME sees something simply
  // false, on the header, the login screen and every printed day sheet.
  name: "Me Gustas Tú",

  // The restaurant's own locale — for the guest-facing side (WhatsApp replies,
  // any future formatting), NOT the staff UI, which is English.
  // NOTHING READS THIS YET. Recorded now because the profile is the place it
  // belongs; wire it at the point a consumer actually exists, not before.
  locale: "es-ES",

  // One sentence describing the restaurant, for the WhatsApp module's Gemini
  // prompts. Read there through a `TENANT_WA_CONTEXT` env var: this is the
  // value's home, not its delivery route.
  //
  // v18.0.0 phase 5c corrects the reason this comment used to give. It said the
  // backend "cannot import this file", and that is measurably false — nothing in
  // this module touches `import.meta.env` (only the comments mention it), and
  // `node -e "import('./src/tenants/mgt.js')"` resolves it and reads this very
  // field. The env var is a DELIBERATE choice, not a limitation: it matches how
  // every other backend value arrives (`api/_lib/env.js` reads nine of them) and
  // it needs no second variable naming which tenant the function is serving.
  //
  // The cost is that this string and `TENANT_WA_CONTEXT` are one fact in two
  // places, which this repo warns about everywhere. What bounds it: the prompt
  // side FALLS BACK to exactly this string, so the two can only drift after
  // somebody deliberately sets the variable, and a wrong value there degrades a
  // prompt rather than breaking anything. See `waContext()` in
  // `api/_lib/gemini.js`, and ROADMAP for the alternative that was left.
  waContext: "a small restaurant in the Canary Islands"
};
