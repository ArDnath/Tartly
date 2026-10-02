CREATE TABLE "bulk_campaigns" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"template" jsonb NOT NULL,
	"sender_name" text,
	"reply_to" text,
	"throttle_per_hour" integer DEFAULT 50 NOT NULL,
	"send_window" jsonb,
	"reply_policy" text DEFAULT 'drafts' NOT NULL,
	"footer_address" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bulk_recipients" (
	"id" text PRIMARY KEY NOT NULL,
	"campaign_id" text NOT NULL,
	"user_id" text NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"row_data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"gmail_message_id" text,
	"thread_id" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"personalized_body" text,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaign_events" (
	"id" text PRIMARY KEY NOT NULL,
	"campaign_id" text NOT NULL,
	"user_id" text NOT NULL,
	"recipient_id" text,
	"type" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "suppression_list" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"email" text NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bulk_campaigns" ADD CONSTRAINT "bulk_campaigns_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bulk_recipients" ADD CONSTRAINT "bulk_recipients_campaign_id_bulk_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."bulk_campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bulk_recipients" ADD CONSTRAINT "bulk_recipients_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_events" ADD CONSTRAINT "campaign_events_campaign_id_bulk_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."bulk_campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_events" ADD CONSTRAINT "campaign_events_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_events" ADD CONSTRAINT "campaign_events_recipient_id_bulk_recipients_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."bulk_recipients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suppression_list" ADD CONSTRAINT "suppression_list_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bulk_campaigns_user_created_idx" ON "bulk_campaigns" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "bulk_campaigns_user_status_idx" ON "bulk_campaigns" USING btree ("user_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "bulk_recipients_campaign_email_unique" ON "bulk_recipients" USING btree ("campaign_id","email");--> statement-breakpoint
CREATE INDEX "bulk_recipients_campaign_status_idx" ON "bulk_recipients" USING btree ("campaign_id","status");--> statement-breakpoint
CREATE INDEX "bulk_recipients_user_created_idx" ON "bulk_recipients" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "campaign_events_campaign_created_idx" ON "campaign_events" USING btree ("campaign_id","created_at");--> statement-breakpoint
CREATE INDEX "campaign_events_user_created_idx" ON "campaign_events" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "suppression_list_user_email_unique" ON "suppression_list" USING btree ("user_id","email");--> statement-breakpoint
CREATE INDEX "suppression_list_user_created_idx" ON "suppression_list" USING btree ("user_id","created_at");