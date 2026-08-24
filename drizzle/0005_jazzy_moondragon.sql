CREATE TABLE `agent_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`community_id` text NOT NULL,
	`inbox_item_id` text,
	`managed_bot_id` text,
	`owner_telegram_user_id` text,
	`source` text NOT NULL,
	`external_update_id` text,
	`conversation_alias` text,
	`resolver_mode` text NOT NULL,
	`minds_configured` integer DEFAULT false NOT NULL,
	`mind_reply_fingerprint` text,
	`memory_read_count` integer DEFAULT 0 NOT NULL,
	`memory_references_json` text DEFAULT '[]' NOT NULL,
	`memory_write_succeeded` integer DEFAULT false NOT NULL,
	`category` text NOT NULL,
	`proposed_action` text NOT NULL,
	`action_status` text DEFAULT 'awaiting_human' NOT NULL,
	`failure_code` text,
	`raw_content_stored` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`community_id`) REFERENCES `communities`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`inbox_item_id`) REFERENCES `inbox_items`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`managed_bot_id`) REFERENCES `managed_bots`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `agent_runs_mode_created_idx` ON `agent_runs` (`resolver_mode`,`created_at`);--> statement-breakpoint
CREATE INDEX `agent_runs_owner_created_idx` ON `agent_runs` (`owner_telegram_user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `agent_runs_bot_created_idx` ON `agent_runs` (`managed_bot_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `automation_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`automation_id` text NOT NULL,
	`community_id` text NOT NULL,
	`managed_bot_id` text NOT NULL,
	`owner_telegram_user_id` text NOT NULL,
	`kind` text NOT NULL,
	`scheduled_for` text NOT NULL,
	`content_json` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`requires_approval` integer DEFAULT true NOT NULL,
	`approved_by_telegram_user_id` text,
	`telegram_result_json` text DEFAULT '{}' NOT NULL,
	`failure_reason` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`automation_id`) REFERENCES `automations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`community_id`) REFERENCES `communities`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`managed_bot_id`) REFERENCES `managed_bots`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `automation_runs_schedule_unique` ON `automation_runs` (`automation_id`,`scheduled_for`);--> statement-breakpoint
CREATE INDEX `automation_runs_owner_status_idx` ON `automation_runs` (`owner_telegram_user_id`,`status`);--> statement-breakpoint
CREATE INDEX `automation_runs_automation_idx` ON `automation_runs` (`automation_id`);--> statement-breakpoint
CREATE TABLE `giveaway_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`automation_run_id` text NOT NULL,
	`telegram_user_id` text NOT NULL,
	`display_alias` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`automation_run_id`) REFERENCES `automation_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `giveaway_entries_run_user_unique` ON `giveaway_entries` (`automation_run_id`,`telegram_user_id`);--> statement-breakpoint
CREATE INDEX `giveaway_entries_run_idx` ON `giveaway_entries` (`automation_run_id`);--> statement-breakpoint
CREATE TABLE `memory_feedback` (
	`id` text PRIMARY KEY NOT NULL,
	`community_id` text NOT NULL,
	`inbox_item_id` text NOT NULL,
	`managed_bot_id` text NOT NULL,
	`owner_telegram_user_id` text NOT NULL,
	`scope` text NOT NULL,
	`subject_id` text NOT NULL,
	`original_category` text NOT NULL,
	`corrected_category` text NOT NULL,
	`rationale` text NOT NULL,
	`supabase_status` text DEFAULT 'pending' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`community_id`) REFERENCES `communities`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`inbox_item_id`) REFERENCES `inbox_items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`managed_bot_id`) REFERENCES `managed_bots`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `memory_feedback_owner_idx` ON `memory_feedback` (`owner_telegram_user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `memory_feedback_subject_idx` ON `memory_feedback` (`managed_bot_id`,`scope`,`subject_id`);--> statement-breakpoint
CREATE TABLE `telegram_updates` (
	`id` text PRIMARY KEY NOT NULL,
	`bot_scope_id` text NOT NULL,
	`update_id` text NOT NULL,
	`update_kind` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `telegram_updates_scope_update_unique` ON `telegram_updates` (`bot_scope_id`,`update_id`);--> statement-breakpoint
CREATE INDEX `telegram_updates_created_idx` ON `telegram_updates` (`created_at`);--> statement-breakpoint
ALTER TABLE `automations` ADD `managed_bot_id` text;--> statement-breakpoint
ALTER TABLE `automations` ADD `owner_telegram_user_id` text;--> statement-breakpoint
CREATE INDEX `automations_owner_idx` ON `automations` (`owner_telegram_user_id`);--> statement-breakpoint
CREATE INDEX `automations_managed_bot_idx` ON `automations` (`managed_bot_id`);--> statement-breakpoint
ALTER TABLE `communities` ADD `owner_telegram_user_id` text;--> statement-breakpoint
ALTER TABLE `communities` ADD `managed_bot_id` text;--> statement-breakpoint
CREATE UNIQUE INDEX `communities_owner_chat_unique` ON `communities` (`owner_telegram_user_id`,`telegram_chat_id`);--> statement-breakpoint
CREATE INDEX `communities_managed_bot_idx` ON `communities` (`managed_bot_id`);