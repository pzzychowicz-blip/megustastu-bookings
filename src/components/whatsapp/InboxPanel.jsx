// src/components/whatsapp/InboxPanel.jsx
// Full-screen WhatsApp inbox overlay: a list pane + a conversation pane (two-pane
// ≥900px, stacked below). Owns the active-conversation selection, the Inbox /
// Archived tab, the Templates sub-modal, Esc handling, body-scroll lock, and
// mark-read-on-open.
//
// 17.15.0-wa-sandbox: it is an `Overlay` in `panel` mode. For its whole life it
// was "a deliberately wide custom panel (not the atoms Overlay)", and the cost
// of that exception was invisible from the screen: no role, no accessible name,
// no focus trap, no focus restore — on the module's MAIN surface. v17.9.1 had
// to extract `useDialog` out of Overlay just to reach it, and v17.15.0 made
// "every modal uses Overlay" literally true in prod with a test enforcing that
// exactly one file paints the modal scrim.
//
// The port was mostly deletion: the scrim div, the card div, the `*-in`/`*-out`
// class picking, the `mob` branch and the `useDialog` call are all Overlay's
// now. What stays is what is actually this panel's own — the two-pane body, the
// header, and the size, which is what `panel` carries. `--wa-panel-scrim` is
// gone; the scrim is the app's one scrim.
//
// Blur budget: Overlay's scrim blur(8) + the panel's blur(16) = 2 (≤4 holds;
// the Templates sub-modal adds 2 more only while open).

import { useState, useEffect, useRef } from "react";
import { useWinW } from "../../hooks/useWinW";
import { useWinH } from "../../hooks/useWinH";
import { INBOX_TWO_PANE_BREAKPOINT, INBOX_COMPACT_HEIGHT, sortConversations, matchCustomerByPhone, intentBannerVisible } from "../../lib/whatsapp";
import { ConversationList } from "./ConversationList";
import { ConversationView } from "./ConversationView";
import { TemplatesEditor } from "./TemplatesEditor";
import { TemplatesIcon, SelectIcon, FlaskIcon, TrashIcon, ArchiveIcon, RestoreIcon } from "./WaIcons";
import { CloseIcon } from "../Icons";
import { mkBtn, mkInp, mkSolidBtn, ModalPresence, Overlay, Reveal } from "../atoms";
import { R, T, FW, M, IC, H } from "../../lib/constants";

// A conversation is "actionable" when it needs a staff response. For a
// cancel/modify request that's the intent banner being VISIBLE (i.e. not yet
// "marked as handled" — intentBannerVisible respects intentHandledAt), so a
// handled request drops out of the filter. Otherwise: an unread thread, or a
// pending new-booking draft awaiting accept/dismiss.
// The panel's own size and surface, the only two things Overlay's `panel` mode
// takes. A module const rather than an inline object: Overlay is memo-free, but
// a fresh object per render is a fresh prop per render, and this one never
// changes.
const INBOX_PANEL = { maxWidth: 1200, height: "min(900px, 90dvh)", background: "var(--wa-panel-bg)", blur: 16 };

function isActionable(c) {
  const intent = c.draftData && c.draftData.intent;
  if (intent === "cancel" || intent === "modify") return intentBannerVisible(c);
  return !!(c.unread || c.draftStatus === "parsed");
}

// Top conversation (phoneKey) of a tab, in the same order ConversationList
// renders (shared sort) — used to auto-select on open, on tab switch, and when
// the layout widens to two-pane. Returns null for an empty tab.
function topKeyOfTab(convs, whichTab) {
  const sorted = sortConversations(convs, whichTab === "archived");
  return sorted.length ? sorted[0].phoneKey : null;
}

// ── Last-opened conversation (per device) ───────────────────────────────────
// Reopening the inbox lands you back on the thread you were reading. Kept in
// localStorage rather than App state so it also survives a reload — it is a UI
// position, i.e. a property of this screen, so it stays per-device (the
// settings/users prefs node is for choices, not cursor positions).
const LAST_CONV_KEY = "mgt-wa-last-conv";
function readLastConv() {
  try { return localStorage.getItem(LAST_CONV_KEY) || null; } catch { return null; }
}
function writeLastConv(key) {
  try { key ? localStorage.setItem(LAST_CONV_KEY, key) : localStorage.removeItem(LAST_CONV_KEY); } catch { /* ignore */ }
}

