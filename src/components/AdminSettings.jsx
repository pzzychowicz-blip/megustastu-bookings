// src/components/AdminSettings.jsx
//
// v18.0.0 phase 3 — the Admin tab: people, levels, and the enforcement switch.
// The capability grid opens from here as its own modal (RolesModal, below).
//
// ── ADMIN-ONLY AT BOTH LAYERS, AND THIS IS THE THIRD ONE ────────────────────
// The tab is filtered out of `SETTINGS_TABS` for anyone without
// `settingsAdmin` (SettingsChrome's `visibleTabs`), and the rules refuse the
// writes regardless of what the UI shows. `RefusalPanel` is the layer between
// them: if this component is ever rendered without the capability — a stale
// render, a filter someone refactors, a frame before the reset effect runs —
// it shows a refusal rather than a form whose every control the server will
// reject. Hiding a tab is a convenience; the rule is the boundary.
//
// ── WHAT IS ENFORCED AND WHAT IS NOT IS PRINTED ON THE SCREEN ───────────────
// Seven capabilities are refused by the database too (`RULE_ENFORCED`); the
// other eleven are UI gates that cover the real threat — a member of staff tapping
// the wrong thing — and are not security boundaries. A permission model that
// claims more than it enforces is exactly the falsely-reassuring documentation
// this repo's crash tests hunt for, so the panel says which is which instead of
// letting the reader assume.

import { useState, useRef, useEffect } from "react";
import { R, T, FW, SP, H } from "../lib/constants";
import { Section, Collapsible, Toggle, InlineAlert, ALERT_TONES, OutlineChip, Overlay, ModalTitle, Reveal, AutoHeight, mkInp, mkBtn, mkSolidBtn, mkSel } from "./atoms";
import { CAPABILITIES, CAP_GROUPS, ROLES, ROLE_GRANTS, RULE_ENFORCED, capState, isGranted, effectiveRole, displayName } from "../lib/roles";
import { MODULES, moduleOn } from "../lib/modules";
import { auth } from "../firebase";

const LEVEL_LABEL = { staff: "Staff", manager: "Manager", admin: "Admin" };

// ── The Modules section ─────────────────────────────────────────────────────
// v18.0.0 phase 4. Its own section, deliberately NOT folded in beside "Enforce
// roles" as the plan's wording suggested (Patryk's call): role enforcement is
// not a module, and listing it among WhatsApp and Vouchers would read as "roles
// are an optional feature", which is the opposite of what phase 3 built.
//
// ── WHY A MODULE BEING SWITCHED OFF ASKS FIRST ──────────────────────────────
// Off hides every surface of the module, which for vouchers means the tab, the
// booking-form picker, the list chips, the redeem modal, the unsettled banner
// and the printed column. That is the behaviour Patryk chose over "off stops
// new vouchers but existing ones stay redeemable", and its one real cost is
// that **an open voucher is money the restaurant owes** — hiding it silently
// makes a liability invisible.
//
// So the switch states the count and the balance before it moves, and then
// REFUSES NOTHING: an admin who has read the number may still turn it off, and
// nothing in the database is touched — the vouchers are waiting when the switch
// comes back. A confirm that blocks would be the wrong instrument, because the
// restaurant that wants vouchers gone is not making a mistake.
//
// Inline rather than an `Overlay`, so this adds no entry to the modal stack:
// a surface in `MODAL_Z` owes an `escapeAction` and a rank, and a two-button
// question inside a section it belongs to needs neither.
function ModuleRow({ mod, on, warning, onToggle, onConfirm, onCancel }) {
  // /code-review: `Reveal` CACHES its last truthy children and keeps them
  // mounted for the full exit hold, so both buttons below stay hit-testable for
  // ~520ms after the answer has been given — the submitGuard lesson (a control
  // inside a self-animating exit is still a live control), one surface over.
  // A second tap on "off anyway" would send a second whole-node
  // `settings/admin` write with identical content and advance `adminRev` again.
  // Idempotent, so this is waste rather than corruption — which is why the fix
  // is a local latch and not the full commit-once guard: `answered` makes the
  // cached copy inert without needing to know anything about the write path.
  // It resets whenever a fresh question arrives, keyed on the warning itself.
  const answered = useRef(false);
  useEffect(function () { if (warning) answered.current = false; }, [warning]);
  function once(fn) {
    return function () {
      if (answered.current) return;
      answered.current = true;
      fn();
    };
  }
  return (
    <div style={{
      padding: SP.base + "px 0",
      borderTop: "1px solid var(--border-soft)",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: SP.wide }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: FW.semi, fontSize: T.body, color: "var(--text-primary)" }}>
            {mod.label}
          </div>
          <div style={{ fontSize: T.micro, color: "var(--text-muted)", marginTop: 2 }}>
            {on ? mod.blurb : "Off. " + mod.hides}
          </div>
        </div>
        <Toggle
          on={on}
          onClick={function () { onToggle(!on); }}
          /* The label carries the module's identity: a static one would be N
             identical names for N switches, which in the source is one string
             and only on the running page is three (v17.15.6). `aria-checked`
             says on or off, so the name must not. */
          label={mod.label}
        />
      </div>

      {/* Always mounted, only its child conditional — a live region that
          arrives holding its message announces nothing. Same shape as the
          refusal alert below. */}
      <div role="alert">
        <Reveal show={!!warning}>
          {warning
            ? <div style={{ marginTop: SP.base }}>
                <InlineAlert tone={ALERT_TONES.warn.tone} tint={ALERT_TONES.warn.tint}>
                  {warning}
                </InlineAlert>
                <div style={{ display: "flex", gap: SP.base, marginTop: SP.base, flexWrap: "wrap" }}>
                  <button className="mgt-hover-scale"
                    onClick={once(onConfirm)}
                    style={mkSolidBtn("var(--app-warn-solid)")}
                  >Turn {mod.label} off anyway</button>
                  <button className="mgt-hover-scale"
                    onClick={once(onCancel)}
                    style={mkBtn()}
                  >Keep it on</button>
                </div>
              </div>
            : null}
        </Reveal>
      </div>
    </div>
  );
}

