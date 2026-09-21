---
category: Feedback
keywords: [alert, error, message, validation]
---
The message a form shows when it refuses to save — "No tables available at this time", "Text is required." It is a tinted pane with the mark and the text in the tone colour (never a border, never a third shade).

Pick the colours by ROLE from `ALERT_TONES` — `danger` (default), `warn`, `success`, `offline` — and spread the pair; never hand-pair a tone with a tint (that is how three sites shipped below AA contrast). `icon` takes any icon component; `icon={null}` renders text only. In a form, wrap it in `Reveal` so it eases in and out.

```jsx
const { InlineAlert, ALERT_TONES, LateIcon } = window.MGTBookings;
<InlineAlert>No tables available at this time — see suggestions below.</InlineAlert>
<InlineAlert {...ALERT_TONES.warn} icon={LateIcon}>Kitchen is busy at 20:00 — 3 tables start then.</InlineAlert>
```
