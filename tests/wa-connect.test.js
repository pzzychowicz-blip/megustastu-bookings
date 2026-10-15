// tests/wa-connect.test.js — v18.9.0 phase 8: connecting the WhatsApp Business
// app (the /wa-connect page, its decisions in src/lib/wa-connect.js) and what
// Settings → WhatsApp says about the connection (connectionLines).
//
// The page itself cannot run here, or anywhere but an https deployment that
// Meta's app lists as an allowed domain: Meta's popup is the flow. So what it
// DECIDES is pure and asked here, and the few lines that wire those decisions
// in are pinned in the source. The server half is tests/api-handlers.test.js.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { stripComments } from "../scripts/strip-comments.mjs";
import { loginOptions, signupMessage, CONNECT_STEPS, mergeSteps, resultHeadline, retryAnnouncement, FB_SDK_URL } from "../src/lib/wa-connect.js";
import { connectionLines } from "../src/lib/wa-coexist.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => stripComments(readFileSync(join(ROOT, p), "utf8")).join("\n");

const FB = "https://www.facebook.com";
const finish = (data) => JSON.stringify({ type: "WA_EMBEDDED_SIGNUP", event: "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING", data });

describe("FB.login's options", () => {
  it("ask for a code, for a Business app (coexistence) signup", () => {
    expect(loginOptions("cfg-9")).toEqual({
      config_id: "cfg-9",
      response_type: "code",
      override_default_response_type: true,
      extras: { setup: {}, featureType: "whatsapp_business_app_onboarding", sessionInfoVersion: "3" },
    });
  });
  it("load Meta's SDK from the one host the page's CSP allows", () => {
    expect(new URL(FB_SDK_URL).origin).toBe("https://connect.facebook.net");
  });
});

describe("signupMessage — which window message is Embedded Signup's", () => {
  it("reads the finish: the account and the number", () => {
    expect(signupMessage(FB, finish({ waba_id: "102030405060", phone_number_id: "908070605040" })))
      .toEqual({ kind: "finish", wabaId: "102030405060", phoneNumberId: "908070605040" });
    // Posted as an object too, and with numeric ids.
    expect(signupMessage("https://web.facebook.com", { type: "WA_EMBEDDED_SIGNUP", event: "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING", data: { waba_id: 102030405060, phone_number_id: 908070605040 } }))
      .toEqual({ kind: "finish", wabaId: "102030405060", phoneNumberId: "908070605040" });
  });
  it("reads nothing from any other page: another host, a look-alike, plain http, a broken origin", () => {
    const msg = finish({ waba_id: "102030405060", phone_number_id: "908070605040" });
    for (const origin of ["https://evil.example", "https://facebook.com.evil.example", "https://notfacebook.com", "http://www.facebook.com", "nonsense", ""]) {
      expect(signupMessage(origin, msg)).toBe(null);
    }
  });
  it("reads nothing that is not Embedded Signup's", () => {
    expect(signupMessage(FB, "not json")).toBe(null);
    expect(signupMessage(FB, JSON.stringify({ type: "SOMETHING_ELSE", event: "FINISH" }))).toBe(null);
    expect(signupMessage(FB, null)).toBe(null);
    expect(signupMessage(FB, JSON.stringify({ type: "WA_EMBEDDED_SIGNUP", event: "PROGRESS" }))).toBe(null);
  });
  it("refuses a finish whose ids are not Meta's, which the server would refuse anyway", () => {
    expect(signupMessage(FB, finish({ waba_id: "12/../x", phone_number_id: "908070605040" })).kind).toBe("error");
    expect(signupMessage(FB, finish({ phone_number_id: "908070605040" })).kind).toBe("error");
  });
  it("tells a cancel from an error", () => {
    expect(signupMessage(FB, JSON.stringify({ type: "WA_EMBEDDED_SIGNUP", event: "CANCEL", data: { current_step: "PHONE_NUMBER_SETUP" } })))
      .toEqual({ kind: "cancel", step: "PHONE_NUMBER_SETUP" });
    expect(signupMessage(FB, JSON.stringify({ type: "WA_EMBEDDED_SIGNUP", event: "CANCEL", data: { error_message: "Session expired" } })))
      .toEqual({ kind: "error", message: "Session expired" });
    expect(signupMessage(FB, JSON.stringify({ type: "WA_EMBEDDED_SIGNUP", event: "ERROR", data: {} })))
      .toEqual({ kind: "error", message: "Meta reported an error." });
  });
  it("refuses a signup that would take the number OFF the Business app: nothing here registers one", () => {
    for (const event of ["FINISH", "FINISH_ONLY_WABA"]) {
      const m = signupMessage(FB, JSON.stringify({ type: "WA_EMBEDDED_SIGNUP", event, data: { waba_id: "102030405060", phone_number_id: "908070605040" } }));
      expect(m.kind).toBe("error");
      expect(m.message).toContain(event);
    }
  });
});