// ── The Integrations section ────────────────────────────────────────────────
// v18.0.0 phase 4. It answers ONE question — "where do I add or change the
// WhatsApp login details?" — and its whole design is the answer being "not
// here, and here is why".
//
// ── NO SECRET GOES IN THE DATABASE, AND THIS PANEL SAYS SO ──────────────────
// `.read` is `auth != null` at the ROOT, and read permission cascades DOWN and
// cannot be revoked at a child — the read-side twin of the measured CT-2A-06
// write finding. So a Meta token stored anywhere in this database is readable
// by every waiter who can sign in, and that token can send messages as the
// restaurant and read every customer conversation. Making one path
// admin-only-readable would mean removing the root grant and re-granting every
// readable path individually: the riskiest change available, because a path
// that silently loses its read grant goes BLANK on every device, and a read
// failure is quieter than a write failure.
//
// Under project-per-restaurant this is not a compromise, it is the mechanism:
// each tenant has its own Vercel project, so per-project environment variables
// are already scoped per restaurant. The app's job is to make the state
// legible, never to hold the secret.
//
// ── WHAT IS NOT HERE YET, AND SAYS SO ───────────────────────────────────────
// The plan's `/api/wa-config` — a token-gated endpoint returning a BOOLEAN per
// key, never a value — lands in phase 5 with the WhatsApp port (Patryk's call).
// `api/_lib/env.js` on `wa-sandbox` already reads every one of these keys, so
// writing a second env reader now would be a duplicate for that merge to
// reconcile, and it could not be verified here in any case: `npm run dev` has
// no serverless runtime.
//
// So this section states WHERE each key lives and does not claim to know
// whether it is set. That is the honest version, and it is the one thing a
// panel about secrets must not get wrong — a status line that is not wired to
// anything is exactly the falsely-reassuring documentation this repo's crash
// tests hunt for.
const INTEGRATION_KEYS = [
  { group: "WhatsApp (Meta Cloud API)", keys: ["META_WA_TOKEN", "META_APP_SECRET", "META_VERIFY_TOKEN", "META_PHONE_NUMBER_ID"] },
  { group: "Message understanding (Gemini)", keys: ["GEMINI_API_KEY", "GEMINI_MODEL"] },
  { group: "Server-side database access", keys: ["FIREBASE_SERVICE_ACCOUNT", "WA_DB_URL"] },
];

// v18.0.0 phase 5: the status this section used to say was "coming". THREE
// states, not two, and the third is the point — `null` means "we could not ask",
// which is what `npm run dev` produces (no serverless runtime) and what a
// deployment without the functions produces. A panel about secrets must not
// render "not set" for a key it never managed to enquire about: that is a false
// negative pointing at a configuration problem that may not exist, in the one
// place someone goes to diagnose exactly that.
function useIntegrationStatus() {
  const [status, setStatus] = useState(null);   // null = unknown, else the payload
  const [failed, setFailed] = useState(false);
  useEffect(function () {
    let cancelled = false;
    (async function () {
      try {
        const user = auth.currentUser;
        if (!user) { if (!cancelled) setFailed(true); return; }
        const token = await user.getIdToken();
        const res = await fetch("/api/wa-config", { headers: { Authorization: "Bearer " + token } });
        if (!res.ok) throw new Error("HTTP " + res.status);
        const data = await res.json();
        if (!cancelled) { setStatus(data); setFailed(false); }
      } catch {
        // Deliberately quiet: on the dev server this request ALWAYS fails, and a
        // console error every time the Admin tab opens would train the one person
        // who reads this console to ignore it.
        if (!cancelled) setFailed(true);
      }
    })();
    return function () { cancelled = true; };
  }, []);
  return { status, failed };
}

// set → "Set", not set → "Not set", unknown → nothing but the key name. The
// third case renders no chip at all rather than a grey "unknown" one, because a
// row of ten "unknown" badges says the same thing ten times and the sentence
// under the list says it once, properly.
function KeyChip({ name, state }) {
  const tone = state === true ? "success" : state === false ? "warn" : "neutral";
  return (
    <OutlineChip tone={tone} size="micro">
      {name}{state === true ? " · set" : state === false ? " · not set" : ""}
    </OutlineChip>
  );
}