// resolveInitialKey — which conversation the inbox opens on, in priority order:
//   1. initialActiveKey — returning from the booking form / cancel confirm.
//      Handled by the caller (it also switches to the Archived tab if needed).
//   2. the remembered thread, if it still exists and is still in the Inbox.
//   3. the top of the Inbox tab.
// (2) deliberately falls through to (3) when the remembered thread is archived
// rather than flipping to the Archived tab: with auto-archive-on-complete on,
// the last thread you read is very often the one that just archived itself, and
// opening the inbox into the Archived tab would be a daily surprise.
function resolveInitialKey(convs) {
  const last = readLastConv();
  if (last) {
    const c = convs.find((x) => x.phoneKey === last);
    if (c && !c.archived) return last;
  }
  return topKeyOfTab(convs, "inbox");
}

export function InboxPanel({
  conversations, messages, templates, bookings, initialActiveKey,
  onClose, onSend, onAccept, onDismiss, onSaveTemplates, onMarkRead,
  onArchive, onUnarchive, onDelete, onCancelLinkedBooking, onOpenLinkedBooking,
  onDismissAcceptedBadge, onMarkIntentHandled, onResend, onApplyModify, onRecheck,
  onBulkArchive, onBulkUnarchive, onBulkDelete,
  query, setQuery, needsAction, setNeedsAction,
  // settings/general — the "Regular" threshold, so the conversation header's chip
  // reads identically to the booking form's (see regularChipLabel in customers.js).
  regularMin,
  // Sandbox-only: opens the simulator ON TOP of this panel (the WaSimulator
  // Overlay mounts after InboxPanel in App's tree, so it stacks above at the
  // same z-index). null in any non-sandbox build → no button renders.
  onOpenSim = null,
}) {
  const winW = useWinW();
  const twoPane = winW >= INBOX_TWO_PANE_BREAKPOINT;
  // Short screens (tablet): collapse the draft card to a one-line bar + the
  // composer template chips behind a button so the message thread stays readable.
  const winH = useWinH();
  const compact = winH < INBOX_COMPACT_HEIGHT;

  // Search + "Needs action" filter (client-only). The filtered set feeds BOTH the
  // rendered list and the ↑/↓ keyboard nav so they stay in lockstep. State is
  // OWNED BY BookingApp (passed as props) so it survives the inbox round-trip
  // when "Open booking"/"Apply changes" closes the inbox to show the form —
  // returning restores the same filter state (it only resets on explicit close).
  const q = query.trim().toLowerCase();
  function matchesFilters(c) {
    if (needsAction && !isActionable(c)) return false;
    if (!q) return true;
    const m = matchCustomerByPhone(c.phoneKey, bookings);
    const name = (m ? m.name : (c.phone || c.phoneKey)) || "";
    return name.toLowerCase().includes(q)
      || String(c.phone || c.phoneKey || "").toLowerCase().includes(q)
      || String(c.lastMessageSnippet || "").toLowerCase().includes(q);
  }
  const filteredConvs = conversations.filter(matchesFilters);
  const filtersActive = !!q || needsAction;

  // If initialActiveKey is provided (returning from an overlay), open on it —
  // switching to the Archived tab if that conversation is archived.
  const initialKey = initialActiveKey || null;
  const initialConv = initialKey ? conversations.find((c) => c.phoneKey === initialKey) : null;
  const initialTab = initialConv && initialConv.archived ? "archived" : "inbox";
  const [tab, setTab] = useState(initialTab);
  const [activeKey, setActiveKey] = useState(() => {
    if (initialKey && initialConv) return initialKey;
    // No incoming key → in two-pane, restore the last thread you were reading
    // (falling back to the top of the Inbox), so the panel never opens on an
    // empty right pane. Stacked mode still starts on the LIST: on a phone the
    // conversation is full-screen, and auto-opening one would hide the inbox
    // behind it every single time.
    return twoPane ? resolveInitialKey(conversations) : null;
  });
  const [showTpl, setShowTpl] = useState(false);
  const searchRef = useRef(null); // "/" focuses the search box

  // ── Multi-select (bulk archive / restore / delete) ──────────────────────────
  // selectMode flips the list rows into checkbox mode (row click toggles the
  // checkbox instead of opening the conversation). `selected` holds phoneKeys.
  // Works in both tabs; the bulk action bar's actions depend on the active tab.
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState(() => new Set());
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  function clearSelection() { setSelected(new Set()); }
  function exitSelectMode() { setSelectMode(false); setSelected(new Set()); setConfirmBulkDelete(false); }
  function toggleSelect(key) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }
  // The conversations currently visible in this tab (after search/needs-action),
  // in render order — drives "Select all" and the selected-count display.
  const visibleInTab = sortConversations(filteredConvs, tab === "archived");
  const allVisibleSelected = visibleInTab.length > 0 && visibleInTab.every((c) => selected.has(c.phoneKey));
  function selectAllVisible() { setSelected(new Set(visibleInTab.map((c) => c.phoneKey))); }
  // Restrict the acted-on set to what's actually in the current tab (a stale key
  // from the other tab can't leak in — selection clears on tab switch anyway).
  function selectedKeysInTab() { return visibleInTab.filter((c) => selected.has(c.phoneKey)).map((c) => c.phoneKey); }

  function switchTab(next) {
    if (next === tab) return;
    setTab(next);
    setSelected(new Set()); // selection is per-tab; drop it on switch
    // Two-pane: land on the top of the new tab. Stacked: show that tab's list.
    setActiveKey(twoPane ? topKeyOfTab(conversations, next) : null);
  }

  function runBulk(action) {
    const keys = selectedKeysInTab();
    if (!keys.length) return;
    if (action === "archive" && onBulkArchive) onBulkArchive(keys);
    else if (action === "unarchive" && onBulkUnarchive) onBulkUnarchive(keys);
    else if (action === "delete" && onBulkDelete) onBulkDelete(keys);
    exitSelectMode();
  }

  // When the layout widens to two-pane with nothing selected (e.g. the inbox was
  // opened narrow, then the window crossed the breakpoint), auto-select the top
  // conversation of the current tab — matching open-wide / tab-switch behaviour.
  // Ref-gated to the narrow→wide transition so it never re-fires when the
  // selection is dropped for other reasons (the archive / tab-leave effect below).
  const prevTwoPane = useRef(twoPane);
  useEffect(() => {
    const was = prevTwoPane.current;
    prevTwoPane.current = twoPane;
    if (twoPane && !was && !activeKey) {
      const top = tab === "inbox" ? resolveInitialKey(conversations) : topKeyOfTab(conversations, tab);
      if (top) setActiveKey(top);
    }
  }, [twoPane]);

  // Keyboard: Esc (close templates → back to list on mobile → close inbox), plus
  // in-panel navigation — ←/→ switch tabs, ↑/↓ walk the conversation list.
  useEffect(() => {
    function onKey(e) {
      if (e.key === "Escape") {
        if (showTpl) { setShowTpl(false); return; }
        if (confirmBulkDelete) { setConfirmBulkDelete(false); return; }
        if (selectMode) { exitSelectMode(); return; }
        if (!twoPane && activeKey) { setActiveKey(null); return; }
        onClose();
        return;
      }
      // Never hijack typing (the reply textarea) or fire under the Templates modal.
      if (showTpl) return;
      const t = e.target;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      // ←/→ : switch Inbox ⇄ Archived (both layouts).
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        switchTab(tab === "inbox" ? "archived" : "inbox");
        return;
      }
      // ↑/↓ : move the selection through the current tab's list. Two-pane only —
      // in stacked mode selecting opens the conversation full-screen, which isn't
      // "list navigation".
      if ((e.key === "ArrowUp" || e.key === "ArrowDown") && twoPane) {
        const list = sortConversations(filteredConvs, tab === "archived");
        if (!list.length) return;
        e.preventDefault();
        const idx = list.findIndex((c) => c.phoneKey === activeKey);
        const next = idx < 0 ? 0
          : e.key === "ArrowDown" ? Math.min(idx + 1, list.length - 1)
          : Math.max(idx - 1, 0);
        setActiveKey(list[next].phoneKey);
        return;
      }
      // Letter shortcuts (ignore when a modifier is held so browser combos pass through).
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      // The active conversation's PENDING new_booking draft enables A=Accept / D=Dismiss.
      const ac = activeKey ? conversations.find((c) => c.phoneKey === activeKey) : null;
      const draftPending = !!(ac && ac.draftStatus === "parsed" && ac.draftData && (ac.draftData.intent || "new_booking") === "new_booking");
      if (k === "s") { e.preventDefault(); if (selectMode) exitSelectMode(); else setSelectMode(true); return; }
      if (k === "t") { e.preventDefault(); setShowTpl(true); return; }
      if (k === "a") {
        e.preventDefault();
        if (draftPending && onAccept) onAccept(ac);  // draft visible → Accept takes precedence
        else setNeedsAction((v) => !v);              // otherwise toggle the Needs-action filter
        return;
      }
      if (k === "d") {
        if (draftPending && onDismiss) { e.preventDefault(); onDismiss(ac.phoneKey); }
        return;
      }
      // / → focus the search box.
      if (e.key === "/") { e.preventDefault(); if (searchRef.current) searchRef.current.focus(); return; }
      // Backspace → Archive (Inbox tab): bulk-archive the selection in select mode,
      // else archive the active conversation.
      if (e.key === "Backspace" && tab === "inbox") {
        e.preventDefault();
        if (selectMode) { const keys = selectedKeysInTab(); if (keys.length && onBulkArchive) { onBulkArchive(keys); exitSelectMode(); } }
        else if (ac && onArchive) onArchive(ac.phoneKey);
        return;
      }
      // R → Restore (Archived tab): bulk-restore the selection in select mode,
      // else restore the active conversation.
      if (k === "r" && tab === "archived") {
        e.preventDefault();
        if (selectMode) { const keys = selectedKeysInTab(); if (keys.length && onBulkUnarchive) { onBulkUnarchive(keys); exitSelectMode(); } }
        else if (ac && onUnarchive) onUnarchive(ac.phoneKey);
        return;
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [twoPane, activeKey, showTpl, tab, conversations, onClose, query, needsAction, selectMode, confirmBulkDelete, onAccept, onDismiss, onArchive, onUnarchive, onBulkArchive, onBulkUnarchive]);
  // Body-scroll lock while the inbox is open.
  useEffect(() => {
    const orig = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = orig; };
  }, []);
  // Mark the active conversation read when selected.
  useEffect(() => {
    if (!activeKey) return;
    const c = conversations.find((x) => x.phoneKey === activeKey);
    if (c && c.unread) onMarkRead(activeKey);
  }, [activeKey]);
  // Remember the open thread for the next time the inbox opens. Only a real
  // selection is stored — clearing to the list (mobile back, archive) leaves the
  // previous memory in place rather than wiping it.
  useEffect(() => {
    if (activeKey) writeLastConv(activeKey);
  }, [activeKey]);
  // Drop the selection if the active conversation leaves the current tab.
  useEffect(() => {
    if (!activeKey) return;
    const c = conversations.find((x) => x.phoneKey === activeKey);
    if (!c) { setActiveKey(null); return; }
    const inCurrentTab = tab === "archived" ? c.archived : !c.archived;
    if (!inCurrentTab) setActiveKey(null);
  }, [conversations, tab]);

  const activeConv = activeKey ? conversations.find((c) => c.phoneKey === activeKey) : null;
  const activeMessages = activeConv ? (messages[activeConv.phoneKey] || []) : [];
  const unreadCount = conversations.filter((c) => c.unread && !c.archived).length;
  const archivedCount = conversations.filter((c) => c.archived).length;

  const listEl = (
    <div style={{ width: twoPane ? 320 : "100%", flexShrink: 0, borderRight: twoPane ? "1px solid var(--wa-divider)" : "none", background: "var(--wa-list-bg)", height: "100%", overflow: "hidden", display: twoPane || !activeKey ? "flex" : "none", flexDirection: "column" }}>
      {/* keyed by tab → Inbox⇄Archived switch crossfades the list */}
      <div key={tab} className="mgt-fade-in" style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
        <ConversationList conversations={filteredConvs} activeKey={activeKey} onSelect={setActiveKey} bookings={bookings} archivedView={tab === "archived"} emptyLabel={filtersActive ? "No matches." : undefined} selectMode={selectMode} selected={selected} onToggleSelect={toggleSelect} />
      </div>
    </div>
  );
  const viewEl = activeConv ? (
    <div style={{ flex: 1, minWidth: 0, display: twoPane || activeKey ? "flex" : "none", flexDirection: "column", height: "100%" }}>
      <ConversationView
        conv={activeConv} messages={activeMessages} onBack={() => setActiveKey(null)}
        onSend={(t) => onSend(activeConv.phoneKey, t)} onAccept={() => onAccept(activeConv)} onDismiss={() => onDismiss(activeConv.phoneKey)}
        templates={templates} bookings={bookings} showBack={!twoPane} compact={compact}
        onArchive={onArchive} onUnarchive={onUnarchive} onDelete={onDelete}
        onCancelLinkedBooking={onCancelLinkedBooking} onOpenLinkedBooking={onOpenLinkedBooking}
        onDismissAcceptedBadge={onDismissAcceptedBadge} onMarkIntentHandled={onMarkIntentHandled}
        onResend={onResend ? (msgId) => onResend(activeConv.phoneKey, msgId) : undefined}
        onApplyModify={onApplyModify}
        onRecheck={onRecheck}
        regularMin={regularMin}
      />
    </div>
  ) : (twoPane ? (
    <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted)", fontSize: T.lead, padding: 24, textAlign: "center" }}>
      {tab === "archived"
        ? (archivedCount ? "Select a conversation from the list." : "No archived conversations.")
        : (conversations.filter((c) => !c.archived).length ? "Select a conversation from the list." : "No conversations yet.")}
    </div>
  ) : null);

  function tabBtn(key, label, badge) {
    const isActive = tab === key;
    return (
      <button className="mgt-hover-scale" onClick={() => switchTab(key)} style={{ background: isActive ? "var(--bg-tab-active)" : "transparent", color: isActive ? "var(--text-primary)" : "var(--text-muted)", border: "none", borderRadius: R.pill, padding: "8px 14px", minHeight: 36, fontSize: T.body, fontWeight: FW.semi, cursor: "pointer", display: "flex", alignItems: "center", gap: 6, boxShadow: isActive ? "var(--shadow-btn)" : "none" }}>
        {label}
        {badge != null && badge > 0 ? <span style={{ fontSize: T.micro, fontWeight: FW.bold, padding: "0 6px", borderRadius: R.pill, background: isActive ? "var(--wa-unread-dot)" : "var(--btn-default)", color: "var(--text-on-accent)", lineHeight: 1.4 }}>{badge}</span> : null}
      </button>
    );
  }

  return (
    <Overlay onClose={onClose} panel={INBOX_PANEL}>
        <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--wa-divider)", background: "var(--wa-header-bg)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexShrink: 0, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            {/* An <h2>, not a <span>: useDialog resolves the dialog's accessible
                name from the first heading in its subtree, and this badge IS the
                panel's title. `margin: 0` because an h2 brings its own; the text
                stays the all-caps wordmark it has always been (the 0.02em
                letter-spacing is caps tracking and exists for it). */}
            <h2 style={{ fontSize: T.small, fontWeight: FW.bold, padding: "2px 8px", borderRadius: R.pill, background: "var(--wa-green)", color: "var(--text-on-accent)", letterSpacing: "0.02em", margin: 0 }}>WHATSAPP</h2>
            <div style={{ display: "flex", gap: 2, background: "var(--bg-tabbar)", borderRadius: R.pill, padding: 2, border: "1px solid var(--border-soft)" }}>
              {tabBtn("inbox", "Inbox", unreadCount)}
              {tabBtn("archived", "Archived", archivedCount)}
            </div>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            {/* Simulator opener (sandbox builds only) — lives next to the
                quick-reply Templates button per Patryk (2026-07-16); the sim
                opens on top of this window. */}
            {onOpenSim ? (
              <button onClick={onOpenSim} title="WhatsApp simulator (X)" className="mgt-hover-scale mgt-press" style={Object.assign({}, mkBtn({ background: "var(--btn-default)" }), { width: 36, height: 36, minHeight: 36, minWidth: 36, padding: 0, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, lineHeight: 1 })}><FlaskIcon size={IC.chrome} /></button>
            ) : null}
            <button onClick={() => setShowTpl(true)} title="Templates" className="mgt-hover-scale mgt-press" style={Object.assign({}, mkBtn({ background: "var(--btn-default)" }), { width: 36, height: 36, minHeight: 36, minWidth: 36, padding: 0, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 })}><TemplatesIcon size={IC.chrome} /></button>
            <button onClick={onClose} title="Close (Esc)" className="mgt-hover-scale mgt-press" style={Object.assign({}, mkBtn({ fontSize: T.title, background: "var(--btn-default)" }), { width: 36, height: 36, minHeight: 36, minWidth: 36, padding: 0, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, lineHeight: 1 })}><CloseIcon size={IC.chrome} /></button>
          </div>
        </div>
        {/* Search + Needs-action filter toolbar — filters the list + ↑/↓ nav.
            Order (Patryk, 2026-07-16): Select, then Needs action, then the
            search box (search sits on the right). */}
        <div style={{ padding: "8px 14px", borderBottom: "1px solid var(--wa-divider)", background: "var(--wa-header-bg)", display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          <button
            onClick={() => { if (selectMode) exitSelectMode(); else setSelectMode(true); }}
            title={selectMode ? "Exit selection" : "Select conversations"}
            className="mgt-hover-scale mgt-press"
            style={{ flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", background: selectMode ? "var(--wa-green)" : "transparent", color: selectMode ? "var(--text-on-accent)" : "var(--text-muted)", border: "1px solid " + (selectMode ? "var(--wa-green)" : "var(--border-soft)"), borderRadius: R.pill, padding: "8px", minHeight: 36, minWidth: 36, cursor: "pointer", transition: "background-color " + M.tap + ", color " + M.tap + ", transform " + M.tap }}
          ><SelectIcon size={IC.chrome} /></button>
          <button
            onClick={() => setNeedsAction((v) => !v)}
            title="Show only conversations that need a response"
            className="mgt-hover-scale mgt-press"
            style={{ flexShrink: 0, background: needsAction ? "var(--wa-green)" : "transparent", color: needsAction ? "var(--text-on-accent)" : "var(--text-muted)", border: "1px solid " + (needsAction ? "var(--wa-green)" : "var(--border-soft)"), borderRadius: R.pill, padding: "8px 14px", minHeight: 36, fontSize: T.body, fontWeight: FW.semi, cursor: "pointer", whiteSpace: "nowrap", display: "inline-flex", alignItems: "center", gap: 6 }}
          >{/* A real 8px dot, not a text ● — the same device NotificationStrip
               uses for a section with no icon. It stays a dot rather than
               becoming an icon because it reports a STATE (this filter is on),
               which is what the strip's dots report too. */}
            <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: "50%", backgroundColor: "currentColor", flexShrink: 0 }} />Needs action</button>
          <div style={{ flex: 1, minWidth: 0, position: "relative" }}>
            {/* 17.15.0-wa-sandbox: a placeholder is not a name. It is not
                exposed as one consistently, and it is gone the moment there is
                a value — so the control a screen reader meets while you are
                typing in it has no name at all. There is no visible label to
                associate here by design (the field is the width of the pane and
                its purpose is obvious to the eye), which is exactly the case
                `aria-label` exists for. */}
            <input
              ref={searchRef}
              aria-label="Search conversations"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search name, number or message…"
              style={Object.assign({}, mkInp(), { fontSize: T.body, padding: "8px 12px", paddingRight: query ? 30 : 12 })}
            />
            {query ? <button onClick={() => setQuery("")} title="Clear search" className="mgt-press" style={{ position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)", background: "transparent", border: "none", cursor: "pointer", display: "flex", alignItems: "center", color: "var(--text-muted)", padding: "2px 6px", lineHeight: 1 }}><CloseIcon size={IC.inline} /></button> : null}
          </div>
        </div>
        {/* Bulk action bar — only in select mode. Actions depend on the tab:
            Inbox → Archive; Archived → Restore + Delete (delete behind one
            confirm). Select all / Cancel are always present. Eased open/closed
            with the Reveal atom — same animation as the Summary panel. */}
        <Reveal show={selectMode}>
          <div style={{ padding: "8px 14px", borderBottom: "1px solid var(--wa-divider)", background: "var(--bg-soft)", display: "flex", alignItems: "center", gap: 8, flexShrink: 0, flexWrap: "wrap" }}>
            <button
              onClick={() => { if (allVisibleSelected) clearSelection(); else selectAllVisible(); }}
              className="mgt-hover-scale mgt-press"
              title={allVisibleSelected ? "Clear selection" : "Select all"}
              style={{ flexShrink: 0, background: "transparent", color: "var(--text-primary)", border: "1px solid var(--border-soft)", borderRadius: R.pill, padding: "6px 12px", fontSize: T.body, fontWeight: FW.semi, cursor: "pointer", whiteSpace: "nowrap" }}
            >{allVisibleSelected ? "Clear" : "Select all"}</button>
            <span style={{ fontSize: T.body, fontWeight: FW.semi, color: "var(--text-muted)" }}>{selected.size + " selected"}</span>
            <div style={{ marginLeft: "auto", display: "flex", gap: 6, flexShrink: 0 }}>
              {tab === "archived" ? (
                <>
                  <button onClick={() => runBulk("unarchive")} disabled={selected.size === 0} className="mgt-hover-scale mgt-press" style={mkSolidBtn(selected.size ? "var(--wa-btn-handled)" : "var(--btn-default)", { padding: "6px 12px", minHeight: H.compact, cursor: selected.size ? "pointer" : "not-allowed", fontSize: T.body, whiteSpace: "nowrap", opacity: selected.size ? 1 : 0.6, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 4 })}><RestoreIcon size={IC.inline} />Restore</button>
                  <button onClick={() => { if (selected.size) setConfirmBulkDelete(true); }} disabled={selected.size === 0} className="mgt-hover-scale mgt-press" style={mkSolidBtn(selected.size ? "var(--wa-btn-cancel)" : "var(--btn-default)", { display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 4, padding: "6px 12px", minHeight: H.compact, cursor: selected.size ? "pointer" : "not-allowed", fontSize: T.body, whiteSpace: "nowrap", opacity: selected.size ? 1 : 0.6 })} ><TrashIcon size={IC.inline} />Delete</button>
                </>
              ) : (
                <button onClick={() => runBulk("archive")} disabled={selected.size === 0} className="mgt-hover-scale mgt-press" style={mkSolidBtn(selected.size ? "var(--wa-green-dark)" : "var(--btn-default)", { display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 4, padding: "6px 12px", minHeight: H.compact, cursor: selected.size ? "pointer" : "not-allowed", fontSize: T.body, whiteSpace: "nowrap", opacity: selected.size ? 1 : 0.6 })} ><ArchiveIcon size={IC.inline} />Archive</button>
              )}
              <button onClick={exitSelectMode} className="mgt-hover-scale mgt-press" style={{ background: "transparent", color: "var(--text-muted)", border: "1px solid var(--border-soft)", borderRadius: R.pill, padding: "6px 12px", fontSize: T.body, fontWeight: FW.semi, cursor: "pointer", whiteSpace: "nowrap" }}>Cancel</button>
            </div>
          </div>
        </Reveal>
        <div style={{ flex: 1, display: "flex", flexDirection: "row", minHeight: 0, overflow: "hidden" }}>
          {twoPane ? (
            <>{listEl}{viewEl}</>
          ) : (
            // Mobile single-pane: slide between list and conversation on switch.
            // A keyed wrapper replays the slide-in keyframe; height/flex preserved
            // so the pane still fills (SlideView has no height, so it's not used here).
            <div key={activeKey ? "view" : "list"} className={activeKey ? "mgt-view-in-right" : "mgt-view-in-left"} style={{ flex: 1, minWidth: 0, display: "flex", height: "100%" }}>
              {activeKey ? viewEl : listEl}
            </div>
          )}
        </div>
        <ModalPresence show={showTpl}>{showTpl ? <TemplatesEditor templates={templates} onClose={() => setShowTpl(false)} onSave={(next) => { onSaveTemplates(next); setShowTpl(false); }} /> : null}</ModalPresence>
        <ModalPresence show={confirmBulkDelete}>{confirmBulkDelete ? (
          <Overlay
            onClose={() => setConfirmBulkDelete(false)}
            footer={<div style={{ display: "flex", justifyContent: "flex-end", gap: 8, flexWrap: "wrap" }}>
              <button onClick={() => setConfirmBulkDelete(false)} className="mgt-hover-scale mgt-press" style={mkBtn({ background: "var(--btn-default)" })}>Cancel</button>
              <button onClick={() => { setConfirmBulkDelete(false); runBulk("delete"); }} className="mgt-hover-scale mgt-press" style={mkBtn({ background: "var(--wa-btn-cancel)" })}>Delete {selected.size}</button>
            </div>}
          >
            <div style={{ fontSize: T.title, fontWeight: FW.bold, color: "var(--text-primary)", marginBottom: 8 }}>Delete {selected.size} conversation{selected.size !== 1 ? "s" : ""}?</div>
            <div style={{ fontSize: T.body, color: "var(--text-muted)" }}>This permanently removes the selected conversations and their messages. This can't be undone.</div>
          </Overlay>
        ) : null}</ModalPresence>
    </Overlay>
  );
}
