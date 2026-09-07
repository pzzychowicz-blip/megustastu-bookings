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
// Three capabilities are refused by the database too (`RULE_ENFORCED`); the
// other ten are UI gates that cover the real threat — a member of staff tapping
// the wrong thing — and are not security boundaries. A permission model that
// claims more than it enforces is exactly the falsely-reassuring documentation
// this repo's crash tests hunt for, so the panel says which is which instead of
// letting the reader assume.

import { useState } from "react";
import { R, T, FW, SP } from "../lib/constants";
import { Section, Collapsible, Toggle, InlineAlert, ALERT_TONES, OutlineChip, Overlay, ModalTitle, Reveal, mkInp, mkBtn, mkSolidBtn, mkSel } from "./atoms";
import { CAPABILITIES, ROLES, ROLE_GRANTS, RULE_ENFORCED, displayName } from "../lib/roles";

const LEVEL_LABEL = { staff: "Staff", manager: "Manager", admin: "Admin" };

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
function CellGlyph({ state }) {
  // Three states, distinguishable by SHAPE as well as colour — a filled check,
  // a solid pill, an empty ring — because colour alone is not a distinction.
  if (state === "level") {
    return <span aria-hidden="true" style={{ color: "var(--accent)", fontWeight: FW.bold }}>✓</span>;
  }
  if (state === "extra") {
    return (
      <span aria-hidden="true" style={{
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        width: 20, height: 20,   /* @canvas */
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
  return (
    <span aria-hidden="true" style={{
      display: "inline-block", width: 10, height: 10,   /* @canvas */
      borderRadius: R.pill,
      border: "1px solid var(--border-glass)",
    }} />
  );
}

const STATE_WORD = { level: "granted by level", extra: "granted as an extra", none: "not granted" };

function CapabilityGrid({ row, onToggleExtra }) {
  // A pending invitation has no uid, so there is no row to write an extra onto.
  const editable = row && row.kind === "user";
  const level = row && row.role;
  const extras = (row && row.extras) || {};
  const who = displayName(row);

  function stateFor(cap, col) {
    if (ROLE_GRANTS[col] && ROLE_GRANTS[col][cap]) return "level";
    // An extra belongs to the PERSON, so it shows only in the column they are
    // actually on. Painting it across all three would say the level grants it.
    if (col === level && extras[cap] === true) return "extra";
    return "none";
  }

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
                padding: SP.tight, width: 84,   /* @canvas */
                textAlign: "center",
                color: isTheirs ? "var(--accent)" : "var(--text-muted)",
                fontWeight: isTheirs ? FW.bold : FW.semi,
              }}>
                {LEVEL_LABEL[col]}
                {isTheirs ? <div style={{ fontSize: T.micro, fontWeight: FW.regular, color: "var(--text-muted)" }}>their level</div> : null}
              </th>
            );
          })}
        </tr>
      </thead>
      <tbody>
        {CAPABILITIES.map(function (c) {
          return (
            <tr key={c.id} style={{ borderTop: "1px solid var(--border-soft)" }}>
              <th scope="row" style={{ textAlign: "left", padding: SP.tight, fontWeight: FW.semi, color: "var(--text-primary)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: SP.tight, flexWrap: "wrap" }}>
                  <span>{c.label}</span>
                  {RULE_ENFORCED[c.id]
                    ? <OutlineChip tone="success" size="micro">enforced by the server</OutlineChip>
                    : null}
                </div>
                <div style={{ fontSize: T.micro, fontWeight: FW.regular, color: "var(--text-muted)" }}>{c.blurb}</div>
              </th>
              {ROLES.map(function (col) {
                const st = stateFor(c.id, col);
                // Only the person's OWN column takes a tick, and only where the
                // level does not already grant it — a "from level" cell is
                // un-untickable BY CONSTRUCTION, because there is nothing to
                // write. The other two columns are read-only reference: that
                // side-by-side comparison is why this layout was chosen.
                const canTick = editable && col === level && st !== "level"
                  && !(col === "admin" && c.id === "settingsAdmin");
                if (!canTick) {
                  return (
                    <td key={col} style={{ padding: SP.tight, textAlign: "center", opacity: col === level ? 1 : 0.45 }}>
                      <CellGlyph state={st} />
                      <span className="mgt-sr-only">{STATE_WORD[st]}</span>
                    </td>
                  );
                }
                return (
                  <td key={col} style={{ padding: SP.tight, textAlign: "center" }}>
                    <button
                      className="mgt-hover-scale"
                      aria-pressed={st === "extra"}
                      aria-label={c.label + " for " + who}
                      onClick={function () { onToggleExtra(c.id, st !== "extra"); }}
                      style={{
                        border: "none", background: "transparent", cursor: "pointer",
                        padding: SP.tight, borderRadius: R.pill, lineHeight: 1,
                      }}
                    >
                      <CellGlyph state={st} />
                      <span className="mgt-sr-only">{STATE_WORD[st]}</span>
                    </button>
                  </td>
                );
              })}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// ── The modal ───────────────────────────────────────────────────────────────
// Two panes, per the plan: pick a person on the left, read their capabilities
// against all three levels on the right. `roles` sits ABOVE `settings` in
// MODAL_Z because it opens from inside the Settings overlay, and its
// `escapeAction` case ships in the same commit — `tests/modal-stack.test.js`
// fails the build otherwise.
export function RolesModal({ rows, selectedUid, onSelect, onToggleExtra, onClose }) {
  const row = rows.find(function (r) { return (r.uid || r.inviteId) === selectedUid; }) || rows[0] || null;
  return (
    <Overlay onClose={onClose} footer={
      <button onClick={onClose} style={mkSolidBtn("var(--app-btn-slate)")}>Done</button>
    }>
      <ModalTitle>Capabilities</ModalTitle>
      <p style={{ margin: 0, marginBottom: SP.wide, color: "var(--text-muted)", fontSize: T.body }}>
        A level is a floor. Ticking a cell grants that one capability to that one
        person on top of their level &mdash; it never takes anything away.
      </p>
      <div style={{ display: "flex", gap: SP.wide, alignItems: "flex-start", flexWrap: "wrap" }}>
        <div role="group" aria-label="People" style={{ flex: "1 1 180px", minWidth: 0 }}>
          {rows.map(function (r) {
            const id = r.uid || r.inviteId;
            const on = row && (row.uid || row.inviteId) === id;
            return (
              <button
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
            ? <CapabilityGrid row={row} onToggleExtra={function (cap, on) { onToggleExtra(row.uid, cap, on); }} />
            : <p style={{ color: "var(--text-muted)", fontSize: T.body }}>Nobody has signed in yet.</p>}
        </div>
      </div>
    </Overlay>
  );
}

// ── The tab ─────────────────────────────────────────────────────────────────
export function AdminTabContent({
  can, isAdmin, myUid, rows, enforceRoles, onSetEnforceRoles,
  onSetRole, onRemoveUser, onInvite, onWithdrawInvite, onApplyInvite, onOpenCapabilities,
}) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("staff");
  const [msg, setMsg] = useState(null);

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
                      <button
                        onClick={function () { onWithdrawInvite(r.inviteId); }}
                        aria-label={"Withdraw the invitation for " + displayName(r)}
                        style={mkBtn()}
                      >Withdraw</button>
                    </>
                  : <>
                      {r.invite
                        ? <button
                            onClick={function () { say(onApplyInvite(r.uid, r.invite)); }}
                            aria-label={"Apply the " + LEVEL_LABEL[r.invite.role] + " invitation to " + displayName(r)}
                            style={mkSolidBtn("var(--accent)")}
                          >Apply {LEVEL_LABEL[r.invite.role]} invite</button>
                        : null}
                      <select
                        value={r.role || ""}
                        aria-label={"Level for " + displayName(r)}
                        onChange={function (e) { say(onSetRole(r.uid, { role: e.target.value || null })); }}
                        style={mkSel()}
                      >
                        <option value="">No level (staff)</option>
                        {ROLES.map(function (x) { return <option key={x} value={x}>{LEVEL_LABEL[x]}</option>; })}
                      </select>
                      <button
                        onClick={function () { onOpenCapabilities(r.uid); }}
                        aria-label={"Capabilities for " + displayName(r)}
                        style={mkBtn()}
                      >Capabilities</button>
                      <button
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
          <input
            type="email"
            value={email}
            aria-label="Email address to invite"
            placeholder="name@example.com"
            onChange={function (e) { setEmail(e.target.value); }}
            style={{ ...mkInp(), flex: "1 1 200px", minWidth: 0 }}
          />
          <select value={role} aria-label="Level for the invitation" onChange={function (e) { setRole(e.target.value); }} style={mkSel()}>
            {ROLES.map(function (x) { return <option key={x} value={x}>{LEVEL_LABEL[x]}</option>; })}
          </select>
          <button
            onClick={function () {
              const res = onInvite(email, role);
              say(res);
              if (res && res.ok) setEmail("");
            }}
            style={mkSolidBtn("var(--accent)")}
          >Invite</button>
        </div>
      </Section>

      <Collapsible title="What the server actually enforces" defaultOpen={false}>
        <p style={{ margin: 0, marginBottom: SP.base, color: "var(--text-secondary)", fontSize: T.body }}>
          Three of these are refused by the database itself, so they hold even if
          somebody reaches the data another way:
        </p>
        <ul style={{ margin: 0, paddingLeft: 18, color: "var(--text-secondary)", fontSize: T.body }}>
          {CAPABILITIES.filter(function (c) { return RULE_ENFORCED[c.id]; }).map(function (c) {
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
