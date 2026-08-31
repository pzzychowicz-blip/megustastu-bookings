// src/components/ErrorBoundary.jsx
//
// v17.16.0 — the app's only error boundary, and until now there was none at all.
// CT-2A-02 (v17.15.7 crash test, P1): a search for `componentDidCatch` /
// `getDerivedStateFromError` / `ErrorBoundary` / `onerror` across `src/` matched
// nothing, and `main.jsx` rendered `<App/>` bare. React's contract for an
// uncaught render error is to unmount the WHOLE tree, so any throw in render or
// in one of the app's ~30 effects left `#root` empty — a white screen on a
// tablet, mid-service, with no way back but a reload nobody is prompted to do.
//
// WHY THIS WAS THE AMPLIFIER. On its own an error boundary fixes no bug. What it
// does is convert every OTHER throw in the crash-test register from an outage
// into a recoverable error state, and those throws are not hypothetical — seven
// reachable sites were found without looking hard: `dirtyDates → verifyClean →
// toMins` (an effect that runs on every snapshot), `daySummary → toMins`,
// `findClashes → toMins`, `describeBooking(null)`, `bookEnd({})`,
// `comboCap(null)`, `clashRowId(null)`. Several are reachable from a single
// malformed booking, which CT-2A-03 shows the server will happily store.
//
// WHY index.html's BOOT WATCHDOG DOES NOT COVER IT. That watchdog fires once, at
// T+10s, gated on `root.children.length === 0`. It answers "did the app never
// mount", which is a different question from "did the app mount and then throw"
// — by the time a boundary is needed the watchdog has long since decided the
// boot was fine and stood down.
//
// TWO RECOVERIES, because they fail differently:
//
//   Try again  — resets `hasError` and re-renders the same tree. This is the
//                right first move for a transient cause (a bad snapshot that has
//                since been replaced, a one-off race) because it keeps the
//                session: the view, the date, the scroll, the signed-in state.
//                A deterministic cause simply throws again and lands back here,
//                which costs nothing and tells the user something true.
//   Reload app — a full `location.reload()`. Rebuilds everything from the
//                server, and is what to reach for when Try again bounces.
//
// Neither can fix a malformed booking sitting in the database, and the copy says
// so rather than sending someone round the same loop a third time.
//
// DEPENDENCIES ARE DELIBERATELY THIN. This file imports token scales and the two
// button STYLE factories — `mkBtn`/`mkSolidBtn` return plain objects and cannot
// themselves throw — and no component. A surface that renders only when the
// component tree has already failed should not be built out of that tree.
import { Component } from "react";
import { S, R, T, FW, SP, H } from "../lib/constants";
import { mkBtn, mkSolidBtn } from "./atoms";

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, message: "" };
    // A callback ref rather than a `role="alert"` container: a live region that
    // is added to the DOM already holding its message announces NOTHING (the
    // repo's own rule — see CLAUDE.md's live-region gotcha), and this surface
    // is created holding its message by definition. Moving focus is what
    // actually tells a screen-reader user the page has changed under them.
    this.focusPanel = (node) => { if (node) node.focus(); };
    this.retry = () => this.setState({ hasError: false, message: "" });
    this.reload = () => { window.location.reload(); };
  }

  // A `throw` can be handed anything, not only an Error — so this takes the
  // `.message` when the thrown thing has one, the value itself when it does
  // not, and an EMPTY STRING when neither says anything. That last case is why
  // this is not a one-liner: `String(null)` is the four characters "null", and
  // printing "· null" under the buttons would be the app volunteering a word
  // that means nothing to the person reading it. Render nothing rather than
  // noise.
  //
  // The test on `message` is `typeof === "string"`, NOT truthiness. `new Error()`
  // has a message of "" — falsy — so a truthy check falls through to the value
  // and `String(new Error())` renders the bare word "Error", which is the exact
  // noise this branch exists to prevent. Caught by tests/error-boundary.test.js
  // rather than in review; a message-less throw is not a case anyone pictures.
  static getDerivedStateFromError(error) {
    const raw = (error && typeof error.message === "string") ? error.message : error;
    return {
      hasError: true,
      message: (raw === null || raw === undefined || raw === "") ? "" : String(raw),
    };
  }

  componentDidCatch(error, info) {
    // Kept, and not only for tidiness: the v17.10.2 render-loop was found by
    // READING THE CONSOLE, on an app that looked and behaved perfectly. The
    // component stack is the part that says WHICH subtree threw, and it exists
    // nowhere else once the tree is gone.
    console.error("[MGT] render error caught by the boundary:", error, info && info.componentStack);
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    // `__MGT_BUILD__` rather than importing the signature: the version lives in
    // `__APP_SIGNATURE__` and NOWHERE else (App.jsx's own header rule), and a
    // second import would be a second place for it to be read from.
    const build = (typeof window !== "undefined" && window.__MGT_BUILD__) || null;

    return (
      <div style={{
        minHeight: "100dvh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: SP.section,
      }}>
        <div
          ref={this.focusPanel}
          tabIndex={-1}
          style={{
            maxWidth: 420 /* @canvas */,
            width: "100%",
            background: S.card,
            border: "1px solid " + S.border,
            borderRadius: R.card,
            padding: SP.section,
            boxShadow: "var(--shadow-card)",
            outline: "none",
          }}
        >
          <h1 style={{
            margin: 0,
            marginBottom: SP.wide,
            fontSize: T.title,
            fontWeight: FW.semi,
            color: S.text,
          }}>MGT Bookings hit an error</h1>

          <p style={{
            margin: 0,
            marginBottom: SP.wide,
            fontSize: T.lead,
            lineHeight: 1.5 /* @canvas */,
            color: "var(--text-secondary)",
          }}>
            The screen stopped drawing. Bookings already saved are on the server
            and this has not changed them.
          </p>

          <p style={{
            margin: 0,
            marginBottom: SP.section,
            fontSize: T.body,
            lineHeight: 1.5 /* @canvas */,
            color: S.muted,
          }}>
            Try again first — it keeps you on the same day. If the error comes
            straight back, reload. If it survives a reload, the day probably
            holds a booking the app cannot read, and it will need fixing in the
            data rather than here.
          </p>

          <div style={{ display: "flex", gap: SP.mid, flexWrap: "wrap" }}>
            <button type="button" onClick={this.retry} style={mkSolidBtn(S.accent)}>
              Try again
            </button>
            <button type="button" onClick={this.reload} style={mkBtn({ minHeight: H.touch })}>
              Reload app
            </button>
          </div>

          <p style={{
            margin: 0,
            marginTop: SP.section,
            paddingTop: SP.wide,
            borderTop: "1px solid " + S.border,
            fontSize: T.small,
            color: S.muted,
            wordBreak: "break-word",
          }}>
            {build ? build.app + " " + build.version : "MGT Bookings"}
            {this.state.message ? " · " + this.state.message : ""}
          </p>
        </div>
      </div>
    );
  }
}
