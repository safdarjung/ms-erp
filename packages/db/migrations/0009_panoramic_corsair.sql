CREATE TABLE "ai_briefing" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"day" varchar(10) NOT NULL,
	"content" text NOT NULL,
	"facts" jsonb,
	"model" varchar(60),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "ai_briefing_day_uq" ON "ai_briefing" USING btree ("tenant_id","day");--> statement-breakpoint
ALTER TABLE "ai_briefing" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "ai_briefing";--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "ai_briefing" USING (tenant_id = current_setting('app.current_tenant', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_user') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "ai_briefing" TO app_user;
  END IF;
END $$;
