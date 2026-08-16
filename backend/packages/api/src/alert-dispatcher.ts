import type { Db } from "mongodb";

import type { AlertCondition } from "./alerting-service.js";
import type { AlertStateDocument } from "./persistence.js";
import type { ProductionConfig } from "./config.js";
import type { EmailService } from "./email.js";

/** Don't re-email the admin for the same still-ongoing condition more than
 * once per hour, even if the check runs every few minutes. */
const ALERT_COOLDOWN_MS = 60 * 60 * 1_000;

/**
 * Emails `ADMIN_EMAIL` (the existing Brevo integration, same one used for
 * customer email verification) for each newly-triggered or still-cooling-
 * down-expired alert condition, and records when each was last sent so the
 * next check within the cooldown window is a no-op. A no-op, not an error,
 * when `ADMIN_EMAIL` is unset — alerting simply stays silent until an
 * operator configures it, the same deferred-configuration convention as
 * every other optional feature in this app.
 */
export async function dispatchAlerts(
  db: Db,
  email: EmailService,
  config: Pick<ProductionConfig, "ADMIN_EMAIL">,
  conditions: AlertCondition[],
): Promise<void> {
  if (!config.ADMIN_EMAIL || conditions.length === 0) return;

  const alertState = db.collection<AlertStateDocument>("alertState");
  const now = new Date();
  for (const condition of conditions) {
    const existing = await alertState.findOne({ _id: condition.key });
    if (existing && now.getTime() - existing.lastAlertedAt.getTime() < ALERT_COOLDOWN_MS) {
      continue;
    }
    await email.sendAdminAlert(config.ADMIN_EMAIL, condition.message);
    await alertState.updateOne(
      { _id: condition.key },
      { $set: { lastAlertedAt: now } },
      { upsert: true },
    );
  }
}
