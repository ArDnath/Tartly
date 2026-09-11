CREATE TABLE "meetings" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"thread_id" text,
	"calendar_event_id" text,
	"proposal_id" text,
	"subject" text,
	"start_at" timestamp with time zone,
	"end_at" timestamp with time zone,
	"meet_link" text,
	"status" text DEFAULT 'proposed' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "meetings_calendar_event_id_unique" UNIQUE("calendar_event_id")
);
--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_thread_id_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "meetings_thread_proposal_unique" ON "meetings" USING btree ("thread_id","proposal_id");--> statement-breakpoint
CREATE INDEX "meetings_user_start_idx" ON "meetings" USING btree ("user_id","start_at");