CREATE TABLE `dividends` (
  `id` text PRIMARY KEY NOT NULL,
  `portfolio_id` text NOT NULL,
  `symbol` text NOT NULL,
  `isin` text,
  `ex_date` text NOT NULL,
  `qty` real NOT NULL,
  `dividend_per_share` real NOT NULL,
  `net_amount` real NOT NULL,
  `currency` text DEFAULT 'INR' NOT NULL,
  `source_file_hash` text,
  `created_at` integer NOT NULL,
  FOREIGN KEY (`portfolio_id`) REFERENCES `portfolios`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `dividends_portfolio_symbol_date_amount_ux` ON `dividends` (`portfolio_id`,`symbol`,`ex_date`,`qty`,`net_amount`);
--> statement-breakpoint
CREATE INDEX `dividends_portfolio_idx` ON `dividends` (`portfolio_id`);
