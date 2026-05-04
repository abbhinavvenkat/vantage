CREATE TABLE `candidates` (
	`id` text PRIMARY KEY NOT NULL,
	`portfolio_id` text NOT NULL,
	`run_id` text NOT NULL,
	`symbol` text NOT NULL,
	`name` text NOT NULL,
	`thesis_md` text DEFAULT '' NOT NULL,
	`conviction_level` text NOT NULL,
	`risk_level` text NOT NULL,
	`key_ratios_json` text DEFAULT '{}' NOT NULL,
	`entry_fair` real,
	`entry_strong` real,
	`matching_codex_rules_json` text DEFAULT '[]' NOT NULL,
	`run_at` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`portfolio_id`) REFERENCES `portfolios`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `candidates_portfolio_run_symbol_ux` ON `candidates` (`portfolio_id`,`run_id`,`symbol`);--> statement-breakpoint
CREATE INDEX `candidates_portfolio_idx` ON `candidates` (`portfolio_id`);--> statement-breakpoint
CREATE INDEX `candidates_portfolio_run_idx` ON `candidates` (`portfolio_id`,`run_id`);
