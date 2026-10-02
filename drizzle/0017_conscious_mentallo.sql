CREATE TABLE "digest_items" (
	"id" text PRIMARY KEY NOT NULL,
	"digest_id" text NOT NULL,
	"user_id" text NOT NULL,
	"thread_id" text,
	"group" text NOT NULL,
	"title" text NOT NULL,
	"snippet" text,
	"reason" text,
	"priority" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "digests" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"kind" text DEFAULT 'daily' NOT NULL,
	"status" text DEFAULT 'ready' NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"headline" text,
	"summary" text,
	"source" text DEFAULT 'heuristic' NOT NULL,
	"thread_count" integer DEFAULT 0 NOT NULL,
	"noise_count" integer DEFAULT 0 NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"emailed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "assistant_settings" ADD COLUMN "meeting_briefs_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "assistant_settings" ADD COLUMN "digest_frequency" text DEFAULT 'off' NOT NULL;--> statement-breakpoint
ALTER TABLE "assistant_settings" ADD COLUMN "digest_last_generated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "thread_states" ADD COLUMN "reply_status" text;--> statement-breakpoint
ALTER TABLE "digest_items" ADD CONSTRAINT "digest_items_digest_id_digests_id_fk" FOREIGN KEY ("digest_id") REFERENCES "public"."digests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "digest_items" ADD CONSTRAINT "digest_items_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "digest_items" ADD CONSTRAINT "digest_items_thread_id_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."threads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "digests" ADD CONSTRAINT "digests_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "digest_items_digest_idx" ON "digest_items" USING btree ("digest_id");--> statement-breakpoint
CREATE INDEX "digest_items_user_created_idx" ON "digest_items" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "digests_user_generated_idx" ON "digests" USING btree ("user_id","generated_at");