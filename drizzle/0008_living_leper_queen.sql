CREATE TABLE `agent_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_telegram_user_id` text NOT NULL,
	`persona` text NOT NULL,
	`rules` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_settings_owner_unique` ON `agent_settings` (`owner_telegram_user_id`);