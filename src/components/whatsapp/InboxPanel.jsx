// src/components/whatsapp/InboxPanel.jsx
// Full-screen WhatsApp inbox overlay: a list pane + a conversation pane (two-pane
// ≥900px, stacked below). Owns the active-conversation selection, the Inbox /
// Archived tab, the Templates sub-modal, Esc handling, body-scroll lock, and
// mark-read-on-open. This is a deliberately wide custom panel (not the atoms
// Overlay). Blur budget: scrim blur(6) + card blur(16) = 2 (≤4 holds; the
// Templates sub-modal adds 2 more only while open).

import { useState, useEffect, useRef } from "react";
import { useWinW } from "../../hooks/useWinW";
import { INBOX_TWO_PANE_BREAKPOINT, sortConversations } from "../../lib/whatsapp";
import { ConversationList } from "./ConversationList";
import { ConversationView } from "./ConversationView";
import { TemplatesEditor } from "./TemplatesEditor";
import { mkBtn } from "../atoms";

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
  onDismissAcceptedBadge, onMarkIntentHandled,
}) {
  const winW = useWinW();
  const twoPane = winW >= INBOX_TWO_PANE_BREAKPOINT;

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

  function switchTab(next) {
    if (next === tab) return;
    setTab(next);
    // Two-pane: land on the top of the new tab. Stacked: show that tab's list.
    setActiveKey(twoPane ? topKeyOfTab(conversations, next) : null);
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
        const list = sortConversations(conversations, tab === "archived");
        if (!list.length) return;
        e.preventDefault();
        const idx = list.findIndex((c) => c.phoneKey === activeKey);
        const next = idx < 0 ? 0
          : e.key === "ArrowDown" ? Math.min(idx + 1, list.length - 1)
          : Math.max(idx - 1, 0);
        setActiveKey(list[next].phoneKey);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [twoPane, activeKey, showTpl, tab, conversations, onClose]);
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
      <ConversationList conversations={conversations} activeKey={activeKey} onSelect={setActiveKey} bookings={bookings} archivedView={tab === "archived"} />
    </div>
  );
  const viewEl = activeConv ? (
    <div style={{ flex: 1, minWidth: 0, display: twoPane || activeKey ? "flex" : "none", flexDirection: "column", height: "100%" }}>
      <ConversationView
        conv={activeConv} messages={activeMessages} onBack={() => setActiveKey(null)}
        onSend={(t) => onSend(activeConv.phoneKey, t)} onAccept={() => onAccept(activeConv)} onDismiss={() => onDismiss(activeConv.phoneKey)}
        templates={templates} bookings={bookings} showBack={!twoPane}
        onArchive={onArchive} onUnarchive={onUnarchive} onDelete={onDelete}
        onCancelLinkedBooking={onCancelLinkedBooking} onOpenLinkedBooking={onOpenLinkedBooking}
        onDismissAcceptedBadge={onDismissAcceptedBadge} onMarkIntentHandled={onMarkIntentHandled}
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
    <div style={{ position: "fixed", inset: 0, zIndex: 200, background: "var(--wa-panel-scrim)", backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)", display: "flex", alignItems: "center", justifyContent: "center", padding: winW < 600 ? 0 : 16, boxSizing: "border-box" }} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: "var(--wa-panel-bg)", backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)", borderRadius: winW < 600 ? 0 : 20, border: "1px solid var(--border-sheet)", width: "100%", maxWidth: 1200, height: winW < 600 ? "100dvh" : "min(900px, 90dvh)", display: "flex", flexDirection: "column", boxShadow: "var(--shadow-sheet)", overflow: "hidden", boxSizing: "border-box" }}>
        <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--wa-divider)", background: "var(--wa-header-bg)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexShrink: 0, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span style={{ fontSize: 11, fontWeight: 700, padding: "3px 8px", borderRadius: 8, background: "var(--wa-green)", color: "var(--text-on-accent)", letterSpacing: "0.02em" }}>WHATSAPP</span>
            <div style={{ display: "flex", gap: 2, background: "var(--bg-tabbar)", borderRadius: 11, padding: 3, border: "1px solid var(--border-soft)" }}>
              {tabBtn("inbox", "Inbox", unreadCount)}
              {tabBtn("archived", "Archived", archivedCount)}
            </div>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <button onClick={() => setShowTpl(true)} title="Templates" className="mgt-hover-scale" style={mkBtn({ fontSize: 12, minHeight: 36, padding: "6px 12px", background: "var(--btn-default)" })}>⚙ Templates</button>
            <button onClick={onClose} title="Close (Esc)" className="mgt-hover-scale" style={mkBtn({ fontSize: 18, minHeight: 36, padding: "4px 12px", background: "var(--btn-default)" })}>✕</button>
          </div>
        </div>
        <div style={{ flex: 1, display: "flex", flexDirection: "row", minHeight: 0, overflow: "hidden" }}>
          {listEl}{viewEl}
        </div>
        {showTpl ? <TemplatesEditor templates={templates} onClose={() => setShowTpl(false)} onSave={(next) => { onSaveTemplates(next); setShowTpl(false); }} /> : null}
      </div>
    </div>
  );
}
