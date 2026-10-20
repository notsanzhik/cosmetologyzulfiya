CREATE TABLE `telegram_pairings` (
	`id` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`username` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`chat_id` text,
	`owner_id` text,
	`connected_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `telegram_pairings_token_hash_unique` ON `telegram_pairings` (`token_hash`);