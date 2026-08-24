DROP INDEX `managed_bots_telegram_id_unique`;--> statement-breakpoint
DROP INDEX `managed_bots_username_unique`;--> statement-breakpoint
DROP INDEX `managed_bots_owner_idx`;--> statement-breakpoint
ALTER TABLE `managed_bots` ADD `agent_role` text DEFAULT 'subagent' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `managed_bots_subagent_telegram_id_unique` ON `managed_bots` (`bot_telegram_user_id`) WHERE "managed_bots"."agent_role" = 'subagent';--> statement-breakpoint
CREATE UNIQUE INDEX `managed_bots_subagent_username_unique` ON `managed_bots` (`username`) WHERE "managed_bots"."agent_role" = 'subagent';--> statement-breakpoint
CREATE UNIQUE INDEX `managed_bots_manager_owner_unique` ON `managed_bots` (`owner_telegram_user_id`) WHERE "managed_bots"."agent_role" = 'manager';--> statement-breakpoint
CREATE INDEX `managed_bots_owner_idx` ON `managed_bots` (`owner_telegram_user_id`,`agent_role`);