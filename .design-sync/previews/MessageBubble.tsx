import { MessageBubble } from "megustastu-bookings";
import { Surface } from "./_shared/frame";

// The thread pane the bubbles live on in ConversationView — the meta row under
// each bubble sits on THIS surface, so its muted ink is only right on it.
function Thread({ dark = false, children }: { dark?: boolean; children: any }) {
  return (
    <Surface dark={dark} pad={0}>
      <div style={{ background: "var(--wa-list-bg)", padding: 14, borderRadius: 10 }}>{children}</div>
    </Surface>
  );
}

const at = (h: number, m: number) => { const d = new Date(); d.setHours(h, m, 0, 0); return d.getTime(); };

const CONVERSATION = [
  { id: "m1", direction: "in", text: "Hola! ¿Tenéis mesa para 4 esta noche sobre las 21:00?", ts: at(18, 2) },
  { id: "m2", direction: "out", text: "¡Gracias por tu mensaje! Te respondemos en unos minutos.", ts: at(18, 2), status: "read", isAutoAck: true },
  { id: "m3", direction: "out", text: "Sí, tenemos mesa en la terraza a las 21:15. ¿A qué nombre la reservo?", ts: at(18, 5), status: "read" },
  { id: "m4", direction: "in", text: "Grupo Martín. Al final seremos 6, ¿es posible?", ts: at(18, 6) },
  { id: "m5", direction: "out", text: "Perfecto — 6 personas a las 21:15, mesas 1A y 1B. ¡Hasta luego!", ts: at(18, 8), status: "delivered" },
];

export const Conversation = () => (
  <Thread>
    {CONVERSATION.map((m) => <MessageBubble key={m.id} msg={m} isLast={false} onRetry={() => {}} />)}
  </Thread>
);

export const SendStates = () => (
  <Thread>
    <MessageBubble msg={{ id: "s1", direction: "in", text: "Can we move our booking to 20:30 instead?", ts: at(17, 41) }} isLast={false} />
    <MessageBubble msg={{ id: "s2", direction: "out", text: "Of course — you're now booked for 20:30, table 4.", ts: at(17, 44), status: "failed" }} isLast={false} onRetry={() => {}} />
    <MessageBubble msg={{ id: "s3", direction: "out", text: "See you tonight!", ts: at(17, 45), status: "sending" }} isLast={false} />
  </Thread>
);

export const DarkTheme = () => (
  <Thread dark>
    {CONVERSATION.slice(2).map((m) => <MessageBubble key={m.id} msg={m} isLast={false} onRetry={() => {}} />)}
  </Thread>
);
