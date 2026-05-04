PRAGMA foreign_keys=OFF;--> statement-breakpoint
DROP TABLE IF EXISTS `watchlist`;--> statement-breakpoint
CREATE TABLE `watchlist` (
	`id` text PRIMARY KEY NOT NULL,
	`portfolio_id` text NOT NULL,
	`symbol` text NOT NULL,
	`thesis` text,
	`target_buy_price` real,
	`target_sell_price` real,
	`conviction` text DEFAULT 'medium' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`portfolio_id`) REFERENCES `portfolios`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `watchlist_portfolio_symbol_ux` ON `watchlist` (`portfolio_id`,`symbol`);