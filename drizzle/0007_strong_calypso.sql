ALTER TABLE `community_knowledge` ADD `source_file_name` text;--> statement-breakpoint
ALTER TABLE `community_knowledge` ADD `source_mime_type` text;--> statement-breakpoint
ALTER TABLE `community_knowledge` ADD `source_object_key` text;--> statement-breakpoint
ALTER TABLE `community_knowledge` ADD `source_bytes` integer;--> statement-breakpoint
ALTER TABLE `community_knowledge` ADD `learning_mode` text DEFAULT 'mini_app' NOT NULL;--> statement-breakpoint
ALTER TABLE `community_knowledge` ADD `source_message_id` text;