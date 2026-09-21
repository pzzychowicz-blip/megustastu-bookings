// The card lives in _shared/icon-card.tsx; this file only names the icon and its button label.
import { CloseIcon } from "megustastu-bookings";
import { IconCard } from "./_shared/icon-card";

export const Sizes = () => <IconCard Icon={CloseIcon} label={"Dismiss"} />;
