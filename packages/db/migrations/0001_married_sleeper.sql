CREATE TABLE "doc_sequence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"doc_type" varchar(20) NOT NULL,
	"fy" varchar(7) NOT NULL,
	"prefix" varchar(12) NOT NULL,
	"next_number" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"seq" integer DEFAULT 1 NOT NULL,
	"description" text NOT NULL,
	"hsn" varchar(10),
	"qty" numeric(12, 3) DEFAULT '1' NOT NULL,
	"uom" varchar(10) DEFAULT 'NOS' NOT NULL,
	"rate" numeric(14, 2) DEFAULT '0' NOT NULL,
	"gst_rate" numeric(5, 2) DEFAULT '18' NOT NULL,
	"taxable_value" numeric(14, 2) DEFAULT '0' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quotation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"number" varchar(30) NOT NULL,
	"doc_date" timestamp with time zone DEFAULT now() NOT NULL,
	"customer_id" uuid NOT NULL,
	"status" varchar(20) DEFAULT 'draft' NOT NULL,
	"place_of_supply" varchar(2),
	"is_interstate" boolean DEFAULT false NOT NULL,
	"subtotal" numeric(14, 2) DEFAULT '0' NOT NULL,
	"cgst" numeric(14, 2) DEFAULT '0' NOT NULL,
	"sgst" numeric(14, 2) DEFAULT '0' NOT NULL,
	"igst" numeric(14, 2) DEFAULT '0' NOT NULL,
	"grand_total" numeric(14, 2) DEFAULT '0' NOT NULL,
	"validity_days" integer DEFAULT 15 NOT NULL,
	"terms" text,
	"notes" text,
	"converted_order_id" uuid,
	"converted_invoice_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quotation_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"quotation_id" uuid NOT NULL,
	"seq" integer DEFAULT 1 NOT NULL,
	"description" text NOT NULL,
	"hsn" varchar(10),
	"qty" numeric(12, 3) DEFAULT '1' NOT NULL,
	"uom" varchar(10) DEFAULT 'NOS' NOT NULL,
	"rate" numeric(14, 2) DEFAULT '0' NOT NULL,
	"gst_rate" numeric(5, 2) DEFAULT '18' NOT NULL,
	"taxable_value" numeric(14, 2) DEFAULT '0' NOT NULL,
	"is_tooling_charge" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sales_order" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"number" varchar(30) NOT NULL,
	"doc_date" timestamp with time zone DEFAULT now() NOT NULL,
	"customer_id" uuid NOT NULL,
	"quotation_id" uuid,
	"po_ref" varchar(40),
	"order_category" varchar(20) DEFAULT 'tool_build' NOT NULL,
	"material_ownership" varchar(12) DEFAULT 'customer' NOT NULL,
	"status" varchar(20) DEFAULT 'open' NOT NULL,
	"delivery_date" timestamp with time zone,
	"total_value" numeric(14, 2) DEFAULT '0' NOT NULL,
	"converted_invoice_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tax_invoice" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"number" varchar(30) NOT NULL,
	"doc_date" timestamp with time zone DEFAULT now() NOT NULL,
	"type" varchar(20) DEFAULT 'tax_invoice' NOT NULL,
	"customer_id" uuid NOT NULL,
	"quotation_id" uuid,
	"order_id" uuid,
	"po_ref" varchar(40),
	"place_of_supply" varchar(2),
	"is_interstate" boolean DEFAULT false NOT NULL,
	"reverse_charge" boolean DEFAULT false NOT NULL,
	"subtotal" numeric(14, 2) DEFAULT '0' NOT NULL,
	"cgst" numeric(14, 2) DEFAULT '0' NOT NULL,
	"sgst" numeric(14, 2) DEFAULT '0' NOT NULL,
	"igst" numeric(14, 2) DEFAULT '0' NOT NULL,
	"round_off" numeric(8, 2) DEFAULT '0' NOT NULL,
	"grand_total" numeric(14, 2) DEFAULT '0' NOT NULL,
	"irn" text,
	"ack_no" varchar(40),
	"ack_date" timestamp with time zone,
	"signed_qr" text,
	"eway_bill_no" varchar(20),
	"status" varchar(20) DEFAULT 'issued' NOT NULL,
	"terms" text,
	"notes" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tax_invoice_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"seq" integer DEFAULT 1 NOT NULL,
	"description" text NOT NULL,
	"hsn" varchar(10),
	"qty" numeric(12, 3) DEFAULT '1' NOT NULL,
	"uom" varchar(10) DEFAULT 'NOS' NOT NULL,
	"rate" numeric(14, 2) DEFAULT '0' NOT NULL,
	"gst_rate" numeric(5, 2) DEFAULT '18' NOT NULL,
	"taxable_value" numeric(14, 2) DEFAULT '0' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "doc_sequence_uq" ON "doc_sequence" USING btree ("tenant_id","doc_type","fy");--> statement-breakpoint
CREATE INDEX "order_item_o_idx" ON "order_item" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "quotation_tenant_idx" ON "quotation" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "quotation_item_q_idx" ON "quotation_item" USING btree ("quotation_id");--> statement-breakpoint
CREATE INDEX "sales_order_tenant_idx" ON "sales_order" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "tax_invoice_tenant_idx" ON "tax_invoice" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "tax_invoice_item_i_idx" ON "tax_invoice_item" USING btree ("invoice_id");