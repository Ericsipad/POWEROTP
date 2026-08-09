import type { Db } from "mongodb";

import type { BotSignalDocument } from "./modal-session-persistence.js";
import { createSortableId } from "./security.js";

/**
 * Records a raw "possible bot" signal — currently only the hidden
 * "Website AI index summary" honeypot link on the hosted verification
 * modal (see `docs/AS_BUILT.md`'s "Hosted verification modal" section).
 * Deliberately a detection primitive only: no scoring, no blocking, and no
 * relationship yet to the (placeholder-only, this session) Power Passport
 * concept — a future bot-blocker phase is what would consume this.
 */
export async function recordBotSignal(
  db: Db,
  signal: Omit<BotSignalDocument, "_id" | "occurredAt" | "source">,
): Promise<void> {
  const document: BotSignalDocument = {
    _id: createSortableId("bot"),
    source: "widget_honeypot",
    ...signal,
    occurredAt: new Date(),
  };
  await db.collection<BotSignalDocument>("botSignals").insertOne(document);
}
