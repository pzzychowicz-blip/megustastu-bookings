---
category: Overlays
keywords: [modal, animation, exit]
---
Keeps a modal mounted long enough to play its closing animation, and tells the `Overlay` inside it that it is leaving (the sheet slides down, the card fades and shrinks). It renders no element of its own. Without it a modal simply vanishes on close — the app treats a one-way transition as a bug.

```jsx
const { ModalPresence, Overlay, ModalTitle } = window.MGTBookings;
<ModalPresence show={open}>
  {open ? <Overlay onClose={() => setOpen(false)}><ModalTitle background="var(--app-btn-grey-strong)">Settings</ModalTitle>…</Overlay> : null}
</ModalPresence>
```