function IntegrationsSection() {
  const { status, failed } = useIntegrationStatus();
  return (
    <Section>
      <div style={{ fontWeight: FW.bold, fontSize: T.body, color: "var(--text-primary)" }}>
        Integrations
      </div>
      <div style={{ fontSize: T.micro, color: "var(--text-muted)", marginTop: 2 }}>
        Keys the server uses to reach WhatsApp and Google. They are <strong>not
        stored in this app</strong> and never will be: everyone who can sign in
        here can read this restaurant&rsquo;s whole database, so a key kept here
        would be a key every member of staff could take. They live in the
        deployment&rsquo;s environment variables instead, one set per restaurant.
      </div>

      {INTEGRATION_KEYS.map(function (g) {
        return (
          <div key={g.group} style={{ marginTop: SP.wide }}>
            <div style={{ fontWeight: FW.semi, fontSize: T.body, color: "var(--text-primary)" }}>
              {g.group}
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: SP.tight, marginTop: SP.tight }}>
              {g.keys.map(function (k) {
                // `undefined` (this deployment does not know the key) and a
                // failed request both land as unknown, which is correct: neither
                // is evidence the key is missing.
                const state = status && status.set ? status.set[k] : undefined;
                return <KeyChip key={k} name={k} state={typeof state === "boolean" ? state : null} />;
              })}
            </div>
          </div>
        );
      })}

      <div style={{ fontSize: T.micro, color: "var(--text-muted)", marginTop: SP.wide }}>
        To add or change one: open{" "}
        <a href="https://vercel.com/dashboard" target="_blank" rel="noreferrer noopener"
          style={{ color: "var(--accent)", fontWeight: FW.semi }}>
          Vercel
        </a>
        , pick this restaurant&rsquo;s project, then Settings &rarr; Environment
        Variables. The change takes effect on the next deployment.
      </div>
      {status ? (
        <div style={{ fontSize: T.micro, color: "var(--text-muted)", marginTop: SP.wide }}>
          Message understanding is <strong>{status.modes.llm}</strong> and sending
          is <strong>{status.modes.send}</strong>. These are separate from the keys
          above: a key can be set while the mode is still <em>mock</em>, which
          means nothing is being called and nothing is being spent.
        </div>
      ) : null}
      <div style={{ fontSize: T.micro, color: "var(--text-muted)", marginTop: SP.tight }}>
        {failed
          ? "Couldn\u2019t reach the server to check which of these are set, so none of them are marked either way. That is expected on a local dev server, which runs no server-side functions."
          : status
            ? "Set or not set only \u2014 the server never sends a value, so nothing on this screen can leak one."
            : "Checking which of these are set\u2026"}
      </div>
    </Section>
  );
}

// The grid's rows, bucketed once at module load out of two frozen constants
// that cannot change — rather than four `CAPABILITIES.filter` passes per
// render. **Every capability lands in a bucket**: one whose `group` matched no
// entry in `CAP_GROUPS` used to be silently dropped from the grid while still
// being enforced everywhere else, which is a permission you cannot see. It goes
// in the last group instead, and `tests/roles.test.js` fails the build if any
// capability names a group that does not exist.
// The list the panel prints AND the number it opens with — one fact, because
// this is the one panel whose stated purpose is being honest about what is
// enforced, and it shipped saying "Three" over a list of seven. The count moved
// from three to seven in the commit that split `settingsWrite`, and again to
// eight when v18.0.0 session 8 gave `customerDelete` a rule of its own — and a
// hand-typed number beside a derived list is how that goes unnoticed.
const ENFORCED_CAPS = CAPABILITIES.filter(function (c) { return RULE_ENFORCED[c.id]; });

const CAPS_BY_GROUP = {};
CAP_GROUPS.forEach(function (g) { CAPS_BY_GROUP[g.id] = []; });
CAPABILITIES.forEach(function (c) {
  const bucket = CAPS_BY_GROUP[c.group] || CAPS_BY_GROUP[CAP_GROUPS[CAP_GROUPS.length - 1].id];
  bucket.push(c);
});

// ── The refusal ─────────────────────────────────────────────────────────────
function RefusalPanel() {
  return (
    <Section>
      <InlineAlert tone={ALERT_TONES.warn.tone} tint={ALERT_TONES.warn.tint}>
        You don&rsquo;t have access to this tab. Ask an administrator if you need it.
      </InlineAlert>
    </Section>
  );
}

