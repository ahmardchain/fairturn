ALTER TABLE `agent_settings` ADD `access_mode` text DEFAULT 'private' NOT NULL;--> statement-breakpoint
ALTER TABLE `agent_settings` ADD `respond_when_tagged` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `agent_settings` ADD `respond_when_replied` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `agent_settings` ADD `respond_when_relevant` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `agent_settings` ADD `see_other_bots` integer DEFAULT false NOT NULL;