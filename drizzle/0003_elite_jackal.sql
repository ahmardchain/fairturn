CREATE TABLE `moderation_actions` (
	`id` text PRIMARY KEY NOT NULL,
	`community_id` text NOT NULL,
	`managed_bot_id` text NOT NULL,
	`owner_telegram_user_id` text NOT NULL,
	`chat_id` text NOT NULL,
	`target_user_id` text,
	`message_id` text,
	`action` text NOT NULL,
	`reason` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`approved_by_telegram_user_id` text NOT NULL,
	`telegram_result_json` text DEFAULT '{}' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`community_id`) REFERENCES `communities`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`managed_bot_id`) REFERENCES `managed_bots`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `moderation_actions_owner_idx` ON `moderation_actions` (`owner_telegram_user_id`);--> statement-breakpoint
CREATE INDEX `moderation_actions_chat_idx` ON `moderation_actions` (`chat_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `moderation_actions_status_idx` ON `moderation_actions` (`status`);--> statement-breakpoint
ALTER TABLE `inbox_items` ADD `managed_bot_id` text;--> statement-breakpoint
ALTER TABLE `inbox_items` ADD `owner_telegram_user_id` text;--> statement-breakpoint
CREATE INDEX `inbox_items_owner_source_idx` ON `inbox_items` (`owner_telegram_user_id`,`source`);--> statement-breakpoint
CREATE INDEX `inbox_items_managed_bot_idx` ON `inbox_items` (`managed_bot_id`);