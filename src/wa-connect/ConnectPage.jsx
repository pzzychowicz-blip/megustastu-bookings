// src/wa-connect/ConnectPage.jsx — the /wa-connect page (v18.9.0).
//
// Links the WhatsApp Business app on the restaurant phone to MGT, so both
// answer the same number ("coexistence"). It runs Meta's Embedded Signup in a
// popup and hands what comes back to api/wa-onboard.js, which does the rest
// and answers step by step.
//
// A separate page, not a screen of the app, because Meta's SDK has to run
// here: this page's CSP (vercel.json) allows connect.facebook.net and
// *.facebook.com, and the app's own CSP stays exactly as it was.
//
// Who may use it is the server's answer, not this page's: the GET to
// /api/wa-onboard is the admin check (assertWaAdmin), and a refusal is shown
// as the server words it.
//
// The flow, and the two things that make it fiddly:
//   1. Connect calls FB.login. Meta answers in TWO ways that can arrive in
//      either order: a `message` event naming the account and the number
//      (FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING), and FB.login's callback
//      with a sign-in code.
//   2. The code lives 30 seconds, so the POST goes the moment both are here.
// Everything one attempt needs is local to that attempt (`start`), so a
// second attempt can never send the first one's code.
//
// What this page decides is in src/lib/wa-connect.js, where a test can ask it:
// it cannot run for real anywhere but an https deployment Meta's app lists.

import { useState, useEffect, useRef } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "../firebase";
import { APP_NAME, T, FW, SP, R, IC } from "../lib/constants";
import { mkBtn, mkSolidBtn, InlineAlert, ALERT_TONES, Reveal } from "../components/atoms";
import { CheckIcon, AlertIcon, CopyIcon } from "../components/Icons";
import { WA_BACKEND_URL } from "../lib/wa-backend";
import { FB_SDK_URL, loginOptions, signupMessage, CONNECT_STEPS, mergeSteps, resultHeadline, retryAnnouncement } from "../lib/wa-connect";

const ONBOARD_URL = WA_BACKEND_URL + "/api/wa-onboard";
// How long a sign-in code waits for Meta's message naming the number. The code
// itself lives 30 seconds, so past this there is nothing worth sending.
const SESSION_WAIT_MS = 15000;
const UNREACHABLE = "Couldn’t reach the server.";

