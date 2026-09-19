import { PlanView } from "megustastu-bookings";
import { Surface } from "./_shared/frame";
import { ALL_BOOKINGS, TODAY, NOW, LATE, FREEING, BLOCKS, LAYOUT } from "./_shared/fixtures";

const noop = () => {};

function Plan({ dark = false }: { dark?: boolean }) {
  return (
    <Surface dark={dark}>
      <PlanView
        bookings={ALL_BOOKINGS} date={TODAY} layout={LAYOUT} blocks={BLOCKS}
        nowMins={NOW} late={LATE} freeing={FREEING}
        onEdit={noop} onStatus={noop} onNoShow={noop} onWalkin={noop}
      />
    </Surface>
  );
}

// The room at 20:10: seated tables green with their "free in ~Nm" pills, the
// next arrivals amber, a pending request yellow, the rest free.
export const EveningService = () => <Plan />;

export const DarkTheme = () => <Plan dark />;
