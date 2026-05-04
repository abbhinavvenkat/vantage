CREATE TABLE `news_items` (
	`id` text PRIMARY KEY NOT NULL,
	`portfolio_id` text NOT NULL,
	`symbol` text NOT NULL,
	`title` text NOT NULL,
	`url` text NOT NULL,
	`published_at` text,
	`source` text,
	`is_read` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`portfolio_id`) REFERENCES `portfolios`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `news_items_portfolio_url_ux` ON `news_items` (`portfolio_id`,`url`);--> statement-breakpoint
CREATE INDEX `news_items_portfolio_symbol_idx` ON `news_items` (`portfolio_id`,`symbol`);--> statement-breakpoint
CREATE INDEX `news_items_portfolio_read_idx` ON `news_items` (`portfolio_id`,`is_read`);
