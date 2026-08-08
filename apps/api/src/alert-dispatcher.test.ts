import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Db } from "mongodb";

import { dispatchAlerts } from "./alert-dispatcher.js";
import type { AlertStateDocument } from "./persistence.js";
import type { EmailService } from "./email.js";

function createFakeDb(seed: AlertStateDocument[] = []) {
  const state = new Map(seed.map((row) => [row._id, row]));
  const updateOneCalls: unknown[] = [];
  const fakeCollection = {
    findOne: async (filter: { _id: string }) => state.get(filter._id) ?? null,
    updateOne: async (filter: { _id: string }, update: { $set: { lastAlertedAt: Date } }) => {
      updateOneCalls.push({ filter, update });
      state.set(filter._id, { _id: filter._id, lastAlertedAt: update.$set.lastAlertedAt });
      return { matchedCount: 1 };
    },
  };
  return {
    db: { collection: () => fakeCollection } as unknown as Db,
    updateOneCalls,
  };
}

function createFakeEmail() {
  const sentAlerts: Array<{ to: string; message: string }> = [];
  const email: EmailService = {
    async sendVerification() {},
    async sendAdminAlert(to, message) {
      sentAlerts.push({ to, message });
    },
  };
  return { email, sentAlerts };
}

describe("dispatchAlerts", () => {
  it("does nothing when ADMIN_EMAIL is unset", async () => {
    const { db } = createFakeDb();
    const { email, sentAlerts } = createFakeEmail();
    await dispatchAlerts(db, email, {}, [{ key: "queue_backlog:x", message: "backed up" }]);
    assert.equal(sentAlerts.length, 0);
  });

  it("emails the admin for a newly-triggered condition and records the cooldown state", async () => {
    const { db, updateOneCalls } = createFakeDb();
    const { email, sentAlerts } = createFakeEmail();
    await dispatchAlerts(
      db,
      email,
      { ADMIN_EMAIL: "admin@example.com" },
      [{ key: "queue_backlog:x", message: "backed up" }],
    );
    assert.equal(sentAlerts.length, 1);
    assert.equal(sentAlerts[0]!.to, "admin@example.com");
    assert.equal(updateOneCalls.length, 1);
  });

  it("suppresses a repeat email for the same condition within the cooldown window", async () => {
    const { db } = createFakeDb([{ _id: "queue_backlog:x", lastAlertedAt: new Date() }]);
    const { email, sentAlerts } = createFakeEmail();
    await dispatchAlerts(
      db,
      email,
      { ADMIN_EMAIL: "admin@example.com" },
      [{ key: "queue_backlog:x", message: "still backed up" }],
    );
    assert.equal(sentAlerts.length, 0);
  });

  it("re-alerts once the cooldown window has fully elapsed", async () => {
    const staleAlertedAt = new Date(Date.now() - 2 * 60 * 60 * 1_000);
    const { db } = createFakeDb([{ _id: "queue_backlog:x", lastAlertedAt: staleAlertedAt }]);
    const { email, sentAlerts } = createFakeEmail();
    await dispatchAlerts(
      db,
      email,
      { ADMIN_EMAIL: "admin@example.com" },
      [{ key: "queue_backlog:x", message: "still backed up" }],
    );
    assert.equal(sentAlerts.length, 1);
  });
});
