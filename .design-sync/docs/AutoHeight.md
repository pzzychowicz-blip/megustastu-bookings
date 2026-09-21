---
category: Motion
keywords: [animation, height, resize]
---
Eases its own height whenever its content's height changes (a `ResizeObserver`), so a tab switch or a list that grows glides instead of jumping. `watch` is an identity (e.g. the active tab id) to re-measure on synchronously when the WHOLE content is swapped.

```jsx
const { AutoHeight } = window.MGTBookings;
<AutoHeight watch={tab}>{tab === "week" ? <WeekList /> : <MonthGrid />}</AutoHeight>
```
