CREATE TABLE `bookings` (
	`id` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`request_hash` text NOT NULL,
	`name` text NOT NULL,
	`phone` text NOT NULL,
	`lang` text NOT NULL,
	`services` text NOT NULL,
	`total` integer NOT NULL,
	`duration` integer NOT NULL,
	`start_at` integer NOT NULL,
	`end_at` integer NOT NULL,
	`reserved_until` integer NOT NULL,
	`status` text DEFAULT 'confirmed' NOT NULL,
	`consent_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`cancelled_at` integer
);
--> statement-breakpoint
CREATE INDEX `bookings_start_idx` ON `bookings` (`start_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `bookings_token_idx` ON `bookings` (`token_hash`);--> statement-breakpoint
CREATE TABLE `cancel_confirmations` (
	`nonce` text PRIMARY KEY NOT NULL,
	`booking_id` text NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`booking_id` text NOT NULL,
	`kind` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`due_at` integer NOT NULL,
	`claimed_at` integer,
	`claim_token` text,
	`provider_id` text,
	`delivery` text,
	`error` text,
	FOREIGN KEY (`booking_id`) REFERENCES `bookings`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `notification_once_idx` ON `notifications` (`booking_id`,`kind`);--> statement-breakpoint
CREATE INDEX `notification_due_idx` ON `notifications` (`status`,`due_at`);--> statement-breakpoint
CREATE TABLE `occupancy` (
	`start_at` integer PRIMARY KEY NOT NULL,
	`booking_id` text NOT NULL,
	FOREIGN KEY (`booking_id`) REFERENCES `bookings`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `occupancy_booking_idx` ON `occupancy` (`booking_id`);--> statement-breakpoint
CREATE TABLE `rate_limits` (
	`key` text PRIMARY KEY NOT NULL,
	`count` integer NOT NULL,
	`expires_at` integer NOT NULL
);
