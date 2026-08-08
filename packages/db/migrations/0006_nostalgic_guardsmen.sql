CREATE TABLE "inbound_message" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"channel_id" uuid,
	"channel_kind" varchar(20) DEFAULT 'email_webhook' NOT NULL,
	"external_id" varchar(255) NOT NULL,
	"from_name" text,
	"from_email" varchar(255),
	"from_phone" varchar(40),
	"subject" text,
	"body_text" text,
	"body_html" text,
	"raw_headers" jsonb,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" varchar(12) DEFAULT 'pending' NOT NULL,
	"parse_method" varchar(10) DEFAULT 'none' NOT NULL,
	"parsed" jsonb,
	"confidence" numeric(4, 3),
	"attachments" jsonb,
	"lead_id" uuid,
	"dedupe_reason" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lead_channel" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kind" varchar(20) DEFAULT 'email_webhook' NOT NULL,
	"name" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "lead" ADD COLUMN "inbound_message_id" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX "inbound_message_external_uq" ON "inbound_message" USING btree ("tenant_id","channel_kind","external_id");--> statement-breakpoint
CREATE INDEX "inbound_message_status_idx" ON "inbound_message" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "lead_channel_tenant_idx" ON "lead_channel" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "lead_channel_name_uq" ON "lead_channel" USING btree ("tenant_id","kind","name");--> statement-breakpoint
CREATE UNIQUE INDEX "lead_inbound_message_uq" ON "lead" USING btree ("tenant_id","inbound_message_id") WHERE inbound_message_id is not null;--> statement-breakpoint
ALTER TABLE "lead_channel" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "lead_channel";--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "lead_channel" USING (tenant_id = current_setting('app.current_tenant', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);--> statement-breakpoint
ALTER TABLE "inbound_message" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "inbound_message";--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "inbound_message" USING (tenant_id = current_setting('app.current_tenant', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_user') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "lead_channel" TO app_user;
    GRANT SELECT, INSERT, UPDATE, DELETE ON "inbound_message" TO app_user;
  END IF;
END $$;