// ── The capability grid ─────────────────────────────────────────────────────
// A real <table>, not a grid of divs, and that is an accessibility decision
// rather than a layout one: a cell's meaning is "this capability, at this
// level", which is exactly what row and column headers express — so a screen
// reader announces the pair without thirty-nine hand-written labels to keep in
// step. The INTERACTIVE cells still carry their own `aria-label` naming the
// capability AND the person, because a control rendered from a `.map` inherits
// nothing from its surroundings and N identically-named controls is a defect
// this repo has now found four times.
function CellGlyph({ state, muted }) {
  // FOUR states since v18.0.0 phase 3, distinguishable by SHAPE as well as
  // colour — a plain check, a green pill, a red pill, an empty ring — because
  // colour alone is not a distinction. The two pills are deliberately a matched
  // pair: a capability ADDED to this person and one TAKEN AWAY from them are
  // the same kind of fact (an admin's decision about one row) and read as each
  // other's opposite, where the plain check and the empty ring are the level
  // speaking rather than anybody's decision.
  //
  // `muted` is the same grant read in SOMEBODY ELSE'S column: reference, not
  // this person's. It gets its own INK rather than the identical tick at
  // reduced opacity, which is what shipped first — three columns told apart by
  // opacity alone is the colour-only-status failure this app already fixed on
  // the timeline block (v17.11.0), and `--accent` at 0.45 is under 3:1 besides.
  if (state === "level") {
    return <span aria-hidden="true" style={{
      color: muted ? "var(--text-muted)" : "var(--accent)", fontWeight: FW.bold,
    }}>✓</span>;
  }
  if (state === "extra") {
    return (
      <span aria-hidden="true" style={{
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        width: 18, height: 18,   /* @canvas */
        borderRadius: R.pill,
        // Registered in tests/contrast.test.js as "success tag" — an opaque
        // fill picked for its ink rather than an alpha that composites toward
        // whatever is behind it.
        background: "var(--app-success-solid)",
        color: "var(--text-on-accent)",
        fontSize: T.micro, fontWeight: FW.bold,
      }}>✓</span>
    );
  }
  if (state === "denied") {
    return (
      <span aria-hidden="true" style={{
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        width: 18, height: 18,   /* @canvas */
        borderRadius: R.pill,
        // Registered in tests/contrast.test.js as "danger tag" — the pairing
        // was measured before it was copied, which is the rule this repo has
        // for a tone/tint pair chosen by hand.
        background: "var(--app-danger-solid)",
        color: "var(--text-on-accent)",
        fontSize: T.micro, fontWeight: FW.bold, lineHeight: 1,
      }}>&times;</span>
    );
  }
  // NOT `--border-glass`, which is what shipped first and is white at 0.30 —
  // a RAISED EDGE token, invisible by construction on the near-white sheet this
  // sits on (measured: the empty cells read as blank, so the affordance for the
  // grid's whole primary action was missing). A mark that must be SEEN takes an
  // ink token, which flips with the surface under it.
  return (
    <span aria-hidden="true" style={{
      display: "inline-block", width: 12, height: 12,   /* @canvas */
      borderRadius: R.pill,
      border: "1px solid var(--text-muted)",
      opacity: muted ? 0.35 : 1,
    }} />
  );
}

const STATE_WORD = {
  level: "granted by level",
  extra: "granted as an extra",
  denied: "switched off for this person",
  none: "not granted",
};
// `isGranted` is imported from lib/roles.js: the button's pressed state and the
// app's own gate must be the same fact, not two ladders that agree today.

