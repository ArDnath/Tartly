CREATE TABLE "autopilot_decisions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"mailbox_id" text NOT NULL,
	"thread_id" text,
	"run_id" text,
	"draft_id" text,
	"contact_email" text,
	"decision" text NOT NULL,
	"reason" text NOT NULL,
	"autonomy_source" text,
	"category" text,
	"confidence" text,
	"checks" jsonb,
	"policy_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "autopilot_policies" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"mailbox_id" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"mode" text DEFAULT 'window' NOT NULL,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"days" jsonb DEFAULT '[1,2,3,4,5,6,7]'::jsonb NOT NULL,
	"window_start_hour" integer DEFAULT 22 NOT NULL,
	"window_end_hour" integer DEFAULT 7 NOT NULL,
	"min_confidence" text DEFAULT 'HIGH' NOT NULL,
	"require_known_sender" boolean DEFAULT true NOT NULL,
	"allowed_categories" jsonb DEFAULT '["needs_reply"]'::jsonb NOT NULL,
	"max_per_hour" integer DEFAULT 10 NOT NULL,
	"max_per_day" integer DEFAULT 50 NOT NULL,
	"max_per_thread" integer DEFAULT 3 NOT NULL,
	"loop_threshold" integer DEFAULT 3 NOT NULL,
	"morning_review" boolean DEFAULT true NOT NULL,
	"policy_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "assistant_settings" ADD COLUMN "overnight_review_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "assistant_settings" ADD COLUMN "overnight_review_last_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "mailboxes" ADD COLUMN "sync_error" text;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "auto_submitted" boolean;--> statement-breakpoint
ALTER TABLE "autopilot_decisions" ADD CONSTRAINT "autopilot_decisions_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "autopilot_decisions" ADD CONSTRAINT "autopilot_decisions_mailbox_id_mailboxes_id_fk" FOREIGN KEY ("mailbox_id") REFERENCES "public"."mailboxes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "autopilot_decisions" ADD CONSTRAINT "autopilot_decisions_thread_id_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."threads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "autopilot_decisions" ADD CONSTRAINT "autopilot_decisions_run_id_flow_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."flow_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "autopilot_decisions" ADD CONSTRAINT "autopilot_decisions_draft_id_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."drafts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "autopilot_policies" ADD CONSTRAINT "autopilot_policies_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "autopilot_policies" ADD CONSTRAINT "autopilot_policies_mailbox_id_mailboxes_id_fk" FOREIGN KEY ("mailbox_id") REFERENCES "public"."mailboxes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "autopilot_decisions_user_created_idx" ON "autopilot_decisions" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "autopilot_decisions_thread_idx" ON "autopilot_decisions" USING btree ("thread_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "autopilot_policies_mailbox_unique" ON "autopilot_policies" USING btree ("mailbox_id");--> statement-breakpoint
CREATE INDEX "autopilot_policies_user_idx" ON "autopilot_policies" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "drafts_user_sentby_decided_idx" ON "drafts" USING btree ("user_id","sent_by","decided_at");