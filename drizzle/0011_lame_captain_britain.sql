CREATE TABLE `managed_agent_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`managed_bot_id` text NOT NULL,
	`owner_telegram_user_id` text NOT NULL,
	`persona` text DEFAULT '' NOT NULL,
	`rules` text DEFAULT '' NOT NULL,
	`welcome_message` text DEFAULT '' NOT NULL,
	`access_mode` text DEFAULT 'private' NOT NULL,
	`respond_when_tagged` integer DEFAULT true NOT NULL,
	`respond_when_replied` integer DEFAULT true NOT NULL,
	`respond_when_relevant` integer DEFAULT false NOT NULL,
	`see_other_bots` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`managed_bot_id`) REFERENCES `managed_bots`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `managed_agent_settings_bot_unique` ON `managed_agent_settings` (`managed_bot_id`);--> statement-breakpoint
CREATE INDEX `managed_agent_settings_owner_idx` ON `managed_agent_settings` (`owner_telegram_user_id`,`updated_at`);