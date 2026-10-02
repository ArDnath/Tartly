CREATE TABLE "commitments" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"thread_id" text,
	"contact_email" text,
	"direction" text NOT NULL,
	"description" text NOT NULL,
	"due_at" timestamp with time zone,
	"status" text DEFAULT 'open' NOT NULL,
	"source_message_id" text,
	"confidence" text,
	"nudged_at" timestamp with time zone,
	"nudge_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "thread_settings" (
	"thread_id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"autonomy" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_chat_thread" ADD COLUMN "kind" text DEFAULT 'chat' NOT NULL;--> statement-breakpoint
ALTER TABLE "assistant_settings" ADD COLUMN "briefing_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "assistant_settings" ADD COLUMN "briefing_hour" integer DEFAULT 8 NOT NULL;--> statement-breakpoint
ALTER TABLE "assistant_settings" ADD COLUMN "commitments_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "assistant_settings" ADD COLUMN "memory_auto_extract" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "drafts" ADD COLUMN "sent_by" text;--> statement-breakpoint
ALTER TABLE "commitments" ADD CONSTRAINT "commitments_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commitments" ADD CONSTRAINT "commitments_thread_id_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."threads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commitments" ADD CONSTRAINT "commitments_source_message_id_messages_id_fk" FOREIGN KEY ("source_message_id") REFERENCES "public"."messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread_settings" ADD CONSTRAINT "thread_settings_thread_id_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread_settings" ADD CONSTRAINT "thread_settings_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "commitments_user_status_idx" ON "commitments" USING btree ("user_id","status","due_at");--> statement-breakpoint
CREATE INDEX "commitments_thread_idx" ON "commitments" USING btree ("thread_id");--> statement-breakpoint
CREATE INDEX "commitments_contact_idx" ON "commitments" USING btree ("user_id","contact_email");--> statement-breakpoint
CREATE INDEX "thread_settings_user_idx" ON "thread_settings" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_chat_thread_briefing_unique" ON "agent_chat_thread" USING btree ("user_id") WHERE "agent_chat_thread"."kind" = 'briefing';