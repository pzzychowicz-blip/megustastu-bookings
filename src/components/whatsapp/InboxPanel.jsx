// src/components/whatsapp/InboxPanel.jsx
// Full-screen WhatsApp inbox overlay: a list pane + a conversation pane (two-pane
// ≥900px, stacked below). Owns the active-conversation selection, the Inbox /
// Archived tab, the Templates sub-modal, Esc handling, body-scroll lock, and
// mark-read-on-open. This is a deliberately wide custom panel (not the atoms
// Overlay). Blur budget: scrim blur(6) + card blur(16) = 2 (≤4 holds; the
// Templates sub-modal adds 2 more only while open).

import { useState, useEffect, useRef } from "react";
import { useWinW } from "../../hooks/useWinW";
import { useWinH } from "../../hooks/useWinH";
import { INBOX_TWO_PANE_BREAKPOINT, INBOX_COMPACT_HEIGHT, sortConversations, matchCustomerByPhone, intentBannerVisible } from "../../lib/whatsapp";
import { ConversationList } from "./ConversationList";
import { ConversationView } from "./ConversationView";
import { TemplatesEditor } from "./TemplatesEditor";
import { TemplatesIcon, SelectIcon } from "./WaIcons";
import { mkBtn, mkInp, usePresence, ModalPresence, Overlay, Reveal } from "../atoms";

// A conversation is "actionable" when it needs a staff response. For a
// cancel/modify request that's the intent banner being VISIBLE (i.e. not yet
// "marked as handled" — intentBannerVisible respects intentHandledAt), so a
// handled request drops out of the filter. Otherwise: an unread thread, or a
// pending new-booking draft awaiting accept/dismiss.
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

