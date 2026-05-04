CREATE TABLE `cagr_plans` (
  `id` text PRIMARY KEY NOT NULL,
  `portfolio_id` text NOT NULL,
  `target_cagr_pct` real NOT NULL,
  `horizon_years` integer NOT NULL,
  `current_forecast_cagr` real NOT NULL,
  `proposed_forecast_cagr` real NOT NULL,
  `plan_json` text NOT NULL,
  `created_at` integer NOT NULL,
  FOREIGN KEY (`portfolio_id`) REFERENCES `portfolios`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `cagr_plans_portfolio_idx` ON `cagr_plans` (`portfolio_id`);
--> statement-breakpoint
CREATE INDEX `cagr_plans_portfolio_created_idx` ON `cagr_plans` (`portfolio_id`,`created_at`);
