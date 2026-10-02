CREATE TABLE "automation_rules" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"instruction" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"priority" integer DEFAULT 100 NOT NULL,
	"condition" jsonb NOT NULL,
	"actions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"source" text DEFAULT 'user' NOT NULL,
	"version" text,
	"created_by" text DEFAULT 'user' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rule_executions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"rule_id" text NOT NULL,
	"thread_id" text,
	"message_id" text,
	"status" text DEFAULT 'matched' NOT NULL,
	"reason" text,
	"match_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "automation_rules" ADD CONSTRAINT "automation_rules_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_executions" ADD CONSTRAINT "rule_executions_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_executions" ADD CONSTRAINT "rule_executions_rule_id_automation_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."automation_rules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_executions" ADD CONSTRAINT "rule_executions_thread_id_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "automation_rules_user_enabled_idx" ON "automation_rules" USING btree ("user_id","enabled","priority");--> statement-breakpoint
CREATE INDEX "rule_executions_user_created_idx" ON "rule_executions" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "rule_executions_rule_created_idx" ON "rule_executions" USING btree ("rule_id","created_at");--> statement-breakpoint
CREATE INDEX "rule_executions_thread_idx" ON "rule_executions" USING btree ("thread_id");