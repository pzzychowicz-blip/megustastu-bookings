// src/hooks/useCollapseState.js
//
// Per-conversation, per-section collapse state for the WhatsApp module's
// LinkedBookingCard and IntentBanner. Returns [collapsed, toggle] for one
// section ("linked" | "intent") of one conversation.
//
// Persistence is per-device localStorage — NOT Firebase. This is pure UI state
// (which cards a given staffer has folded away), so it belongs with the same
// per-device convention as the theme preference, not in the restaurant-wide
// Firebase config. Key shape: "mgt-wa-collapse-<phoneKey>" → { linked, intent }.
//
// The handleMarkIntentHandled flow clears the "intent" key for a conversation
// (via clearCollapseSection below) so a fresh request always defaults expanded.

import { useState, useEffect } from "react";

const PREFIX = "mgt-wa-collapse-";
const keyFor = (phoneKey) => PREFIX + (phoneKey || "_");

export function useCollapseState(phoneKey, section, defaultCollapsed) {
  const key = keyFor(phoneKey);
  const [collapsed, setCollapsed] = useState(() => {
    try {
      const raw = window.localStorage.getItem(key);
      if (!raw) return defaultCollapsed;
      const obj = JSON.parse(raw);
      return typeof obj[section] === "boolean" ? obj[section] : defaultCollapsed;
    } catch (e) { return defaultCollapsed; }
  });
  // Re-sync when the conversation (or section) changes — the same component
  // instance is reused across conversations in the two-pane layout.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(key);
      if (!raw) { setCollapsed(defaultCollapsed); return; }
      const obj = JSON.parse(raw);
      setCollapsed(typeof obj[section] === "boolean" ? obj[section] : defaultCollapsed);
    } catch (e) { setCollapsed(defaultCollapsed); }
  }, [phoneKey, section, defaultCollapsed]);
  function toggle() {
    const next = !collapsed;
    setCollapsed(next);
    try {
      const raw = window.localStorage.getItem(key);
      const obj = raw ? JSON.parse(raw) : {};
      obj[section] = next;
      window.localStorage.setItem(key, JSON.stringify(obj));
    } catch (e) {}
  }
  return [collapsed, toggle];
}

// Clear one section's stored collapse state for a conversation (so it falls back
// to its default next time). Used when a request is marked handled — the intent
// banner should reappear expanded if a new request later arrives.
export function clearCollapseSection(phoneKey, section) {
  try {
    const key = keyFor(phoneKey);
    const raw = window.localStorage.getItem(key);
    if (!raw) return;
    const obj = JSON.parse(raw);
    delete obj[section];
    window.localStorage.setItem(key, JSON.stringify(obj));
  } catch (e) {}
}
