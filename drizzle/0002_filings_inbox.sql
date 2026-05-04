PRAGMA foreign_keys=OFF;--> statement-breakpoint
DROP TABLE IF EXISTS `filings`;--> statement-breakpoint
CREATE TABLE `filings` (
	`id` text PRIMARY KEY NOT NULL,
	`portfolio_id` text NOT NULL,
	`symbol` text NOT NULL,
	`url` text NOT NULL,
	`title` text NOT NULL,
	`filing_type` text NOT NULL,
	`triage` text,
	`summary_one_line` text,
	`published_at` text,
	`is_read` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`portfolio_id`) REFERENCES `portfolios`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `filings_portfolio_url_ux` ON `filings` (`portfolio_id`,`url`);--> statement-breakpoint
CREATE INDEX `filings_portfolio_symbol_idx` ON `filings` (`portfolio_id`,`symbol`);--> statement-breakpoint
CREATE INDEX `filings_portfolio_read_idx` ON `filings` (`portfolio_id`,`is_read`);
