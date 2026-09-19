---
category: WhatsApp
keywords: [chat, message, whatsapp, bubble, conversation]
---
One message in a WhatsApp conversation thread. An incoming message sits on the left, on the light bubble; an outgoing one sits on the right, on the blue accent bubble. Under each bubble, on the thread's own surface, sits a small meta row: the clock time, an italic "auto" for the language-matched auto-acknowledgement, and for outgoing messages "· sending / delivered / read / failed". A failed send shows a Retry chip when `onRetry` is passed. A message still sending is drawn at reduced opacity.

- Stack them on the thread pane (`var(--wa-list-bg)`, 14px padding). The meta row's muted ink is only correct on that surface, never on a card.
- `ts` is epoch milliseconds, shown as local 24-hour time.
- `isLast` is for the newest message only: it rises in with the bubble animation, and opening a thread does not animate its whole history.

```jsx
const { MessageBubble } = window.MGTBookings;
<div style={{ background: "var(--wa-list-bg)", padding: 14 }}>
  <MessageBubble msg={{ id: "m1", direction: "in", text: "Hola! ¿Tenéis mesa para 4 esta noche?", ts: Date.now() - 60000 }} />
  <MessageBubble msg={{ id: "m2", direction: "out", text: "Sí — a las 21:15 en la terraza.", ts: Date.now(), status: "delivered" }} isLast />
</div>
```
