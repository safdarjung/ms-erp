CREATE TABLE "ai_action" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" varchar(40) NOT NULL,
	"payload" jsonb NOT NULL,
	"summary" text NOT NULL,
	"status" varchar(12) DEFAULT 'pending' NOT NULL,
	"result" jsonb,
	"error" text,
	"expires_at" timestamp with time zone NOT NULL,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "ai_action_tenant_idx" ON "ai_action" USING btree ("tenant_id","created_at");