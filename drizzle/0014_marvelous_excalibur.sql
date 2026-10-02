CREATE TABLE "ai_usage_events" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"feature" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"role" text NOT NULL,
	"prompt_tokens" integer DEFAULT 0 NOT NULL,
	"completion_tokens" integer DEFAULT 0 NOT NULL,
	"cached_tokens" integer DEFAULT 0 NOT NULL,
	"total_tokens" integer DEFAULT 0 NOT NULL,
	"estimated_cost_micros" integer DEFAULT 0 NOT NULL,
	"latency_ms" integer DEFAULT 0 NOT NULL,
	"ok" boolean DEFAULT true NOT NULL,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assistant_settings" (
	"user_id" text PRIMARY KEY NOT NULL,
	"writing_style" jsonb,
	"learned_writing_style" text,
	"explicit_writing_style" text,
	"style_version" integer DEFAULT 1 NOT NULL,
	"style_analyzed_at" timestamp with time zone,
	"draft_confidence" text DEFAULT 'all' NOT NULL,
	"voice_enabled" boolean DEFAULT true NOT NULL,
	"memory_enabled" boolean DEFAULT true NOT NULL,
	"knowledge_enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledge_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reply_memories" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"scope_type" text NOT NULL,
	"scope_value" text DEFAULT '' NOT NULL,
	"content" text NOT NULL,
	"source_draft_id" text,
	"source_thread_id" text,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "snippets" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"shortcut" text NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_chat_thread" ADD COLUMN "compaction_summary" text;--> statement-breakpoint
ALTER TABLE "agent_chat_thread" ADD COLUMN "compacted_before" text;--> statement-breakpoint
ALTER TABLE "drafts" ADD COLUMN "confidence" text;--> statement-breakpoint
ALTER TABLE "drafts" ADD COLUMN "suppressed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "drafts" ADD COLUMN "pipeline_version" text;--> statement-breakpoint
ALTER TABLE "ai_usage_events" ADD CONSTRAINT "ai_usage_events_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_settings" ADD CONSTRAINT "assistant_settings_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_entries" ADD CONSTRAINT "knowledge_entries_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reply_memories" ADD CONSTRAINT "reply_memories_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reply_memories" ADD CONSTRAINT "reply_memories_source_draft_id_drafts_id_fk" FOREIGN KEY ("source_draft_id") REFERENCES "public"."drafts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reply_memories" ADD CONSTRAINT "reply_memories_source_thread_id_threads_id_fk" FOREIGN KEY ("source_thread_id") REFERENCES "public"."threads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "snippets" ADD CONSTRAINT "snippets_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_usage_events_user_created_idx" ON "ai_usage_events" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "ai_usage_events_feature_created_idx" ON "ai_usage_events" USING btree ("feature","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_entries_user_title_unique" ON "knowledge_entries" USING btree ("user_id","title");--> statement-breakpoint
CREATE INDEX "knowledge_entries_user_created_idx" ON "knowledge_entries" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "reply_memories_user_scope_idx" ON "reply_memories" USING btree ("user_id","scope_type","scope_value");--> statement-breakpoint
CREATE INDEX "reply_memories_user_created_idx" ON "reply_memories" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "snippets_user_shortcut_unique" ON "snippets" USING btree ("user_id","shortcut");--> statement-breakpoint
CREATE INDEX "snippets_user_created_idx" ON "snippets" USING btree ("user_id","created_at");