// The card lives in _shared/icon-card.tsx; this file only names the icon and its button label.
import { WaitIcon } from "megustastu-bookings";
import { IconCard } from "./_shared/icon-card";

export const Sizes = () => <IconCard Icon={WaitIcon} label={"Pending"} />;
