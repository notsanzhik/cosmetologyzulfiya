CREATE TABLE `reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`body` text NOT NULL,
	`lang` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`image_data` text,
	`image_type` text,
	`created_at` integer NOT NULL,
	`consent_at` integer NOT NULL
);