export function InboxPanel({
  conversations, messages, templates, bookings, initialActiveKey,
  onClose, onSend, onAccept, onDismiss, onSaveTemplates, onMarkRead,
  onArchive, onUnarchive, onDelete, onCancelLinkedBooking, onOpenLinkedBooking,
  onDismissAcceptedBadge, onMarkIntentHandled, onResend, onApplyModify,
  onBulkArchive, onBulkUnarchive, onBulkDelete,
  query, setQuery, needsAction, setNeedsAction,
  // Sandbox-only: opens the 🧪 simulator ON TOP of this panel (the WaSimulator
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
  // v15.8.0 open/close animation: ModalPresence (in App.jsx) provides `leaving`;
  // the panel swaps its scrim/card to the *-out keyframes before unmounting.
  const { leaving } = usePresence();
  const mob = winW < 600;
  const scrimCls = leaving ? "mgt-scrim-out" : "mgt-scrim-in";
  const cardCls = leaving ? (mob ? "mgt-sheet-out" : "mgt-card-out") : (mob ? "mgt-sheet-in" : "mgt-card-in");

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
    // No incoming key → in two-pane, open on the top inbox conversation; in
    // stacked mode start on the list (no forced selection).
    return twoPane ? topKeyOfTab(conversations, "inbox") : null;
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
      const top = topKeyOfTab(conversations, tab);
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
      />
    </div>
  ) : (twoPane ? (
    <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted)", fontSize: 14, padding: 30, textAlign: "center" }}>
      {tab === "archived"
        ? (archivedCount ? "Select a conversation from the list." : "No archived conversations.")
        : (conversations.filter((c) => !c.archived).length ? "Select a conversation from the list." : "No conversations yet.")}
    </div>
  ) : null);

  function tabBtn(key, label, badge) {
    const isActive = tab === key;
    return (
      <button className="mgt-hover-scale" onClick={() => switchTab(key)} style={{ background: isActive ? "var(--bg-tab-active)" : "transparent", color: isActive ? "var(--text-primary)" : "var(--text-muted)", border: "none", borderRadius: 9, padding: "5px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: 6, boxShadow: isActive ? "0 1px 3px rgba(0,0,0,0.08)" : "none" }}>
        {label}
        {badge != null && badge > 0 ? <span style={{ fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: 7, background: isActive ? "var(--wa-unread-dot)" : "var(--btn-default)", color: "var(--text-on-accent)", lineHeight: 1.4 }}>{badge}</span> : null}
      </button>
    );
  }

  return (
    <div className={scrimCls} style={{ position: "fixed", inset: 0, zIndex: 200, background: "var(--wa-panel-scrim)", backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)", display: "flex", alignItems: "center", justifyContent: "center", padding: winW < 600 ? 0 : 16, boxSizing: "border-box" }} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={cardCls} style={{ background: "var(--wa-panel-bg)", backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)", borderRadius: winW < 600 ? 0 : 20, border: "1px solid var(--border-sheet)", width: "100%", maxWidth: 1200, height: winW < 600 ? "100dvh" : "min(900px, 90dvh)", display: "flex", flexDirection: "column", boxShadow: "var(--shadow-sheet)", overflow: "hidden", boxSizing: "border-box" }}>
        <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--wa-divider)", background: "var(--wa-header-bg)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexShrink: 0, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span style={{ fontSize: 11, fontWeight: 700, padding: "3px 8px", borderRadius: 8, background: "var(--wa-green)", color: "var(--text-on-accent)", letterSpacing: "0.02em" }}>WHATSAPP</span>
            <div style={{ display: "flex", gap: 2, background: "var(--bg-tabbar)", borderRadius: 11, padding: 3, border: "1px solid var(--border-soft)" }}>
              {tabBtn("inbox", "Inbox", unreadCount)}
              {tabBtn("archived", "Archived", archivedCount)}
            </div>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            {/* 🧪 simulator opener (sandbox builds only) — lives next to the
                quick-reply Templates button per Patryk (2026-07-16); the sim
                opens on top of this window. */}
            {onOpenSim ? (
              <button onClick={onOpenSim} title="WhatsApp simulator (X)" className="mgt-hover-scale mgt-press" style={Object.assign({}, mkBtn({ minHeight: 36, padding: "6px 12px", background: "var(--btn-default)" }), { display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, lineHeight: 1 })}>🧪</button>
            ) : null}
            <button onClick={() => setShowTpl(true)} title="Templates" className="mgt-hover-scale mgt-press" style={Object.assign({}, mkBtn({ minHeight: 36, padding: "6px 12px", background: "var(--btn-default)" }), { display: "flex", alignItems: "center", justifyContent: "center" })}><TemplatesIcon size={17} /></button>
            <button onClick={onClose} title="Close (Esc)" className="mgt-hover-scale mgt-press" style={mkBtn({ fontSize: 18, minHeight: 36, padding: "4px 12px", background: "var(--btn-default)" })}>✕</button>
          </div>
        </div>
        {/* Search + Needs-action filter toolbar — filters the list + ↑/↓ nav.
            The select-mode toggle sits left of the search box (both tabs). */}
        <div style={{ padding: "8px 14px", borderBottom: "1px solid var(--wa-divider)", background: "var(--wa-header-bg)", display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          <button
            onClick={() => { if (selectMode) exitSelectMode(); else setSelectMode(true); }}
            title={selectMode ? "Exit selection" : "Select conversations"}
            className="mgt-hover-scale mgt-press"
            style={{ flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", background: selectMode ? "var(--wa-green)" : "transparent", color: selectMode ? "var(--text-on-accent)" : "var(--text-muted)", border: "1px solid " + (selectMode ? "var(--wa-green)" : "var(--border-soft)"), borderRadius: 10, padding: "8px", minHeight: 36, minWidth: 36, cursor: "pointer", transition: "background-color 160ms linear, color 160ms linear" }}
          ><SelectIcon size={17} /></button>
          <div style={{ flex: 1, minWidth: 0, position: "relative" }}>
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search name, number or message…"
              style={Object.assign({}, mkInp(), { fontSize: 13, padding: "8px 12px", paddingRight: query ? 30 : 12 })}
            />
            {query ? <button onClick={() => setQuery("")} title="Clear search" className="mgt-press" style={{ position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)", background: "transparent", border: "none", cursor: "pointer", fontSize: 14, fontWeight: 700, color: "var(--text-muted)", padding: "2px 6px", lineHeight: 1 }}>✕</button> : null}
          </div>
          <button
            onClick={() => setNeedsAction((v) => !v)}
            title="Show only conversations that need a response"
            className="mgt-hover-scale mgt-press"
            style={{ flexShrink: 0, background: needsAction ? "var(--wa-green)" : "transparent", color: needsAction ? "var(--text-on-accent)" : "var(--text-muted)", border: "1px solid " + (needsAction ? "var(--wa-green)" : "var(--border-soft)"), borderRadius: 10, padding: "7px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }}
          >● Needs action</button>
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
              style={{ flexShrink: 0, background: "transparent", color: "var(--text-primary)", border: "1px solid var(--border-soft)", borderRadius: 10, padding: "6px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }}
            >{allVisibleSelected ? "Clear" : "Select all"}</button>
            <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)" }}>{selected.size + " selected"}</span>
            <div style={{ marginLeft: "auto", display: "flex", gap: 6, flexShrink: 0 }}>
              {tab === "archived" ? (
                <>
                  <button onClick={() => runBulk("unarchive")} disabled={selected.size === 0} className="mgt-hover-scale mgt-press" style={{ background: selected.size ? "var(--wa-btn-handled)" : "var(--btn-default)", border: "1px solid rgba(255,255,255,0.2)", borderRadius: 10, padding: "6px 12px", cursor: selected.size ? "pointer" : "not-allowed", fontSize: 12, fontWeight: 700, color: "var(--text-on-accent)", whiteSpace: "nowrap", opacity: selected.size ? 1 : 0.6 }}>↺ Restore</button>
                  <button onClick={() => { if (selected.size) setConfirmBulkDelete(true); }} disabled={selected.size === 0} className="mgt-hover-scale mgt-press" style={{ background: selected.size ? "var(--wa-btn-cancel)" : "var(--btn-default)", border: "1px solid rgba(255,255,255,0.2)", borderRadius: 10, padding: "6px 12px", cursor: selected.size ? "pointer" : "not-allowed", fontSize: 12, fontWeight: 700, color: "var(--text-on-accent)", whiteSpace: "nowrap", opacity: selected.size ? 1 : 0.6 }}>🗑 Delete</button>
                </>
              ) : (
                <button onClick={() => runBulk("archive")} disabled={selected.size === 0} className="mgt-hover-scale mgt-press" style={{ background: selected.size ? "var(--wa-green-dark)" : "var(--btn-default)", border: "1px solid rgba(255,255,255,0.2)", borderRadius: 10, padding: "6px 12px", cursor: selected.size ? "pointer" : "not-allowed", fontSize: 12, fontWeight: 700, color: "var(--text-on-accent)", whiteSpace: "nowrap", opacity: selected.size ? 1 : 0.6 }}>📦 Archive</button>
              )}
              <button onClick={exitSelectMode} className="mgt-hover-scale mgt-press" style={{ background: "transparent", color: "var(--text-muted)", border: "1px solid var(--border-soft)", borderRadius: 10, padding: "6px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }}>Cancel</button>
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
            <div style={{ fontSize: 16, fontWeight: 700, color: "var(--text-primary)", marginBottom: 8 }}>Delete {selected.size} conversation{selected.size !== 1 ? "s" : ""}?</div>
            <div style={{ fontSize: 13, color: "var(--text-muted)" }}>This permanently removes the selected conversations and their messages. This can't be undone.</div>
          </Overlay>
        ) : null}</ModalPresence>
      </div>
    </div>
  );
}
