CREATE TABLE `audit_events` (
	`id` text PRIMARY KEY NOT NULL,
	`community_id` text NOT NULL,
	`actor_type` text NOT NULL,
	`actor_id` text,
	`action` text NOT NULL,
	`subject_type` text NOT NULL,
	`subject_id` text,
	`detail_json` text DEFAULT '{}' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`community_id`) REFERENCES `communities`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `audit_events_community_idx` ON `audit_events` (`community_id`);--> statement-breakpoint
CREATE TABLE `communities` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`platform` text DEFAULT 'telegram' NOT NULL,
	`telegram_chat_id` text,
	`retention_days` integer DEFAULT 30 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `decisions` (
	`id` text PRIMARY KEY NOT NULL,
	`community_id` text NOT NULL,
	`inbox_item_id` text,
	`kind` text NOT NULL,
	`question` text NOT NULL,
	`rationale` text NOT NULL,
	`proposal` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`approved_by` text,
	`expires_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`community_id`) REFERENCES `communities`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`inbox_item_id`) REFERENCES `inbox_items`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `decisions_community_idx` ON `decisions` (`community_id`);--> statement-breakpoint
CREATE TABLE `followups` (
	`id` text PRIMARY KEY NOT NULL,
	`community_id` text NOT NULL,
	`inbox_item_id` text,
	`instruction` text NOT NULL,
	`scheduled_for` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`completed_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`community_id`) REFERENCES `communities`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`inbox_item_id`) REFERENCES `inbox_items`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `followups_due_idx` ON `followups` (`status`,`scheduled_for`);--> statement-breakpoint
CREATE TABLE `inbox_items` (
	`id` text PRIMARY KEY NOT NULL,
	`community_id` text NOT NULL,
	`source` text DEFAULT 'telegram' NOT NULL,
	`external_chat_id` text,
	`external_message_id` text,
	`business_connection_id` text,
	`sender_alias` text NOT NULL,
	`summary` text NOT NULL,
	`category` text NOT NULL,
	`urgency` text NOT NULL,
	`risk_level` text DEFAULT 'low' NOT NULL,
	`estimated_value` text,
	`requires_approval` integer DEFAULT true NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`assigned_moderator_id` text,
	`expires_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`community_id`) REFERENCES `communities`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`assigned_moderator_id`) REFERENCES `moderators`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `inbox_items_community_idx` ON `inbox_items` (`community_id`);--> statement-breakpoint
CREATE INDEX `inbox_items_status_idx` ON `inbox_items` (`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `inbox_items_external_unique` ON `inbox_items` (`source`,`external_chat_id`,`external_message_id`);--> statement-breakpoint
CREATE TABLE `moderators` (
	`id` text PRIMARY KEY NOT NULL,
	`community_id` text NOT NULL,
	`display_name` text NOT NULL,
	`role` text NOT NULL,
	`capacity_percent` integer DEFAULT 50 NOT NULL,
	`boundaries_json` text DEFAULT '[]' NOT NULL,
	`availability_json` text DEFAULT '{}' NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`community_id`) REFERENCES `communities`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `moderators_community_idx` ON `moderators` (`community_id`);--> statement-breakpoint
CREATE TABLE `pacts` (
	`id` text PRIMARY KEY NOT NULL,
	`community_id` text NOT NULL,
	`version` integer NOT NULL,
	`rules_json` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`approved_by` text,
	`approved_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`community_id`) REFERENCES `communities`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pacts_community_version_unique` ON `pacts` (`community_id`,`version`);