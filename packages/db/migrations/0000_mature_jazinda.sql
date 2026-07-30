CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid,
	"entity_type" varchar(60) NOT NULL,
	"entity_id" uuid,
	"action" varchar(40) NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "branch" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"gstin" varchar(15),
	"state_code" varchar(2),
	"address" text,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customer" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" varchar(30),
	"name" text NOT NULL,
	"reg_type" varchar(20) DEFAULT 'unregistered' NOT NULL,
	"gstin" varchar(15),
	"state_code" varchar(2),
	"contact_person" text,
	"phone" varchar(20),
	"email" varchar(255),
	"credit_terms_days" integer DEFAULT 0 NOT NULL,
	"credit_limit" numeric(14, 2),
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lead" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"source" varchar(80),
	"customer_name" text NOT NULL,
	"contact" text,
	"phone" varchar(20),
	"email" varchar(255),
	"requirement" text,
	"stage" varchar(20) DEFAULT 'new' NOT NULL,
	"owner_user_id" uuid,
	"value_estimate" numeric(14, 2),
	"next_followup_at" timestamp with time zone,
	"converted_customer_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lead_activity" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"type" varchar(20) DEFAULT 'note' NOT NULL,
	"notes" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"by_user_id" uuid
);
--> statement-breakpoint
CREATE TABLE "permission" (
	"key" varchar(60) PRIMARY KEY NOT NULL,
	"description" text
);
--> statement-breakpoint
CREATE TABLE "role" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" varchar(50) NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "role_permission" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"permission_key" varchar(60) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenant" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"legal_name" text,
	"subdomain" varchar(63),
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"fy_start" varchar(5) DEFAULT '04-01' NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_role" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"email" varchar(255) NOT NULL,
	"password_hash" text NOT NULL,
	"phone" varchar(20),
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"locale" varchar(5) DEFAULT 'en' NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "audit_tenant_idx" ON "audit_log" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "branch_tenant_idx" ON "branch" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "customer_tenant_idx" ON "customer" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "lead_tenant_idx" ON "lead" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "lead_stage_idx" ON "lead" USING btree ("tenant_id","stage");--> statement-breakpoint
CREATE INDEX "lead_activity_lead_idx" ON "lead_activity" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "role_tenant_idx" ON "role" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "role_permission_uq" ON "role_permission" USING btree ("role_id","permission_key");--> statement-breakpoint
CREATE INDEX "role_permission_tenant_idx" ON "role_permission" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "session_token_uq" ON "session" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "tenant_subdomain_uq" ON "tenant" USING btree ("subdomain");--> statement-breakpoint
CREATE UNIQUE INDEX "user_role_uq" ON "user_role" USING btree ("user_id","role_id");--> statement-breakpoint
CREATE INDEX "user_role_tenant_idx" ON "user_role" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_uq" ON "users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "users_tenant_idx" ON "users" USING btree ("tenant_id");