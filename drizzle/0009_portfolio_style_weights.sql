CREATE TABLE `portfolio_style_weights` (
	`id` text PRIMARY KEY NOT NULL,
	`portfolio_id` text NOT NULL,
	`weights_json` text DEFAULT ('{}') NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`portfolio_id`) REFERENCES `portfolios`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `portfolio_style_weights_portfolio_ux` ON `portfolio_style_weights` (`portfolio_id`);
