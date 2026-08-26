// src/components/LoginScreen.jsx
// The unauthenticated entry screen. Single-card centered layout with email +
// password inputs and a sign-in button. Maps Firebase auth error codes to
// user-friendly messages (invalid creds, too many attempts, fallback) — the
// raw error codes are never shown to staff because they're confusing.
//
// Mounted by the top-level `App` component when no user is signed in.
// Self-contained: owns its own input state, calls `signInWithEmailAndPassword`
// directly, no props.
//
// Phase B5 (v15-refactor): extracted from App.jsx and converted RC() → JSX.
//
// v17.9.0: the title is no longer a literal — it is the restaurant's configured
// name, read from a localStorage mirror because this screen renders before auth
// and `settings/general` is behind `auth != null`. It is also the app's actual
// icon file rather than text alone. Everything else is still the v15 markup.

import { useState } from "react";
import { signInWithEmailAndPassword } from "firebase/auth";
import { auth } from "../firebase";
import { S, R, T, FW } from "../lib/constants";
import { mkInp, mkBtn, InlineAlert, Reveal } from "./atoms";
import { readCachedRestaurantName } from "../hooks/useGeneralSettings";

export function LoginScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  // Lazy initializer: read once per MOUNT, not per render — and per mount is
  // the right granularity, because a sign-out remounts this screen and should
  // pick up a rename that landed during the previous session.
  const [restaurantName] = useState(readCachedRestaurantName);

  function handleLogin() {
    if (!email || !password) {
      setError("Please enter email and password.");
      return;
    }
    setLoading(true);
    setError("");
    signInWithEmailAndPassword(auth, email, password)
      .then(() => { setLoading(false); })
      .catch((err) => {
        setLoading(false);
        // Firebase emits a handful of credential-related error codes that all
        // mean the same thing to a human ("login didn't work"). Lump them.
        if (err.code === "auth/invalid-credential"
          || err.code === "auth/wrong-password"
          || err.code === "auth/user-not-found") {
          setError("Invalid email or password.");
        } else if (err.code === "auth/too-many-requests") {
          setError("Too many attempts. Please wait a moment.");
        } else {
          setError("Login failed. Please try again.");
        }
      });
  }

  function handleKey(e) {
    if (e.key === "Enter") handleLogin();
  }

  return (
    <div style={{
      background: "var(--bg-app)",
      minHeight: "100dvh",
      display: "flex", alignItems: "center", justifyContent: "center",
      padding: 18,
      fontFamily: "var(--font-app)", // v16.0.0: one app font — token in index.html
      color: S.text
    }}>
      <div style={{
        background: "var(--bg-sheet)",
        backdropFilter: "blur(40px)", WebkitBackdropFilter: "blur(40px)",
        borderRadius: R.auth,
        border: "1px solid var(--border-sheet)",
        padding: "32px 24px",
        width: "100%", maxWidth: 360,
        boxShadow: "var(--shadow-sheet)"
      }}>
        {/* v17.9.0 (Patryk): the app mark, and the restaurant's OWN name.
            The name was the "Me Gustas Tú" literal this whole settings node was
            created to remove in v17.0.0 — the one place it survived, because
            this screen renders before sign-in and cannot read Firebase. It
            comes from the localStorage mirror instead (see
            readCachedRestaurantName), so it is right on any device that has
            signed in once and falls back to the seed on one that never has.

            The logo is `/icon.svg` — the SAME file the PWA and favicon use, not
            a re-drawn copy, so it cannot drift from the icon family that
            scripts/gen-icons.py exists to keep in step. It carries its own
            rounded tile, hence no borderRadius here, and no dark-mode variant:
            a logo has fixed brand colours and this is the mark already sitting
            on the home screen of every device that opens this page. */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 24 }}>
          <img
            src="/icon.svg" alt="" aria-hidden="true"
            width={44} height={44}
            style={{ display: "block", flexShrink: 0 }}
          />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: T.display, fontWeight: FW.bold, color: S.text }}>
              {restaurantName}
            </div>
            <div style={{ fontSize: T.lead, color: S.muted }}>
              Staff login
            </div>
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <input
            type="email"
            aria-label="Email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={handleKey}
            placeholder="Email"
            className="mgt-hover-scale"
            style={mkInp()}
          />
          <input
            type="password"
            aria-label="Password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={handleKey}
            placeholder="Password"
            className="mgt-hover-scale"
            style={mkInp()}
          />
          {/* v17.15.2 (follow-up): the tenth banned triple, and the one a new
              member of staff meets FIRST. It is a form refusing to submit, which
              is exactly what InlineAlert is — the `role="alert"` wrapper stays
              mounted with only the child conditional, per the live-region rule,
              and the Reveal gives it the enter/exit it never had. */}
          <div role="alert"><Reveal show={!!error}>{error ? (
            <InlineAlert>{error}</InlineAlert>
          ) : null}</Reveal></div>
          <button
            onClick={handleLogin}
            disabled={loading}
            className="mgt-hover-scale"
            style={{
              ...mkBtn({ fontSize: T.lead, minHeight: 44, padding: "12px" }),
              background: "var(--accent)",
              opacity: loading ? 0.7 : 1,
              cursor: loading ? "wait" : "pointer"
            }}
          >
            {loading ? "Logging in..." : "Log in"}
          </button>
        </div>
      </div>
    </div>
  );
}
