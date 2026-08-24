CREATE TABLE `agent_creation_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_telegram_user_id` text NOT NULL,
	`template_id` text NOT NULL,
	`requested_name` text NOT NULL,
	`requested_username` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `agent_creation_owner_status_idx` ON `agent_creation_requests` (`owner_telegram_user_id`,`status`);--> statement-breakpoint
CREATE INDEX `agent_creation_username_idx` ON `agent_creation_requests` (`requested_username`);--> statement-breakpoint
CREATE TABLE `managed_bots` (
	`id` text PRIMARY KEY NOT NULL,
	`creation_request_id` text,
	`owner_telegram_user_id` text NOT NULL,
	`bot_telegram_user_id` text NOT NULL,
	`template_id` text NOT NULL,
	`display_name` text NOT NULL,
	`username` text NOT NULL,
	`token_ciphertext` text,
	`token_iv` text,
	`webhook_secret_hash` text,
	`status` text DEFAULT 'provisioning' NOT NULL,
	`last_error` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`creation_request_id`) REFERENCES `agent_creation_requests`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `managed_bots_telegram_id_unique` ON `managed_bots` (`bot_telegram_user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `managed_bots_username_unique` ON `managed_bots` (`username`);--> statement-breakpoint
CREATE UNIQUE INDEX `managed_bots_webhook_hash_unique` ON `managed_bots` (`webhook_secret_hash`);--> statement-breakpoint
CREATE INDEX `managed_bots_owner_idx` ON `managed_bots` (`owner_telegram_user_id`);