CREATE TABLE `telegram_business_connections` (
	`id` text PRIMARY KEY NOT NULL,
	`managed_bot_id` text NOT NULL,
	`owner_telegram_user_id` text NOT NULL,
	`telegram_business_user_id` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`managed_bot_id`) REFERENCES `managed_bots`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `telegram_business_owner_idx` ON `telegram_business_connections` (`owner_telegram_user_id`);--> statement-breakpoint
CREATE INDEX `telegram_business_bot_enabled_idx` ON `telegram_business_connections` (`managed_bot_id`,`enabled`);