CREATE TABLE "ai_cache" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"cache_type" text NOT NULL,
	"cache_key" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sender_profiles" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"email" text NOT NULL,
	"domain" text DEFAULT '' NOT NULL,
	"category" text DEFAULT 'Other' NOT NULL,
	"confidence" integer DEFAULT 0 NOT NULL,
	"cold_email_score" integer DEFAULT 0 NOT NULL,
	"marketing_score" integer DEFAULT 0 NOT NULL,
	"unsubscribe_url" text,
	"unsubscribe_method" text,
	"status" text DEFAULT 'active' NOT NULL,
	"model_enriched" boolean DEFAULT false NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "unsubscribe_attempts" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"sender_email" text NOT NULL,
	"method" text NOT NULL,
	"status" text NOT NULL,
	"message_id" text,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "assistant_settings" ADD COLUMN "sender_intel_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "assistant_settings" ADD COLUMN "cold_email_action" text DEFAULT 'label' NOT NULL;--> statement-breakpoint
ALTER TABLE "assistant_settings" ADD COLUMN "auto_archive_noise" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "unsubscribe" jsonb;--> statement-breakpoint
ALTER TABLE "thread_states" ADD COLUMN "reason" text;--> statement-breakpoint
ALTER TABLE "thread_states" ADD COLUMN "triage_version" text;--> statement-breakpoint
ALTER TABLE "ai_cache" ADD CONSTRAINT "ai_cache_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sender_profiles" ADD CONSTRAINT "sender_profiles_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unsubscribe_attempts" ADD CONSTRAINT "unsubscribe_attempts_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ai_cache_user_type_key_unique" ON "ai_cache" USING btree ("user_id","cache_type","cache_key");--> statement-breakpoint
CREATE INDEX "ai_cache_expiry_idx" ON "ai_cache" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "sender_profiles_user_email_unique" ON "sender_profiles" USING btree ("user_id","email");--> statement-breakpoint
CREATE INDEX "sender_profiles_user_domain_idx" ON "sender_profiles" USING btree ("user_id","domain");--> statement-breakpoint
CREATE INDEX "sender_profiles_user_category_idx" ON "sender_profiles" USING btree ("user_id","category");--> statement-breakpoint
CREATE INDEX "unsubscribe_attempts_user_sender_idx" ON "unsubscribe_attempts" USING btree ("user_id","sender_email");--> statement-breakpoint
CREATE INDEX "unsubscribe_attempts_user_created_idx" ON "unsubscribe_attempts" USING btree ("user_id","created_at");