async function onboard(user, method, body) {
  const token = await user.getIdToken();
  const headers = { Authorization: "Bearer " + token };
  if (body) headers["Content-Type"] = "application/json";
  const res = await fetch(ONBOARD_URL, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(function () { return {}; });
  return { status: res.status, data: data || {} };
}

// Meta's SDK, loaded once per page however often React runs the effect that
// asks for it (StrictMode runs it twice in DEV).
let sdkPromise = null;
function loadSdk(appId, version) {
  if (!sdkPromise) {
    sdkPromise = new Promise(function (resolve, reject) {
      window.fbAsyncInit = function () {
        window.FB.init({ appId, autoLogAppEvents: true, xfbml: false, version });
        resolve(window.FB);
      };
      const s = document.createElement("script");
      s.src = FB_SDK_URL;
      s.async = true;
      s.crossOrigin = "anonymous";
      s.onerror = function () { sdkPromise = null; reject(new Error("sdk")); };
      document.body.appendChild(s);
    });
  }
  return sdkPromise;
}

const TEXT = { fontSize: T.lead, color: "var(--text-primary)", lineHeight: 1.45, margin: 0 };
const MUTED = { fontSize: T.body, color: "var(--text-muted)", lineHeight: 1.45, margin: 0 };

function errorText(r) {
  return (r && r.data && r.data.error) || ("The server answered " + (r ? r.status : "nothing") + ".");
}

export function ConnectPage() {
  const [user, setUser] = useState(undefined);       // undefined while Firebase restores the session
  const [cfg, setCfg] = useState(null);              // { appId, configId, graphVersion } | { error }
  const [sdk, setSdk] = useState("loading");         // loading | ready | failed
  const [flow, setFlow] = useState("idle");          // idle | waiting | sending | done
  const [note, setNote] = useState(null);            // { tone, text }
  const [result, setResult] = useState(null);        // the server's answer
  const [retrying, setRetrying] = useState(null);    // the step being tried again
  const [copied, setCopied] = useState(false);
  // What the hidden status region says: the answer when it lands, a retry's
  // outcome, a copy. The visible region beside the button only says what the
  // page is waiting for.
  const [announce, setAnnounce] = useState("");
  const headRef = useRef(null);

  useEffect(function () {
    return onAuthStateChanged(auth, function (u) { setUser(u || null); });
  }, []);

  // The admin check and Meta's two ids, in one request.
  useEffect(function () {
    if (!user) return undefined;
    let off = false;
    onboard(user, "GET").then(function (r) {
      if (!off) setCfg(r.status === 200 ? r.data : { error: errorText(r) });
    }, function () {
      if (!off) setCfg({ error: UNREACHABLE + (import.meta.env.DEV ? " On the dev server, start the WhatsApp harness: npm run wa:backend." : "") });
    });
    return function () { off = true; };
  }, [user]);

  useEffect(function () {
    if (!cfg || !cfg.appId) return undefined;
    let off = false;
    loadSdk(cfg.appId, cfg.graphVersion).then(function () { if (!off) setSdk("ready"); }, function () { if (!off) setSdk("failed"); });
    return function () { off = true; };
  }, [cfg]);

  // Focus the result's heading when the control that held focus has gone: the
  // Connect button is disabled while the answer is awaited, and a Try again
  // that succeeds unmounts itself. Otherwise focus is left where it is.
  useEffect(function () {
    if (!result || !headRef.current) return;
    const el = document.activeElement;
    if (!el || el === document.body) headRef.current.focus();
  }, [result]);

  function send(code, session) {
    const u = auth.currentUser;
    if (!u) { setNote({ tone: "danger", text: "You were signed out, so nothing was connected. Sign in to MGT and start again." }); setFlow("idle"); return; }
    onboard(u, "POST", { code, wabaId: session.wabaId, phoneNumberId: session.phoneNumberId }).then(function (r) {
      if (Array.isArray(r.data.steps)) { setResult(r.data); setFlow("done"); setAnnounce(resultHeadline(r.data.steps)); return; }
      setNote({ tone: "danger", text: errorText(r) });
      setFlow("idle");
    }, function () {
      setNote({ tone: "danger", text: UNREACHABLE + " The sign-in code has expired by now: start again." });
      setFlow("idle");
    });
  }

  function start() {
    if (sdk !== "ready" || !cfg || !cfg.configId || flow === "waiting" || flow === "sending" || retrying) return;
    setNote(null);
    setResult(null);
    setCopied(false);
    setAnnounce("");
    setFlow("waiting");
    let code = null;
    let session = null;
    let over = false;
    let timer = null;
    function end() { over = true; window.removeEventListener("message", onMessage); clearTimeout(timer); }
    function fail(text, tone) {
      if (over) return;
      end();
      setNote({ tone: tone || "danger", text });
      setFlow("idle");
    }
    function trySend() {
      if (over || !code || !session) return;
      end();
      setFlow("sending");
      send(code, session);
    }
    function onMessage(e) {
      const m = signupMessage(e.origin, e.data);
      if (!m) return;
      if (m.kind === "finish") { session = m; trySend(); }
      else if (m.kind === "cancel") fail("Meta’s window was closed before the end" + (m.step ? " (at " + m.step + ")" : "") + ". Nothing was connected.", "warn");
      else fail(m.message);
    }
    window.addEventListener("message", onMessage);
    window.FB.login(function (response) {
      const c = response && response.authResponse && response.authResponse.code;
      if (!c) { fail("Meta’s window closed without connecting a number. Nothing was connected.", "warn"); return; }
      code = c;
      if (!session) timer = setTimeout(function () { fail("Meta gave a sign-in code but did not say which number was connected, so nothing was sent. Start again."); }, SESSION_WAIT_MS);
      trySend();
    }, loginOptions(cfg.configId));
  }

  function retry(id) {
    const u = auth.currentUser;
    if (!u || retrying || !result) return;
    // Connect again is disabled while a retry runs, so `result` is still the
    // answer this retry belongs to when it comes back.
    const base = result;
    setRetrying(id);
    setNote(null);
    setAnnounce("");
    onboard(u, "POST", { retry: id }).then(function (r) {
      setRetrying(null);
      if (Array.isArray(r.data.steps)) {
        const steps = mergeSteps(base.steps, r.data.steps);
        setResult(Object.assign({}, base, { steps }));
        setAnnounce(retryAnnouncement(id, r.data.steps, steps));
      } else setNote({ tone: "danger", text: errorText(r) });
    }, function () { setRetrying(null); setNote({ tone: "danger", text: UNREACHABLE }); });
  }

  function copyId() {
    if (!result || !navigator.clipboard) return;
    navigator.clipboard.writeText(result.phoneNumberId).then(function () { setCopied(true); setAnnounce("Number id copied."); }, function () { setCopied(false); });
  }

  // ── What is shown ─────────────────────────────────────────────────────────
  let body;
  if (user === undefined) body = <p style={MUTED}>Checking who is signed in&hellip;</p>;
  else if (user === null) {
    body = (
      <>
        <p style={TEXT}>Sign in to {APP_NAME} on this device first, as an admin, then open this page again.</p>
        <div><a className="mgt-hover-scale mgt-press" href="/" style={mkBtn({ boxSizing: "border-box", textDecoration: "none", display: "inline-flex", alignItems: "center", justifyContent: "center" })}>Open {APP_NAME}</a></div>
      </>
    );
  } else if (!cfg) body = <p style={MUTED}>Checking your access&hellip;</p>;
  else if (cfg.error) body = <InlineAlert>{cfg.error}</InlineAlert>;
  else body = (
    <>
      <p style={TEXT}>
        This links {APP_NAME} to the WhatsApp Business app on the restaurant phone, so both answer the same number: staff reply from either, and each sees what the other sent.
      </p>
      <div>
        <p style={{ ...TEXT, fontWeight: FW.semi }}>Before you start</p>
        <ol style={{ ...MUTED, paddingLeft: SP.pane, marginTop: SP.tight }}>
          <li>On the restaurant phone, update the WhatsApp Business app.</li>
          <li>Turn its greeting message off (Business tools &rarr; Greeting message). {APP_NAME} sends its own to new customers, and two would be one too many.</li>
          <li>Keep the phone at hand: Meta&rsquo;s window shows a code to scan with it.</li>
        </ol>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: SP.wide }}>
        <button type="button" className="mgt-hover-scale mgt-press" onClick={start}
          disabled={sdk !== "ready" || flow === "waiting" || flow === "sending" || !!retrying}
          style={mkSolidBtn("var(--accent)", sdk === "ready" && flow !== "waiting" && flow !== "sending" && !retrying ? null : { opacity: 0.55, cursor: "default" })}>
          {result ? "Connect again" : "Connect the Business app"}
        </button>
      </div>
      <div role="status" style={MUTED}>
        {sdk === "loading" ? "Loading Meta’s sign-in…"
          : sdk === "failed" ? "Meta’s sign-in did not load. Check the connection and reload this page."
            : flow === "waiting" ? "Finish the steps in Meta’s window. Keep this tab open."
              : flow === "sending" ? "Connecting…"
                : ""}
      </div>
      <div className="mgt-sr-only" role="status">{announce}</div>
      {/* The house shape for a form's refusal (WalkinForm, ReplyComposer): the
          alert always mounted, the note easing in and out inside it, so what
          is under it slides rather than jumps. `speed="move"`: it arrives
          after Meta's window, or the server, has answered, not under the
          press (/find-animation-opportunities, v18.9.0). */}
      <div role="alert">
        <Reveal show={!!note} speed="move">
          {note ? (
            <InlineAlert tone={ALERT_TONES[note.tone].tone} tint={ALERT_TONES[note.tone].tint}>{note.text}</InlineAlert>
          ) : null}
        </Reveal>
      </div>
      {result ? <ConnectResult result={result} retrying={retrying} onRetry={retry} copied={copied} onCopy={copyId} headRef={headRef} /> : null}
    </>
  );

  return (
    <div style={{ background: "var(--bg-app)", minHeight: "100dvh", padding: SP.pane, boxSizing: "border-box", fontFamily: "var(--font-app)", color: "var(--text-primary)", display: "flex", justifyContent: "center" }}>
      <main style={{
        width: "100%", maxWidth: 560, alignSelf: "flex-start",
        background: "var(--bg-sheet)", border: "1px solid var(--border-sheet)", borderRadius: R.auth,
        boxShadow: "var(--shadow-sheet)", padding: SP.section, boxSizing: "border-box",
        display: "flex", flexDirection: "column", gap: SP.gutter, textAlign: "left",
      }}>
        <header style={{ display: "flex", alignItems: "center", gap: SP.wide }}>
          <img src="/icon.svg" alt="" aria-hidden="true" width={44} height={44} style={{ display: "block", flexShrink: 0 }} />
          <div style={{ minWidth: 0 }}>
            <h1 style={{ fontSize: T.display, fontWeight: FW.bold, margin: 0 }}>Connect WhatsApp</h1>
            <div style={{ fontSize: T.lead, color: "var(--text-muted)" }}>{APP_NAME}</div>
          </div>
        </header>
        {body}
      </main>
    </div>
  );
}

