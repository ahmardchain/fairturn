CREATE TABLE `community_activity` (
	`id` text PRIMARY KEY NOT NULL,
	`community_id` text NOT NULL,
	`managed_bot_id` text NOT NULL,
	`telegram_user_id` text,
	`telegram_message_id` text,
	`event_type` text NOT NULL,
	`content_fingerprint` text,
	`primary_topic` text,
	`flagged` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`community_id`) REFERENCES `communities`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`managed_bot_id`) REFERENCES `managed_bots`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `community_activity_message_unique` ON `community_activity` (`managed_bot_id`,`telegram_message_id`,`event_type`);--> statement-breakpoint
CREATE INDEX `community_activity_report_idx` ON `community_activity` (`community_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `community_activity_fingerprint_idx` ON `community_activity` (`community_id`,`telegram_user_id`,`content_fingerprint`);--> statement-breakpoint
CREATE TABLE `community_commands` (
	`id` text PRIMARY KEY NOT NULL,
	`community_id` text NOT NULL,
	`managed_bot_id` text NOT NULL,
	`name` text NOT NULL,
	`handler` text NOT NULL,
	`admin_only` integer DEFAULT false NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_by_telegram_user_id` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`community_id`) REFERENCES `communities`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`managed_bot_id`) REFERENCES `managed_bots`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `community_commands_name_unique` ON `community_commands` (`community_id`,`name`);--> statement-breakpoint
CREATE INDEX `community_commands_bot_idx` ON `community_commands` (`managed_bot_id`,`enabled`);--> statement-breakpoint
CREATE TABLE `community_join_events` (
	`id` text PRIMARY KEY NOT NULL,
	`community_id` text NOT NULL,
	`managed_bot_id` text NOT NULL,
	`telegram_user_id` text NOT NULL,
	`update_id` text NOT NULL,
	`username_present` integer DEFAULT false NOT NULL,
	`bio_risk` integer DEFAULT false NOT NULL,
	`account_age_days` integer,
	`risk_flags_json` text DEFAULT '[]' NOT NULL,
	`decision` text DEFAULT 'observed' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`community_id`) REFERENCES `communities`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`managed_bot_id`) REFERENCES `managed_bots`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `community_join_update_user_unique` ON `community_join_events` (`managed_bot_id`,`update_id`,`telegram_user_id`);--> statement-breakpoint
CREATE INDEX `community_join_raid_window_idx` ON `community_join_events` (`community_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `community_knowledge` (
	`id` text PRIMARY KEY NOT NULL,
	`community_id` text NOT NULL,
	`managed_bot_id` text NOT NULL,
	`spark_id` text NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`source_type` text DEFAULT 'content' NOT NULL,
	`source_url` text,
	`content` text NOT NULL,
	`checksum` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_by_telegram_user_id` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`community_id`) REFERENCES `communities`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`managed_bot_id`) REFERENCES `managed_bots`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `community_knowledge_checksum_unique` ON `community_knowledge` (`community_id`,`checksum`);--> statement-breakpoint
CREATE INDEX `community_knowledge_agent_kind_idx` ON `community_knowledge` (`managed_bot_id`,`kind`,`status`);--> statement-breakpoint
CREATE INDEX `community_knowledge_community_idx` ON `community_knowledge` (`community_id`,`status`);--> statement-breakpoint
CREATE TABLE `community_members` (
	`id` text PRIMARY KEY NOT NULL,
	`community_id` text NOT NULL,
	`telegram_user_id` text NOT NULL,
	`display_alias` text NOT NULL,
	`username` text,
	`detected_language` text,
	`role` text DEFAULT 'member' NOT NULL,
	`preferences_json` text DEFAULT '{}' NOT NULL,
	`faq_topics_json` text DEFAULT '[]' NOT NULL,
	`offense_count` integer DEFAULT 0 NOT NULL,
	`message_count` integer DEFAULT 0 NOT NULL,
	`joined_at` text,
	`last_offense_at` text,
	`last_seen_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`community_id`) REFERENCES `communities`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `community_members_user_unique` ON `community_members` (`community_id`,`telegram_user_id`);--> statement-breakpoint
CREATE INDEX `community_members_activity_idx` ON `community_members` (`community_id`,`message_count`);