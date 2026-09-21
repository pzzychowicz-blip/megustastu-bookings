import { useEffect, useRef } from "react";
import { WeekView } from "megustastu-bookings";
import { ModalStage } from "./_shared/backdrop";
import { ALL_BOOKINGS, TODAY } from "./_shared/fixtures";

// WeekView keeps its Week / Month / Stats mode to itself (App opens it on
// Week). To show the other two, the story presses the segment button inside
// ITS OWN stage — a window-level W/M/S key would switch every WeekView mounted
// in the card at once.
function Calendar({ dark = false, mode }: { dark?: boolean; mode?: "Month" | "Stats" }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!mode || !ref.current) return;
    const btn = Array.from(ref.current.querySelectorAll("button")).find((b) => b.textContent === mode);
    if (btn) (btn as HTMLButtonElement).click();
  }, [mode]);
  return (
    <ModalStage dark={dark} height={700}>
      <div ref={ref}>
        <WeekView bookings={ALL_BOOKINGS} viewDate={TODAY} onPick={() => {}} onClose={() => {}} />
      </div>
    </ModalStage>
  );
}

export const Week = () => <Calendar />;
export const Month = () => <Calendar mode="Month" />;
export const Stats = () => <Calendar dark mode="Stats" />;
