CREATE TABLE `alert_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`portfolio_id` text NOT NULL,
	`symbol` text,
	`rule_type` text NOT NULL,
	`threshold` real NOT NULL,
	`enabled` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`portfolio_id`) REFERENCES `portfolios`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `alert_rules_portfolio_idx` ON `alert_rules` (`portfolio_id`);
--> statement-breakpoint
CREATE TABLE `alert_events` (
	`id` text PRIMARY KEY NOT NULL,
	`portfolio_id` text NOT NULL,
	`rule_id` text NOT NULL,
	`symbol` text NOT NULL,
	`triggered_at` text NOT NULL,
	`current_value` real NOT NULL,
	`trigger_value` real NOT NULL,
	`message` text NOT NULL,
	`is_acked` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`portfolio_id`) REFERENCES `portfolios`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`rule_id`) REFERENCES `alert_rules`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `alert_events_portfolio_idx` ON `alert_events` (`portfolio_id`);
--> statement-breakpoint
CREATE INDEX `alert_events_rule_idx` ON `alert_events` (`rule_id`);
