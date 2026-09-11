CREATE TABLE "followup_enrollments" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"thread_id" text NOT NULL,
	"sequence_id" text,
	"stage" text DEFAULT 'waiting' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"next_eval_at" timestamp with time zone,
	"status" text DEFAULT 'active' NOT NULL,
	"stop_reason" text,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "followup_sequences" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"graph" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "followup_enrollments" ADD CONSTRAINT "followup_enrollments_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "followup_enrollments" ADD CONSTRAINT "followup_enrollments_thread_id_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "followup_enrollments" ADD CONSTRAINT "followup_enrollments_sequence_id_followup_sequences_id_fk" FOREIGN KEY ("sequence_id") REFERENCES "public"."followup_sequences"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "followup_sequences" ADD CONSTRAINT "followup_sequences_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "followup_enrollments_due_idx" ON "followup_enrollments" USING btree ("status","next_eval_at");--> statement-breakpoint
CREATE INDEX "followup_enrollments_thread_idx" ON "followup_enrollments" USING btree ("thread_id","status");