function CapabilityGrid({ row, myUid, onToggleCap }) {
  // A pending invitation has no uid, so there is no row to write onto.
  const editable = row && row.kind === "user";
  // EFFECTIVE, not stored. A person who has signed in but whom no admin has
  // given a level is governed as `staff` — that is what `can()` does with an
  // absent role everywhere else in the app — and keying the grid on the raw
  // `row.role` meant NO column was theirs, so every one of the 54 cells was
  // read-only and an admin could not grant or deny that person anything. The
  // People list has been offering "No level (staff)" beside a grid that would
  // not act on it since the panel shipped.
  const level = row ? effectiveRole(row.role) : null;
  // …but the caption still tells the truth about which of the two it is.
  const levelIsAssumed = !!(row && row.kind === "user" && !row.role);
  const who = displayName(row);
  const isSelf = !!(row && row.uid && row.uid === myUid);
  // An invite row has no stored entry: it carries the level and extras the
  // invitation will apply. It has no `denies` and deliberately does not get
  // one — an invitation says "come in at this level", and the fine-tuning
  // happens on the row once that person exists.
  const subject = row ? (row.entry || { role: level, extras: row.extras || {}, denies: row.denies || {} }) : null;

  function stateFor(cap, col) {
    // The person's OWN column is the only one that can show a decision — an
    // extra or a deny belongs to them, and painting either across all three
    // would say the LEVEL grants or withholds it.
    if (col === level) return capState(subject, cap);
    return ROLE_GRANTS[col] && ROLE_GRANTS[col][cap] ? "level" : "none";
  }

  // The person's own column is BOUNDED, not just tinted: measured at 580px the
  // three columns were told apart by a caption and an opacity, and on a 13-row
  // grid the eye loses which one it is in. A 1px rule is the cheapest thing
  // that survives both themes and adds no fill for the contrast registry to
  // chase.
  // Three possible answers, decided once per render rather than per cell. It
  // was called 69 times a render (3 headers + 4 group rows x 3 + 18 rows x 3)
  // for a function whose only input is `level`, on a component that re-renders
  // on every tick and every person switch.
  const EDGE = { borderLeft: "1px solid var(--accent)", borderRight: "1px solid var(--accent)" };
  const edges = {};
  ROLES.forEach(function (col) { edges[col] = col === level ? EDGE : null; });
  function colEdge(col) { return edges[col]; }

  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: T.body }}>
      <thead>
        <tr>
          <th scope="col" style={{ textAlign: "left", padding: SP.tight, color: "var(--text-muted)", fontWeight: FW.semi }}>
            Capability
          </th>
          {ROLES.map(function (col) {
            const isTheirs = col === level;
            return (
              <th key={col} scope="col" style={{
                // 84 → 60. The label column was measured at SEVENTY-TWO pixels
                // inside this 580px card, so every capability wrapped to four
                // lines; three level columns at 84 were taking 252 of the 333
                // the grid gets. A tick needs 60.
                padding: SP.tight, width: 60,   /* @canvas */
                textAlign: "center",
                color: isTheirs ? "var(--accent)" : "var(--text-muted)",
                fontWeight: isTheirs ? FW.bold : FW.semi,
                borderTop: isTheirs ? "1px solid var(--accent)" : "none",
                ...colEdge(col),
              }}>
                {LEVEL_LABEL[col]}
                {/* Says WHICH of the two this is. A person with no level yet is
                    governed as staff — so the column is theirs and is editable
                    — but calling it "their level" would assert a decision no
                    admin has made. */}
                {isTheirs ? <div style={{ fontSize: T.micro, fontWeight: FW.regular, color: "var(--text-muted)" }}>{levelIsAssumed ? "no level yet" : "their level"}</div> : null}
              </th>
            );
          })}
        </tr>
      </thead>
      {/* Grouped since v18.0.0 phase 3. Thirteen rows read as one block;
            eighteen do not, and the groups are the honest reading of what a
            tick actually costs — a shift tool, money, the restaurant's own
            configuration, or something that cannot be taken back. The heading
            row carries three empty cells rather than a `colSpan`, so the accent
            rule bounding the person's column runs unbroken down the whole
            table instead of restarting in each group.

            ONE `<tbody>` per group, and the heading is `scope="rowgroup"`:
            "Service" labels the rows beneath it, and the `colgroup` this
            shipped with said it labelled the three LEVEL COLUMNS — the wrong
            axis, and the kind of thing only a screen reader would have told
            anybody. Several tbodys in one table is valid HTML and is what the
            scope value is defined against. */}
        {CAP_GROUPS.map(function (g) {
          const caps = CAPS_BY_GROUP[g.id];
          const lastGroup = g.id === CAP_GROUPS[CAP_GROUPS.length - 1].id;
          return (
            <tbody key={g.id}>
              <tr>
                <th scope="rowgroup" style={{
                  textAlign: "left", padding: SP.tight, paddingTop: SP.wide,
                  fontSize: T.micro, fontWeight: FW.bold, letterSpacing: "0.04em",
                  textTransform: "uppercase", color: "var(--text-faint)",
                }}>{g.label}</th>
                {ROLES.map(function (col) {
                  return <td key={col} style={colEdge(col) || undefined} />;
                })}
              </tr>
              {caps.map(function (c, ri) {
                const last = lastGroup && ri === caps.length - 1;
                return (
                  <tr key={c.id} style={{ borderTop: "1px solid var(--border-soft)" }}>
                    {/* The blurb moved to `title`. It was a second 10px line
                        under every one of thirteen labels, and against a 72px
                        column it rendered as four wrapped words ("Use a /
                        voucher / against a / booking.") — so the explanation
                        cost more legibility than it bought. The labels are
                        plain English on their own, and the full sentences still
                        show on the tab's own enforcement list. */}
                    <th scope="row" title={c.blurb} style={{ textAlign: "left", padding: SP.tight, fontWeight: FW.semi, color: "var(--text-primary)" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: SP.tight, flexWrap: "wrap" }}>
                        <span>{c.label}</span>
                        {RULE_ENFORCED[c.id]
                          ? <OutlineChip tone="success" size="micro"
                              title="Refused by the database too, not only hidden here">enforced</OutlineChip>
                          : null}
                      </div>
                    </th>
                    {ROLES.map(function (col) {
                      const st = stateFor(c.id, col);
                      const mine = col === level;
                      // Only the person's OWN column takes a tick, and since
                      // v18.0.0 phase 3 EVERY cell in it does — including one
                      // the level grants, which is the whole of the revocation
                      // Patryk asked for. The other two columns stay read-only
                      // reference: that side-by-side comparison is why this
                      // layout was chosen.
                      //
                      // The one exception is the last-admin invariant, and it
                      // is the same question the rules ask rather than a
                      // lookalike: an admin may not take `settingsAdmin` off
                      // their OWN row, by any route. Disabled with the reason
                      // on it, because a control that refuses when pressed
                      // teaches nothing about why.
                      const granted = isGranted(st);
                      const selfLock = isSelf && c.id === "settingsAdmin" && granted;
                      const canTick = editable && mine && !selfLock;
                      const cell = Object.assign(
                        { padding: SP.tight, textAlign: "center" },
                        colEdge(col),
                        last && mine ? { borderBottom: "1px solid var(--accent)" } : null
                      );
                      if (!canTick) {
                        return (
                          <td key={col} style={cell}
                              title={selfLock ? "You can't remove your own admin access — ask another admin to do it." : undefined}>
                            <CellGlyph state={st} muted={!mine} />
                            <span className="mgt-sr-only">
                              {STATE_WORD[st] + (selfLock ? ", and you cannot remove your own admin access" : "")}
                            </span>
                          </td>
                        );
                      }
                      return (
                        <td key={col} style={cell}>
                          <button
                            className="mgt-hover-scale"
                            aria-pressed={granted}
                            aria-label={c.label + " for " + who}
                            title={granted ? "Switch off for " + who : "Switch on for " + who}
                            onClick={function () { onToggleCap(c.id, !granted); }}
                            style={{
                              border: "none", background: "transparent", cursor: "pointer",
                              // The hit area, not the glyph. Measured at 19×21
                              // with padding alone, under WCAG 2.5.8's 24px
                              // floor for a control that is this grid's primary
                              // action. `H.chip` clears it and costs ~5px a row.
                              minWidth: H.chip, minHeight: H.chip,
                              display: "inline-flex", alignItems: "center", justifyContent: "center",
                              padding: SP.tight, borderRadius: R.pill, lineHeight: 1,
                            }}
                          >
                            <CellGlyph state={st} muted={false} />
                            <span className="mgt-sr-only">{STATE_WORD[st]}</span>
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          );
        })}
    </table>
  );
}

// ── The modal ───────────────────────────────────────────────────────────────
// Two panes, per the plan: pick a person on the left, read their capabilities
// against all three levels on the right. `roles` sits ABOVE `settings` in
// MODAL_Z because it opens from inside the Settings overlay, and its
// `escapeAction` case ships in the same commit — `tests/modal-stack.test.js`
// fails the build otherwise.
export function RolesModal({ rows, selectedUid, myUid, onSelect, onToggleCap, onClose }) {
  const row = rows.find(function (r) { return (r.uid || r.inviteId) === selectedUid; }) || rows[0] || null;
  // What the AutoHeight below re-measures on: the person actually being shown,
  // not the `selectedUid` prop — those differ on the first open (nothing is
  // selected, so the grid falls back to `rows[0]`) and on a `rows` change that
  // drops the selected person.
  const shownId = row ? (row.uid || row.inviteId) : null;
  return (
    <Overlay onClose={onClose} footer={
      // Right-aligned, like every other modal footer in the app — this one
      // shipped as a bare button and sat bottom-LEFT with the rest of the bar
      // empty, which is the only footer in the app that does.
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button className="mgt-hover-scale" onClick={onClose} style={mkSolidBtn("var(--app-btn-slate)")}>Done</button>
      </div>
    }>
      {/* `background` is REQUIRED and has no default — omitting it rendered
          `--text-on-accent` (white) on a TRANSPARENT pill, i.e. an invisible
          heading, which is what the atom's "no default" rule exists to make
          impossible to do quietly. It takes the same neutral as the Settings
          pill it opens from: ModalTitle's colour rule is that a create/act
          surface wears its action's own colour and a configure/read surface
          wears a neutral. */}
      <ModalTitle background="var(--app-btn-grey-strong)">Capabilities</ModalTitle>
      <p style={{ margin: 0, marginBottom: SP.wide, color: "var(--text-muted)", fontSize: T.body }}>
        A level sets the defaults. Tapping a cell in this person&rsquo;s own
        column switches that one capability on or off for them alone &mdash;
        their level, and everybody else on it, is untouched.
      </p>
      {/* Every other modal in the app eases its own height; this one jumped.
          The grid is a different height for every person — only the cells in
          THEIR column are tickable, and a tick button is a 28px hit target
          against a 23px read-only row — so picking a manager after a staff
          member resized the card by ~130px in one frame, under the finger that
          was pointing at the list. `watch` is not optional here: the
          ResizeObserver AutoHeight normally runs on is a frame late by design,
          which on a whole-content SWAP lets the new grid paint unclipped for
          that frame (the v17.9.1 finding, and exactly why Settings passes its
          own `cur`). */}
      <AutoHeight watch={shownId}>
      <div style={{ display: "flex", gap: SP.wide, alignItems: "flex-start", flexWrap: "wrap" }}>
        <div role="group" aria-label="People" style={{ flex: "1 1 180px", minWidth: 0 }}>
          {rows.map(function (r) {
            const id = r.uid || r.inviteId;
            const on = row && (row.uid || row.inviteId) === id;
            return (
              <button className="mgt-hover-scale"
                key={id}
                onClick={function () { onSelect(id); }}
                aria-pressed={on}
                aria-label={displayName(r) + (r.kind === "invite" ? ", invited" : "")}
                style={{
                  display: "block", width: "100%", textAlign: "left",
                  padding: SP.base, marginBottom: SP.tight,
                  borderRadius: R.card, cursor: "pointer",
                  border: "1px solid " + (on ? "var(--accent)" : "var(--border-soft)"),
                  background: on ? "var(--bg-tab-active)" : "transparent",
                  color: "var(--text-primary)", fontSize: T.body, fontWeight: FW.semi,
                }}
              >
                {displayName(r)}
                <div style={{ fontSize: T.micro, fontWeight: FW.regular, color: "var(--text-muted)" }}>
                  {r.kind === "invite" ? "invited" : (r.role ? LEVEL_LABEL[r.role] : "no level yet")}
                </div>
              </button>
            );
          })}
        </div>
        <div style={{ flex: "3 1 320px", minWidth: 0, overflowX: "auto" }}>
          {row
            ? <CapabilityGrid row={row} myUid={myUid} onToggleCap={function (cap, on) { onToggleCap(row.uid, cap, on); }} />
            : <p style={{ color: "var(--text-muted)", fontSize: T.body }}>Nobody has signed in yet.</p>}
        </div>
      </div>
      </AutoHeight>
    </Overlay>
  );
}

// ── The tab ─────────────────────────────────────────────────────────────────
export function AdminTabContent({
  can, isAdmin, myUid, rows, enforceRoles, onSetEnforceRoles,
  modules, onSetModule, moduleWarning,
  onSetRole, onRemoveUser, onInvite, onWithdrawInvite, onApplyInvite, onOpenCapabilities,
  // v18.0.0 session 8: opens the activity log, which App owns — this tab holds
  // the door handle, not the modal.
  onOpenActivity,
}) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("staff");
  const [msg, setMsg] = useState(null);
  // Which module has been asked to switch off and is waiting on an answer. The
  // switch does NOT move while it waits, so the screen never shows a state the
  // database is not in.
  const [askOff, setAskOff] = useState(null);

  if (!can("settingsAdmin") || !isAdmin) return <RefusalPanel />;

  function say(res) { setMsg(res && res.ok === false ? res.error : null); }

  return (
    <div>
      {/* The `role="alert"` wrapper is ALWAYS mounted and only its CHILD is
          conditional — a live region announces a change to its CONTENT, so one
          that arrives already holding its message announces nothing. Found by
          measuring rather than by review: the last-admin refusal rendered
          perfectly on screen and `document.querySelectorAll('[role=alert]')`
          returned 0, so the one message in this panel that stops you doing
          something was reaching sighted users only. Same shape as the booking
          form and ReminderEditor; `Reveal` caches its last truthy child, which
          is what lets the exit animate once `msg` is already null. */}
      <div role="alert">
        <Reveal show={!!msg}>
          {msg ? <InlineAlert style={{ marginBottom: SP.wide }}>{msg}</InlineAlert> : null}
        </Reveal>
      </div>

      <Section>
        <div style={{ display: "flex", alignItems: "center", gap: SP.wide }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: FW.bold, fontSize: T.body, color: "var(--text-primary)" }}>
              Enforce roles
            </div>
            <div style={{ fontSize: T.micro, color: "var(--text-muted)", marginTop: 2 }}>
              {enforceRoles
                ? "On. Levels apply, and anyone with no level counts as staff."
                : "Off. Everybody can do everything, exactly as before — turn this on once the people below have the levels you want."}
            </div>
          </div>
          <Toggle on={enforceRoles} onClick={function () { onSetEnforceRoles(!enforceRoles); }} label="Enforce roles" />
        </div>
      </Section>

      {/* v18.0.0 phase 4. Below "Enforce roles" and above "People", because the
          reading order is what this restaurant HAS, then who may use it. */}
      <Section>
        <div style={{ fontWeight: FW.bold, fontSize: T.body, color: "var(--text-primary)" }}>
          Modules
        </div>
        <div style={{ fontSize: T.micro, color: "var(--text-muted)", marginTop: 2 }}>
          Whole features this restaurant uses, or does not. Switching one off hides
          it everywhere for everybody &mdash; it changes nothing in the database, so
          turning it back on restores what was there.
        </div>
        {MODULES.map(function (mod) {
          const on = moduleOn(modules, mod.id);
          // The question is asked only on the way OFF, and only when this
          // module has something to lose. `moduleWarning` is the parent's,
          // because only App can count open vouchers — the registry knows
          // nothing about what a module holds, and should not.
          const warn = askOff === mod.id ? (moduleWarning ? moduleWarning(mod.id) : null) : null;
          return (
            <ModuleRow
              key={mod.id}
              mod={mod}
              on={on}
              warning={warn}
              onToggle={function (next) {
                if (next) { setAskOff(null); onSetModule(mod.id, true); return; }
                const q = moduleWarning ? moduleWarning(mod.id) : null;
                // Nothing to warn about — switching off is then an ordinary
                // action and a confirm on every one of them is how a confirm
                // stops being read.
                if (!q) { setAskOff(null); onSetModule(mod.id, false); return; }
                setAskOff(mod.id);
              }}
              onConfirm={function () { setAskOff(null); onSetModule(mod.id, false); }}
              onCancel={function () { setAskOff(null); }}
            />
          );
        })}
      </Section>

      <IntegrationsSection />

      <Section>
        <div style={{ fontWeight: FW.bold, fontSize: T.body, marginBottom: SP.base, color: "var(--text-primary)" }}>
          People
        </div>
        {rows.length === 0
          ? <p style={{ color: "var(--text-muted)", fontSize: T.body, margin: 0 }}>
              Nobody has signed in yet. Invite someone below — they appear here the
              first time they sign in.
            </p>
          : rows.map(function (r) {
            const id = r.uid || r.inviteId;
            const self = r.uid && r.uid === myUid;
            return (
              <div key={id} style={{
                display: "flex", alignItems: "center", gap: SP.base, flexWrap: "wrap",
                padding: SP.base + "px 0",
                borderTop: "1px solid var(--border-soft)",
              }}>
                <div style={{ flex: "1 1 160px", minWidth: 0 }}>
                  <div style={{ fontWeight: FW.semi, fontSize: T.body, color: "var(--text-primary)" }}>
                    {displayName(r)}
                    {self ? <span style={{ color: "var(--text-muted)", fontWeight: FW.regular }}> (you)</span> : null}
                  </div>
                  <div style={{ fontSize: T.micro, color: "var(--text-muted)" }}>{r.email}</div>
                </div>

                {r.kind === "invite"
                  ? <>
                      <OutlineChip tone="neutral" size="micro">
                        invited as {LEVEL_LABEL[r.role]}
                      </OutlineChip>
                      <button className="mgt-hover-scale"
                        onClick={function () { onWithdrawInvite(r.inviteId); }}
                        aria-label={"Withdraw the invitation for " + displayName(r)}
                        style={mkBtn()}
                      >Withdraw</button>
                    </>
                  : <>
                      {r.invite
                        ? <button className="mgt-hover-scale"
                            onClick={function () { say(onApplyInvite(r.uid, r.invite)); }}
                            aria-label={"Apply the " + LEVEL_LABEL[r.invite.role] + " invitation to " + displayName(r)}
                            style={mkSolidBtn("var(--accent)")}
                          >Apply {LEVEL_LABEL[r.invite.role]} invite</button>
                        : null}
                      <select className="mgt-hover-scale"
                        value={r.role || ""}
                        aria-label={"Level for " + displayName(r)}
                        onChange={function (e) { say(onSetRole(r.uid, { role: e.target.value || null })); }}
                        style={mkSel()}
                      >
                        <option value="">No level (staff)</option>
                        {ROLES.map(function (x) { return <option key={x} value={x}>{LEVEL_LABEL[x]}</option>; })}
                      </select>
                      <button className="mgt-hover-scale"
                        onClick={function () { onOpenCapabilities(r.uid); }}
                        aria-label={"Capabilities for " + displayName(r)}
                        style={mkBtn()}
                      >Capabilities</button>
                      <button className="mgt-hover-scale"
                        onClick={function () { say(onRemoveUser(r.uid)); }}
                        aria-label={"Remove " + displayName(r)}
                        style={mkBtn()}
                      >Remove</button>
                    </>}
              </div>
            );
          })}
      </Section>

      <Section>
        <div style={{ fontWeight: FW.bold, fontSize: T.body, marginBottom: SP.base, color: "var(--text-primary)" }}>
          Invite someone
        </div>
        <div style={{ fontSize: T.micro, color: "var(--text-muted)", marginBottom: SP.base }}>
          They sign in with this address first; the invitation then waits on their
          row for you to apply in one tap. An invitation cannot promote anybody by
          itself.
        </div>
        <div style={{ display: "flex", gap: SP.base, flexWrap: "wrap" }}>
          <input className="mgt-hover-scale"
            type="email"
            value={email}
            aria-label="Email address to invite"
            placeholder="name@example.com"
            onChange={function (e) { setEmail(e.target.value); }}
            style={{ ...mkInp(), flex: "1 1 200px", minWidth: 0 }}
          />
          <select className="mgt-hover-scale" value={role} aria-label="Level for the invitation" onChange={function (e) { setRole(e.target.value); }} style={mkSel()}>
            {ROLES.map(function (x) { return <option key={x} value={x}>{LEVEL_LABEL[x]}</option>; })}
          </select>
          <button className="mgt-hover-scale"
            onClick={function () {
              const res = onInvite(email, role);
              say(res);
              if (res && res.ok) setEmail("");
            }}
            style={mkSolidBtn("var(--accent)")}
          >Invite</button>
        </div>
      </Section>

      {/* v18.0.0 session 8 (item 1). AFTER People and before the enforcement
          disclosure, because the reading order of this tab is: the switch, what
          this restaurant HAS, who may use it — and then what they did. */}
      <Section>
        <div style={{ display: "flex", alignItems: "center", gap: SP.wide, flexWrap: "wrap" }}>
          <div style={{ flex: "1 1 220px", minWidth: 0 }}>
            <div style={{ fontWeight: FW.bold, fontSize: T.body, color: "var(--text-primary)" }}>
              Activity log
            </div>
            <div style={{ fontSize: T.micro, color: "var(--text-muted)", marginTop: 2 }}>
              Every change, deletion and sign-in, with who did it and when. Kept for
              12 months. Guest names are not stored in it &mdash; they are read back
              from the bookings themselves, so a guest erased from the app is erased
              here too.
            </div>
          </div>
          <button
            type="button"
            className="mgt-hover-scale"
            onClick={onOpenActivity}
            style={mkBtn({ background: "var(--app-btn-grey-strong)", flexShrink: 0 })}
          >Open the log</button>
        </div>
      </Section>

      <Collapsible title="What the server actually enforces" defaultOpen={false}>
        <p style={{ margin: 0, marginBottom: SP.base, color: "var(--text-secondary)", fontSize: T.body }}>
          {ENFORCED_CAPS.length} of these are refused by the database itself, so
          they hold even if somebody reaches the data another way:
        </p>
        <ul style={{ margin: 0, paddingLeft: 18, color: "var(--text-secondary)", fontSize: T.body }}>
          {ENFORCED_CAPS.map(function (c) {
            return <li key={c.id}>{c.label}</li>;
          })}
        </ul>
        <p style={{ marginBottom: 0, marginTop: SP.base, color: "var(--text-muted)", fontSize: T.micro }}>
          The rest hide or disable controls in the app. That covers the thing this
          is actually for &mdash; somebody tapping the wrong button during a
          service &mdash; but it is not a security boundary, and this panel says so
          rather than letting you assume otherwise.
        </p>
      </Collapsible>
    </div>
  );
}
