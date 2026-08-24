CREATE TABLE `telegram_poll_votes` (
	`id` text PRIMARY KEY NOT NULL,
	`telegram_poll_id` text NOT NULL,
	`voter_key` text NOT NULL,
	`telegram_user_id` text,
	`voter_chat_id` text,
	`display_alias` text NOT NULL,
	`username` text,
	`option_ids_json` text DEFAULT '[]' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`telegram_poll_id`) REFERENCES `telegram_polls`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `telegram_poll_votes_poll_voter_unique` ON `telegram_poll_votes` (`telegram_poll_id`,`voter_key`);--> statement-breakpoint
CREATE INDEX `telegram_poll_votes_poll_idx` ON `telegram_poll_votes` (`telegram_poll_id`);--> statement-breakpoint
CREATE TABLE `telegram_polls` (
	`id` text PRIMARY KEY NOT NULL,
	`automation_run_id` text,
	`community_id` text NOT NULL,
	`managed_bot_id` text NOT NULL,
	`owner_telegram_user_id` text NOT NULL,
	`telegram_poll_id` text NOT NULL,
	`telegram_chat_id` text NOT NULL,
	`telegram_message_id` text NOT NULL,
	`question` text NOT NULL,
	`options_json` text DEFAULT '[]' NOT NULL,
	`type` text DEFAULT 'regular' NOT NULL,
	`is_anonymous` integer DEFAULT false NOT NULL,
	`allows_multiple_answers` integer DEFAULT false NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`total_voter_count` integer DEFAULT 0 NOT NULL,
	`closes_at` text,
	`result_json` text DEFAULT '{}' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`automation_run_id`) REFERENCES `automation_runs`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`community_id`) REFERENCES `communities`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`managed_bot_id`) REFERENCES `managed_bots`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `telegram_polls_bot_poll_unique` ON `telegram_polls` (`managed_bot_id`,`telegram_poll_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `telegram_polls_bot_message_unique` ON `telegram_polls` (`managed_bot_id`,`telegram_chat_id`,`telegram_message_id`);--> statement-breakpoint
CREATE INDEX `telegram_polls_chat_created_idx` ON `telegram_polls` (`managed_bot_id`,`telegram_chat_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `telegram_polls_automation_run_idx` ON `telegram_polls` (`automation_run_id`);