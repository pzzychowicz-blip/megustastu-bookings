---
category: Icons
keywords: [status, pending, confirmed, seated, completed, cancelled]
---
THE booking-status mark. Pass a status and it draws the one icon the whole app uses for it: pending → hourglass (`WaitIcon`), confirmed → ✓ (`CheckIcon`), seated → chair (`ChairIcon`), completed → double check (`DoubleCheckIcon`), cancelled → ✕ (`CloseIcon`).

Always reach for this rather than picking a status icon by hand — the timeline block, the List card, the floor plan and the quick-status popup all read it, so a status can never be drawn two ways. Status is never shown by colour alone: pair a status fill (`BLOCK_BG[status]`) with this mark, as `SBadge` does.

```jsx
const { StatusIcon, IC } = window.MGTBookings;
<span style={{ color: "var(--text-on-accent)" }}><StatusIcon status="seated" size={IC.control} /></span>
```

Size it by ROLE with the `IC` scale — `IC.inline` (12) inside a text run or dense row, `IC.control` (14) on a control, `IC.chrome` (18, the default) for header furniture. It draws in `currentColor`: colour it by setting `color` on the element around it. It is `aria-hidden`, so the button holding it needs its own `aria-label`.
