CREATE TABLE `rebalance_targets` (
	`id` text PRIMARY KEY NOT NULL,
	`portfolio_id` text NOT NULL,
	`mode` text NOT NULL,
	`key` text NOT NULL,
	`target_pct` real NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`portfolio_id`) REFERENCES `portfolios`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `rebalance_targets_portfolio_mode_key_ux` ON `rebalance_targets` (`portfolio_id`,`mode`,`key`);--> statement-breakpoint
CREATE INDEX `rebalance_targets_portfolio_idx` ON `rebalance_targets` (`portfolio_id`);
