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
  // prompts (plan §5c). Read there through a `TENANT_WA_CONTEXT` env var,
  // because that backend runs server-side and cannot import this file — this is
  // the value's home, not its delivery route. Unused until phase 5.
  waContext: "a small restaurant in the Canary Islands"
};