describe("the steps the page shows", () => {
  const server = read("api/wa-onboard.js");
  it("are the server's steps, in its order, and offer Try again exactly where the server takes a retry", () => {
    const retryable = /const RETRYABLE = \[([^\]]*)\]/.exec(server)[1].match(/"([a-z]+)"/g).map((s) => s.slice(1, -1));
    expect(CONNECT_STEPS.filter((s) => s.retry).map((s) => s.id)).toEqual(retryable);
    // The order the server answers in, which tests/api-handlers.test.js pins
    // against the handler's own response.
    expect(CONNECT_STEPS.map((s) => s.id)).toEqual(["exchange", "link", "subscribe", "contacts", "history", "phone"]);
  });
  it("a retry replaces its own step and keeps the others", () => {
    const steps = [{ id: "link", ok: true }, { id: "contacts", ok: false, error: "x" }, { id: "history", ok: true }];
    expect(mergeSteps(steps, [{ id: "contacts", ok: true }])).toEqual([{ id: "link", ok: true }, { id: "contacts", ok: true }, { id: "history", ok: true }]);
    expect(mergeSteps(steps, [])).toEqual(steps);
  });
});

describe("what the page says about the answer", () => {
  const ok = (id) => ({ id, ok: true });
  const bad = (id) => ({ id, ok: false, error: "x" });
  it("the headline: connected only when every step is, linked when the link landed", () => {
    expect(resultHeadline(["exchange", "link", "subscribe"].map(ok))).toBe("Connected.");
    expect(resultHeadline([ok("exchange"), ok("link"), bad("contacts")])).toBe("Connected, with a step to finish.");
    expect(resultHeadline([ok("exchange"), bad("link")])).toBe("Not connected.");
    expect(resultHeadline([bad("exchange")])).toBe("Not connected.");
    expect(resultHeadline([])).toBe("Not connected.");
    expect(resultHeadline(undefined)).toBe("Not connected.");
  });
  it("a retry says how its step went, then where everything stands", () => {
    const merged = [ok("exchange"), ok("link"), ok("contacts")];
    expect(retryAnnouncement("contacts", [ok("contacts")], merged)).toBe("The phone's contacts asked for: done. Connected.");
    const still = [ok("exchange"), ok("link"), bad("contacts"), bad("history")];
    expect(retryAnnouncement("history", [bad("history")], still)).toBe("The phone's chat history asked for: failed again. Connected, with a step to finish.");
    // An answer that does not mention the step is not a success.
    expect(retryAnnouncement("phone", [], still)).toMatch(/: failed again\. /);
  });
});

