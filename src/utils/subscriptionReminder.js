"use strict";
const cron = require("node-cron");
const User = require("../models/User");
const { sendExpiryReminderEmail } = require("../services/email.service");
const logger = require("./logger");

/**
 * Every day at 8 AM IST (2:30 AM UTC), find Pro users whose subscription
 * expires in exactly 7 days or 1 day and send them a reminder email.
 */
const scheduleSubscriptionReminders = () => {
  cron.schedule("30 2 * * *", async () => {
    logger.info("Running subscription expiry reminder check…");
    try {
      const now   = new Date();
      const check = [7, 1]; // days before expiry to notify

      for (const days of check) {
        const windowStart = new Date(now.getTime() + (days - 1) * 86_400_000);
        const windowEnd   = new Date(now.getTime() + days       * 86_400_000);

        const users = await User.find({
          "subscription.status":          "active",
          "subscription.plan":            { $in: ["monthly", "yearly"] },
          "subscription.currentPeriodEnd": { $gte: windowStart, $lt: windowEnd },
        }).select("name email subscription").lean();

        logger.info(`Expiry reminder (${days}d): ${users.length} user(s) to notify`);

        for (const user of users) {
          await sendExpiryReminderEmail(user, days);
        }
      }
    } catch (err) {
      logger.error("Subscription reminder cron failed:", err.message);
    }
  });

  logger.info("Subscription expiry reminder cron scheduled (daily 08:00 IST)");
};

module.exports = { scheduleSubscriptionReminders };
