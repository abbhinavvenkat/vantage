PRAGMA foreign_keys=OFF;--> statement-breakpoint
DROP TABLE IF EXISTS `events`;--> statement-breakpoint
CREATE TABLE `events` (
	`id` text PRIMARY KEY NOT NULL,
	`portfolio_id` text NOT NULL,
	`symbol` text NOT NULL,
	`event_type` text NOT NULL,
	`event_date` text NOT NULL,
	`title` text NOT NULL,
	`notes` text,
	`source` text DEFAULT 'manual' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`portfolio_id`) REFERENCES `portfolios`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `events_portfolio_date_idx` ON `events` (`portfolio_id`,`event_date`);--> statement-breakpoint
CREATE INDEX `events_portfolio_symbol_idx` ON `events` (`portfolio_id`,`symbol`);--> statement-breakpoint
CREATE UNIQUE INDEX `events_dedupe_ux` ON `events` (`portfolio_id`,`symbol`,`event_type`,`event_date`,`title`);
