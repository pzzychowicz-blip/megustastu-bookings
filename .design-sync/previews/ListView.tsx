import { useState } from "react";
import { ListView } from "megustastu-bookings";
import { Surface } from "./_shared/frame";
import { ALL_BOOKINGS, TODAY, NOW, LATE, WARNINGS, addDaysStr } from "./_shared/fixtures";

const noop = () => {};

function List({ dark = false, date = TODAY, finished = false, selected = null }: { dark?: boolean; date?: string; finished?: boolean; selected?: string | null }) {
  const [showFinished, setShowFinished] = useState(finished);
  const [selectedId, setSelectedId] = useState<string | null>(selected);
  return (
    <Surface dark={dark}>
      <ListView
        bookings={ALL_BOOKINGS} date={date} today={TODAY} nowMins={NOW}
        warnings={WARNINGS} late={LATE}
        selectedId={selectedId} onSelect={(id: string) => setSelectedId(id)}
        showFinished={showFinished} onToggleFinished={() => setShowFinished((v) => !v)}
        onEdit={noop} onStatus={noop} onDelete={noop} onManual={noop} onNoShow={noop}
      />
    </Surface>
  );
}

// Tonight's queue at 20:10, in the order staff work it: seated first, then
// the arrivals by time. The overstay warning, the late party, the repeat
// no-show and the regular each carry their own flag.
export const EveningService = () => <List />;

// Yesterday: every booking is completed or cancelled, so the queue is empty
// and the "Completed & cancelled" fold — opened here — is the whole day.
export const YesterdayFinished = () => <List date={addDaysStr(TODAY, -1)} finished />;

export const DarkTheme = () => <List dark selected="b11" />;
