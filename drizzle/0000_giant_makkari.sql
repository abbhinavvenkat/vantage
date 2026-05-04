CREATE TABLE `accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`portfolio_id` text NOT NULL,
	`broker_id` text NOT NULL,
	`alias` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`portfolio_id`) REFERENCES `portfolios`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`broker_id`) REFERENCES `brokers`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `accounts_portfolio_idx` ON `accounts` (`portfolio_id`);--> statement-breakpoint
CREATE TABLE `brokers` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `brokers_code_ux` ON `brokers` (`code`);--> statement-breakpoint
CREATE TABLE `codex_backtests` (
	`id` text PRIMARY KEY NOT NULL,
	`rule_id` text NOT NULL,
	`universe` text NOT NULL,
	`period_start` text NOT NULL,
	`period_end` text NOT NULL,
	`n_signals` integer NOT NULL,
	`hit_rate` real,
	`avg_return` real,
	`max_dd` real,
	FOREIGN KEY (`rule_id`) REFERENCES `codex_rules`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `codex_distilled` (
	`id` text PRIMARY KEY NOT NULL,
	`investor_id` text NOT NULL,
	`kind` text NOT NULL,
	`json` text NOT NULL,
	`version` text NOT NULL,
	FOREIGN KEY (`investor_id`) REFERENCES `investors`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `codex_extracted` (
	`id` text PRIMARY KEY NOT NULL,
	`source_id` text NOT NULL,
	`anchor` text NOT NULL,
	`markdown_path` text NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `codex_sources`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `codex_rule_citations` (
	`id` text PRIMARY KEY NOT NULL,
	`rule_id` text NOT NULL,
	`source_id` text NOT NULL,
	`quote` text NOT NULL,
	`page_or_timestamp` text,
	FOREIGN KEY (`rule_id`) REFERENCES `codex_rules`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_id`) REFERENCES `codex_sources`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `codex_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`version_id` text NOT NULL,
	`statement` text NOT NULL,
	`action` text NOT NULL,
	`conditions_json` text NOT NULL,
	`weight` real DEFAULT 1 NOT NULL,
	`evidence_strength` text NOT NULL,
	`rationale_md` text,
	FOREIGN KEY (`version_id`) REFERENCES `codex_versions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `codex_sources` (
	`id` text PRIMARY KEY NOT NULL,
	`investor_id` text NOT NULL,
	`title` text NOT NULL,
	`url` text NOT NULL,
	`kind` text NOT NULL,
	`fetched_at` integer NOT NULL,
	`sha256` text,
	`license_note` text,
	FOREIGN KEY (`investor_id`) REFERENCES `investors`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `codex_style_weights` (
	`id` text PRIMARY KEY NOT NULL,
	`style_id` text NOT NULL,
	`rule_id` text NOT NULL,
	`weight` real NOT NULL,
	FOREIGN KEY (`style_id`) REFERENCES `investor_styles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`rule_id`) REFERENCES `codex_rules`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `codex_style_weights_style_rule_ux` ON `codex_style_weights` (`style_id`,`rule_id`);--> statement-breakpoint
CREATE TABLE `codex_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`semver` text NOT NULL,
	`created_at` integer NOT NULL,
	`notes_md` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `codex_versions_semver_ux` ON `codex_versions` (`semver`);--> statement-breakpoint
CREATE TABLE `corporate_actions` (
	`id` text PRIMARY KEY NOT NULL,
	`symbol` text NOT NULL,
	`ex_date` text NOT NULL,
	`type` text NOT NULL,
	`ratio` text,
	`notes` text,
	`source` text
);
--> statement-breakpoint
CREATE TABLE `decisions` (
	`id` text PRIMARY KEY NOT NULL,
	`portfolio_id` text NOT NULL,
	`symbol` text NOT NULL,
	`snapshot_at` integer NOT NULL,
	`action` text NOT NULL,
	`score` real NOT NULL,
	`rule_library_version` text NOT NULL,
	`payload_json` text NOT NULL,
	FOREIGN KEY (`portfolio_id`) REFERENCES `portfolios`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `events` (
	`id` text PRIMARY KEY NOT NULL,
	`symbol` text NOT NULL,
	`date` text NOT NULL,
	`type` text NOT NULL,
	`title` text NOT NULL,
	`url` text,
	`source` text
);
--> statement-breakpoint
CREATE TABLE `filings` (
	`id` text PRIMARY KEY NOT NULL,
	`symbol` text NOT NULL,
	`date` text NOT NULL,
	`type` text NOT NULL,
	`title` text NOT NULL,
	`url` text,
	`summary_md` text,
	`summary_skill_run_id` text,
	`read_at` integer
);
--> statement-breakpoint
CREATE TABLE `fx_rates` (
	`id` text PRIMARY KEY NOT NULL,
	`date` text NOT NULL,
	`base` text NOT NULL,
	`quote` text NOT NULL,
	`rate` real NOT NULL,
	`source` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `fx_rates_date_base_quote_ux` ON `fx_rates` (`date`,`base`,`quote`);--> statement-breakpoint
CREATE TABLE `instruments` (
	`symbol` text PRIMARY KEY NOT NULL,
	`isin` text,
	`name` text,
	`sector` text,
	`industry` text,
	`currency` text DEFAULT 'INR' NOT NULL,
	`listing_exchange` text,
	`country` text
);
--> statement-breakpoint
CREATE TABLE `investor_styles` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description_md` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `investor_styles_name_ux` ON `investor_styles` (`name`);--> statement-breakpoint
CREATE TABLE `investors` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`style_summary_md` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `investors_slug_ux` ON `investors` (`slug`);--> statement-breakpoint
CREATE TABLE `notes` (
	`id` text PRIMARY KEY NOT NULL,
	`portfolio_id` text NOT NULL,
	`symbol` text,
	`body_md` text NOT NULL,
	`tags` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`portfolio_id`) REFERENCES `portfolios`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `portfolios` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`base_currency` text DEFAULT 'INR' NOT NULL,
	`created_at` integer NOT NULL,
	`archived_at` integer
);
--> statement-breakpoint
CREATE TABLE `prices_eod` (
	`id` text PRIMARY KEY NOT NULL,
	`symbol` text NOT NULL,
	`date` text NOT NULL,
	`open` real,
	`high` real,
	`low` real,
	`close` real,
	`adj_close` real,
	`volume` real,
	`source` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `prices_eod_symbol_date_ux` ON `prices_eod` (`symbol`,`date`);--> statement-breakpoint
CREATE TABLE `research_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`portfolio_id` text,
	`symbol` text NOT NULL,
	`skill` text NOT NULL,
	`input_hash` text NOT NULL,
	`output_path` text,
	`output_json` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`portfolio_id`) REFERENCES `portfolios`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	`csrf_token` text NOT NULL,
	`ip_hash` text,
	`ua_hash` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `sessions_user_idx` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE TABLE `trades` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`symbol` text NOT NULL,
	`isin` text,
	`trade_date` text NOT NULL,
	`side` text NOT NULL,
	`qty` real NOT NULL,
	`price` real NOT NULL,
	`currency` text DEFAULT 'INR' NOT NULL,
	`exchange` text,
	`segment` text,
	`series` text,
	`trade_id` text,
	`order_id` text,
	`exec_time` text,
	`source_file_hash` text,
	`source_row_idx` integer,
	`is_intraday_pair_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trades_account_trade_id_ux` ON `trades` (`account_id`,`trade_id`);--> statement-breakpoint
CREATE INDEX `trades_account_symbol_date_idx` ON `trades` (`account_id`,`symbol`,`trade_date`);--> statement-breakpoint
CREATE TABLE `user_style_profile` (
	`id` text PRIMARY KEY NOT NULL,
	`portfolio_id` text NOT NULL,
	`style_id` text NOT NULL,
	`weight` real NOT NULL,
	FOREIGN KEY (`portfolio_id`) REFERENCES `portfolios`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`style_id`) REFERENCES `investor_styles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_style_profile_portfolio_style_ux` ON `user_style_profile` (`portfolio_id`,`style_id`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`password_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	`last_login_at` integer
);
--> statement-breakpoint
CREATE TABLE `watchlist` (
	`id` text PRIMARY KEY NOT NULL,
	`portfolio_id` text NOT NULL,
	`symbol` text NOT NULL,
	`added_at` integer NOT NULL,
	`thesis_md` text,
	`target_buy` real,
	`target_sell` real,
	`conviction` integer,
	`risk_notes` text,
	FOREIGN KEY (`portfolio_id`) REFERENCES `portfolios`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `watchlist_portfolio_symbol_ux` ON `watchlist` (`portfolio_id`,`symbol`);