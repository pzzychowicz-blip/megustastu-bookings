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
// Behaviour, output markup, and all inline styles are byte-identical to the
// original.

import { useState } from "react";
import { signInWithEmailAndPassword } from "firebase/auth";
import { auth } from "../firebase";
import { S } from "../lib/constants";
import { mkInp, mkBtn } from "./atoms";

export function LoginScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

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
      padding: 20,
      fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'SF Pro Text', 'Helvetica Neue', system-ui, sans-serif",
      color: S.text
    }}>
      <div style={{
        background: "var(--bg-sheet)",
        backdropFilter: "blur(40px)", WebkitBackdropFilter: "blur(40px)",
        borderRadius: 20,
        border: "1px solid var(--border-sheet)",
        padding: "32px 28px",
        width: "100%", maxWidth: 360,
        boxShadow: "var(--shadow-sheet)"
      }}>
        <div style={{ fontSize: 22, fontWeight: 700, color: S.text, marginBottom: 4 }}>
          Me Gustas T&uacute;
        </div>
        <div style={{ fontSize: 14, color: S.muted, marginBottom: 24 }}>
          Staff login
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={handleKey}
            placeholder="Email"
            className="mgt-hover-scale"
            style={mkInp()}
          />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={handleKey}
            placeholder="Password"
            className="mgt-hover-scale"
            style={mkInp()}
          />
          {error ? (
            <div style={{
              color: "var(--danger-text)", fontSize: 13,
              padding: "8px 12px",
              background: "var(--danger-bg)",
              borderRadius: 12,
              border: "2px solid var(--danger-border)"
            }}>
              {error}
            </div>
          ) : null}
          <button
            onClick={handleLogin}
            disabled={loading}
            className="mgt-hover-scale"
            style={{
              ...mkBtn({ fontSize: 15, minHeight: 44, padding: "12px" }),
              background: "rgba(0,122,255,0.75)",
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
