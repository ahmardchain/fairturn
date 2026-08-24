CREATE TABLE `automations` (
	`id` text PRIMARY KEY NOT NULL,
	`community_id` text NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`instruction` text NOT NULL,
	`target_chat_id` text,
	`target_label` text NOT NULL,
	`schedule_kind` text NOT NULL,
	`cron_expression` text NOT NULL,
	`timezone` text DEFAULT 'UTC' NOT NULL,
	`next_run_at` text,
	`last_run_at` text,
	`status` text DEFAULT 'active' NOT NULL,
	`requires_approval` integer DEFAULT true NOT NULL,
	`configuration_json` text DEFAULT '{}' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`community_id`) REFERENCES `communities`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `automations_community_status_idx` ON `automations` (`community_id`,`status`);--> statement-breakpoint
CREATE INDEX `automations_next_run_idx` ON `automations` (`status`,`next_run_at`);