describe("the page wires those decisions in", () => {
  const page = read("src/wa-connect/ConnectPage.jsx");
  it("calls FB.login with loginOptions and reads messages through signupMessage only", () => {
    expect(page).toContain("window.FB.login(");
    expect(page).toContain("loginOptions(cfg.configId)");
    expect(page).toContain("signupMessage(e.origin, e.data)");
    expect(page.match(/addEventListener\("message"/g)).toHaveLength(1);
  });
  it("posts the code and both ids, and asks the server who may (no role check of its own)", () => {
    expect(page).toContain('onboard(u, "POST", { code, wabaId: session.wabaId, phoneNumberId: session.phoneNumberId })');
    expect(page).toContain('onboard(user, "GET")');
    expect(page).not.toMatch(/isAdminEntry|roles\//);
  });
  it("announces the answer in a hidden status region, and draws its heading by the same rule", () => {
    expect(page).toContain('<div className="mgt-sr-only" role="status">{announce}</div>');
    expect(page).toContain("setAnnounce(resultHeadline(r.data.steps))");
    expect(page).toContain("setAnnounce(retryAnnouncement(id, r.data.steps, steps))");
    expect(page).toContain("<p ref={headRef} tabIndex={-1} style={{ ...TEXT, fontWeight: FW.semi }}>{resultHeadline(steps)}</p>");
    // A retry's answer is merged into the result it belongs to, so a new
    // attempt cannot start while one runs.
    expect(page).toContain('disabled={sdk !== "ready" || flow === "waiting" || flow === "sending" || !!retrying}');
  });
  it("imports nothing of the app beyond what it draws with (src/firebase.js keeps the DEV/PROD split)", () => {
    const imports = [...page.matchAll(/^import [^;]*from "([^"]+)"/gm)].map((m) => m[1]);
    expect(imports).toEqual(["react", "firebase/auth", "../firebase", "../lib/constants", "../components/atoms", "../components/Icons", "../lib/wa-backend", "../lib/wa-connect"]);
  });
});

describe("connectionLines — Settings → WhatsApp's words for waLink", () => {
  const TODAY = "2026-10-15";
  const at = (iso) => new Date(iso + "T12:00:00").getTime();

  it("never connected", () => {
    expect(connectionLines(null, TODAY)).toEqual({ state: "none", lines: ["Not connected. MGT is not linked to the WhatsApp Business app on the restaurant phone."] });
    expect(connectionLines({ status: "connected" }, TODAY).state).toBe("none");
  });

  it("connected, with every sync recorded", () => {
    const r = connectionLines({
      status: "connected", phoneNumberId: "908070605040", connectedAt: at("2026-10-14"), connectedBy: "ana@example.com",
      contacts: { requestedAt: at("2026-10-14"), firstAt: at("2026-10-14") },
      history: { requestedAt: at("2026-10-14"), progress: 100, doneAt: at("2026-10-15") },
      phone: { isOnBizApp: true, platformType: "CLOUD_API" },
    }, TODAY);
    expect(r).toEqual({ state: "connected", lines: [
      "Connected on Wed 14.10 by ana@example.com.",
      "Number id 908070605040.",
      "The phone's contacts arrived on Wed 14.10.",
      "Chat history imported on Thu 15.10.",
    ] });
  });

  it("says what is still on its way, and what was never asked for", () => {
    const r = connectionLines({ status: "connected", phoneNumberId: "908070605040", contacts: { requestedAt: at("2026-10-14") }, history: { progress: 42.4 } }, TODAY);
    expect(r.lines.slice(2)).toEqual([
      "The phone's contacts were asked for on Wed 14.10; none have arrived yet.",
      "Chat history 42% imported.",
    ]);
    const bare = connectionLines({ status: "connected", phoneNumberId: "908070605040" }, TODAY);
    expect(bare.lines.slice(2)).toEqual(["The phone's contacts have not been asked for.", "Chat history has not been asked for."]);
    expect(connectionLines({ phoneNumberId: "1", history: { requestedAt: at("2026-10-14"), progress: null } }, TODAY).lines[3])
      .toBe("Chat history was asked for on Wed 14.10; none has arrived yet.");
  });

  it("a declined history, and a number Meta says is not on the Business app", () => {
    const r = connectionLines({ status: "connected", phoneNumberId: "1", history: { declined: true, progress: 0 }, phone: { isOnBizApp: false, platformType: "CLOUD_API" } }, TODAY);
    expect(r.lines).toContain("The phone declined to share its chat history.");
    expect(r.lines).toContain("Meta says this number is not on the WhatsApp Business app (CLOUD_API).");
  });

  it("disconnected: the reason leads, and the same event is not said twice", () => {
    const ev = { event: "PARTNER_REMOVED", reason: "USER_REQUESTED", at: at("2026-10-15") };
    const r = connectionLines({ status: "disconnected", phoneNumberId: "1", disconnect: ev, lastEvent: ev }, TODAY);
    expect(r.state).toBe("disconnected");
    expect(r.lines[0]).toMatch(/^WhatsApp is disconnected from MGT: the connection was removed/);
    expect(r.lines.filter((l) => l.startsWith("Last event"))).toEqual([]);
    const later = connectionLines({ status: "connected", phoneNumberId: "1", lastEvent: { event: "ACCOUNT_UPDATE", at: at("2026-10-15") } }, TODAY);
    expect(later.lines).toContain("Last event from Meta: account update on Thu 15.10.");
  });
});

describe("Settings → WhatsApp shows the connection to admins only", () => {
  const settings = read("src/components/Settings.jsx");
  it("renders the section behind isAdmin, from the waLink App hands down", () => {
    expect(settings).toContain("{isAdmin ? <BusinessAppSection waLink={waLink} /> : null}");
    expect(settings).toContain("content = <WhatsAppTabContent waSettings={waSettings} onSaveWaSettings={onSaveWaSettings} isAdmin={isAdmin} waLink={waLink} />;");
    expect(read("src/App.jsx")).toContain("waLink={wa.waLink} /></Suspense>");
  });
  it("links to the page, and warns only on a definite mismatch from wa-config", () => {
    expect(settings).toContain('href="/wa-connect"');
    expect(settings).toContain("status.phoneNumberIdMatches === false");
  });
});
