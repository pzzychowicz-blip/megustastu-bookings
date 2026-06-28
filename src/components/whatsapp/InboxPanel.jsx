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
import { mkBtn, mkInp, usePresence, ModalPresence } from "../atoms";

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
  // rendered list and the ↑/↓ keyboard nav so they stay in lockstep.
  const [query, setQuery] = useState("");
  const [needsAction, setNeedsAction] = useState(false);
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
        const list = sortConversations(filteredConvs, tab === "archived");
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
  }, [twoPane, activeKey, showTpl, tab, conversations, onClose, query, needsAction]);
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
        <ConversationList conversations={filteredConvs} activeKey={activeKey} onSelect={setActiveKey} bookings={bookings} archivedView={tab === "archived"} emptyLabel={filtersActive ? "No matches." : undefined} />
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
            <button onClick={() => setShowTpl(true)} title="Templates" className="mgt-hover-scale mgt-press" style={mkBtn({ fontSize: 12, minHeight: 36, padding: "6px 12px", background: "var(--btn-default)" })}>⚙ Templates</button>
            <button onClick={onClose} title="Close (Esc)" className="mgt-hover-scale mgt-press" style={mkBtn({ fontSize: 18, minHeight: 36, padding: "4px 12px", background: "var(--btn-default)" })}>✕</button>
          </div>
        </div>
        {/* Search + Needs-action filter toolbar — filters the list + ↑/↓ nav. */}
        <div style={{ padding: "8px 14px", borderBottom: "1px solid var(--wa-divider)", background: "var(--wa-header-bg)", display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          <div style={{ flex: 1, minWidth: 0, position: "relative" }}>
            <input
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
            style={{ flexShrink: 0, background: needsAction ? "var(--wa-green)" : "transparent", color: needsAction ? "var(--text-on-accent)" : "var(--text-muted)", border: "1px solid " + (needsAction ? "var(--wa-green)" : "var(--border-input)"), borderRadius: 10, padding: "7px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }}
          >● Needs action</button>
        </div>
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
      </div>
    </div>
  );
}
