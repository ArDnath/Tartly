CREATE TABLE "agent_chat_message" (
	"id" text PRIMARY KEY NOT NULL,
	"thread_id" text NOT NULL,
	"role" text NOT NULL,
	"parts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"hidden" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_chat_thread" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"title" text,
	"is_workspace_setup" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "onboarding_state" (
	"user_id" text PRIMARY KEY NOT NULL,
	"status" text DEFAULT 'PROFILE_CREATION' NOT NULL,
	"previous_status" text,
	"reversible_history" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"navigation_direction" text DEFAULT 'forward' NOT NULL,
	"job_title" text,
	"connected_email_provider" text,
	"installed_apps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"invited_emails" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"credits_earned" integer DEFAULT 0 NOT NULL,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_chat_message" ADD CONSTRAINT "agent_chat_message_thread_id_agent_chat_thread_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."agent_chat_thread"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_chat_thread" ADD CONSTRAINT "agent_chat_thread_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_state" ADD CONSTRAINT "onboarding_state_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;