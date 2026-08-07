CREATE TABLE "payment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"paid_on" timestamp with time zone DEFAULT now() NOT NULL,
	"method" varchar(16) DEFAULT 'bank' NOT NULL,
	"reference" varchar(60),
	"notes" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tax_invoice" ADD COLUMN "due_date" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "payment_tenant_idx" ON "payment" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "payment_invoice_idx" ON "payment" USING btree ("invoice_id");