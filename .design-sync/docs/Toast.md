---
category: Feedback
keywords: [toast, snackbar, status]
---
A floating status toast: renders its children with the toast entrance, and on `show={false}` plays the exit before unmounting. It brings no styling of its own — the app's toast is ONE pane for every message: `var(--bg-ac-menu)` fill, a 1px `var(--border-card)` border, `R.card` corners, `8px 14px` padding, `T.body` semibold text in `var(--text-primary)`, `var(--shadow-popover)`, and a small leading dot in the message's status colour (`var(--status-online)`, `var(--status-connecting)`, `var(--success-text)`, `var(--warn-text)`). The colour lives in the dot, not the pane. Show one toast at a time.

```jsx
const { Toast, R, T, FW, SP } = window.MGTBookings;
<Toast show={saved}>
  <div style={{ display: "flex", alignItems: "center", gap: SP.base, background: "var(--bg-ac-menu)", border: "1px solid var(--border-card)", borderRadius: R.card, padding: "8px 14px", fontSize: T.body, fontWeight: FW.semi, color: "var(--text-primary)", boxShadow: "var(--shadow-popover)" }}>
    <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--status-online)" }} />Reconnected — changes synced.
  </div>
</Toast>
```
