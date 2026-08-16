ALTER TABLE "order_item" ADD COLUMN "group_label" varchar(120);--> statement-breakpoint
ALTER TABLE "order_item" ADD COLUMN "attributes" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "quotation" ADD COLUMN "column_defs" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "quotation_item" ADD COLUMN "group_label" varchar(120);--> statement-breakpoint
ALTER TABLE "quotation_item" ADD COLUMN "attributes" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "sales_order" ADD COLUMN "column_defs" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "tax_invoice" ADD COLUMN "column_defs" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "tax_invoice_item" ADD COLUMN "group_label" varchar(120);--> statement-breakpoint
ALTER TABLE "tax_invoice_item" ADD COLUMN "attributes" jsonb DEFAULT '{}'::jsonb NOT NULL;