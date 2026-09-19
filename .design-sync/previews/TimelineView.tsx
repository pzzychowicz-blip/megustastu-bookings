import { useState, useRef } from "react";
import { TimelineView } from "megustastu-bookings";
import { Surface } from "./_shared/frame";
import { ALL_BOOKINGS, TODAY, NOW, LATE, FREEING, WARNINGS, BLOCKS, addDaysStr } from "./_shared/fixtures";

const noop = () => {};

// App owns zoom, follow-now and the scroll memory; the preview holds them in
// state the same way, so the zoom buttons and Follow work in the card.
function Timeline({ dark = false, date = TODAY, zoom: z0 = 1, follow = false, empty = false }: { dark?: boolean; date?: string; zoom?: number; follow?: boolean; empty?: boolean }) {
  const [zoom, setZoom] = useState(z0);
  const [followNow, setFollowNow] = useState(follow);
  const [autoOptimizer, setAutoOptimizer] = useState(true);
  const scrollPosRef = useRef(0);
  return (
    <Surface dark={dark}>
      <TimelineView
        bookings={empty ? [] : ALL_BOOKINGS} date={date} today={TODAY} nowMins={NOW}
        blocks={empty ? [] : BLOCKS} warnings={WARNINGS} late={LATE} freeing={FREEING}
        zoom={zoom} setZoom={setZoom} followNow={followNow} setFollowNow={setFollowNow} scrollPosRef={scrollPosRef}
        autoOptimizer={autoOptimizer} setAutoOptimizer={setAutoOptimizer}
        isEmpty={empty} onNew={empty ? noop : null} emptyWalkin={null}
        onEdit={noop} onManual={noop} onStatus={noop} onBlock={noop} onNoShow={noop} onReshuffle={noop} onBookWait={noop}
      />
    </Surface>
  );
}

// The whole day at 1×: lunch finished, three parties seated, the evening queued.
export const EveningService = () => <Timeline />;

// Follow: zoomed in and pinned to the now-line, as staff run it during service.
export const FollowingNow = () => <Timeline zoom={3} follow />;

export const DarkTheme = () => <Timeline dark />;

// A day with nothing booked yet — the empty-day prompt above the grid.
export const EmptyDay = () => <Timeline date={addDaysStr(TODAY, 60)} empty />;
