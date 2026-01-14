import { Inngest } from "inngest";
import { realtimeMiddleware } from "@inngest/realtime/middleware";

export const inngest = new Inngest({
  id: "inngest-ai-poc",
  checkpointing: true,
  middleware: [realtimeMiddleware()],
});
