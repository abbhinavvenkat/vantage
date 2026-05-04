CREATE TABLE `theses` (
	`id` text PRIMARY KEY NOT NULL,
	`portfolio_id` text NOT NULL,
	`symbol` text NOT NULL,
	`thesis_md` text DEFAULT '' NOT NULL,
	`checklist_json` text DEFAULT ('[]') NOT NULL,
	`entry_date` text,
	`target_review_date` text,
	`last_reviewed_at` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`portfolio_id`) REFERENCES `portfolios`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `theses_portfolio_symbol_ux` ON `theses` (`portfolio_id`,`symbol`);