// The server's answer: each step, a Try again on a step that may be retried,
// and the number id the environment needs.
function ConnectResult({ result, retrying, onRetry, copied, onCopy, headRef }) {
  const steps = result.steps || [];
  const byId = {};
  steps.forEach(function (s) { byId[s.id] = s; });
  const linked = !!(byId.link && byId.link.ok);
  return (
    <>
      <p ref={headRef} tabIndex={-1} style={{ ...TEXT, fontWeight: FW.semi }}>{resultHeadline(steps)}</p>
      <ul role="list" style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: SP.base }}>
        {CONNECT_STEPS.filter(function (d) { return byId[d.id]; }).map(function (d) {
          const s = byId[d.id];
          const tone = s.ok ? "var(--success-text)" : s.skipped ? "var(--warn-text)" : "var(--danger-text)";
          return (
            <li key={d.id} style={{ display: "flex", alignItems: "flex-start", gap: SP.base }}>
              <span aria-hidden="true" style={{ color: tone, display: "inline-flex", paddingTop: SP.hair, flexShrink: 0 }}>
                {s.ok ? <CheckIcon size={IC.control} /> : <AlertIcon size={IC.control} />}
              </span>
              <div style={{ flex: "1 1 auto", minWidth: 0 }}>
                <div style={TEXT}>{d.label}{s.ok ? "" : s.skipped ? " — skipped" : " — failed"}</div>
                {s.error ? <div style={MUTED}>{s.error}</div> : null}
              </div>
              {!s.ok && d.retry && linked ? (
                <button type="button" className="mgt-hover-scale mgt-press" onClick={function () { onRetry(d.id); }}
                  disabled={!!retrying} aria-label={"Try again: " + d.label}
                  style={mkBtn(retrying ? { opacity: 0.55, cursor: "default", flexShrink: 0 } : { flexShrink: 0 })}>
                  {retrying === d.id ? "Trying…" : "Try again"}
                </button>
              ) : null}
            </li>
          );
        })}
      </ul>
      {linked && result.phoneNumberId ? (
        <div style={{ display: "flex", flexDirection: "column", gap: SP.base }}>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: SP.base }}>
            <span style={MUTED}>Number id</span>
            <code style={{ fontSize: T.lead, fontWeight: FW.semi }}>{result.phoneNumberId}</code>
            <button type="button" className="mgt-hover-scale mgt-press" onClick={onCopy} style={mkBtn({ display: "inline-flex", alignItems: "center", gap: SP.snug })}>
              <CopyIcon size={IC.control} />{copied ? "Copied" : "Copy"}
            </button>
          </div>
          {result.envNumber !== "same" ? (
            <InlineAlert tone={ALERT_TONES.warn.tone} tint={ALERT_TONES.warn.tint}>
              Set META_PHONE_NUMBER_ID to this id in Vercel (this restaurant&rsquo;s project &rarr; Settings &rarr; Environment Variables) and redeploy. Until then, replies from {APP_NAME} go out from the number it names now.
            </InlineAlert>
          ) : null}
        </div>
      ) : null}
      <div><a className="mgt-hover-scale mgt-press" href="/" style={mkBtn({ boxSizing: "border-box", textDecoration: "none", display: "inline-flex", alignItems: "center", justifyContent: "center" })}>Back to {APP_NAME}</a></div>
    </>
  );
}
