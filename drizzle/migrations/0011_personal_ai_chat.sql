CREATE TABLE `assistant_messages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_email` text NOT NULL,
	`role` text NOT NULL,
	`body` text NOT NULL,
	`product_ids` text DEFAULT '[]' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `assistant_messages_user_id_idx` ON `assistant_messages` (`user_email`,`id`);
