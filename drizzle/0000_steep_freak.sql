CREATE TABLE `flight_commands` (
	`room_id` text NOT NULL,
	`player_id` text NOT NULL,
	`action_id` text NOT NULL,
	`fingerprint` text NOT NULL,
	`result` text NOT NULL,
	`expires_at` integer NOT NULL,
	PRIMARY KEY(`room_id`, `player_id`, `action_id`)
);
--> statement-breakpoint
CREATE TABLE `flight_guests` (
	`id` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`profile` text NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `flight_guests_token_hash_unique` ON `flight_guests` (`token_hash`);--> statement-breakpoint
CREATE TABLE `flight_limits` (
	`id` text PRIMARY KEY NOT NULL,
	`bucket` integer NOT NULL,
	`hits` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `flight_presence` (
	`room_id` text NOT NULL,
	`player_id` text NOT NULL,
	`last_seen` integer NOT NULL,
	PRIMARY KEY(`room_id`, `player_id`)
);
--> statement-breakpoint
CREATE TABLE `flight_rooms` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`revision` integer NOT NULL,
	`document` text NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `flight_rooms_code_unique` ON `flight_rooms` (`code`);