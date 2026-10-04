CREATE TABLE "asset_extractions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"asset_id" text NOT NULL,
	"status" text NOT NULL,
	"parser" text,
	"ciphertext" text,
	"iv" text,
	"tag" text,
	"char_count" integer DEFAULT 0 NOT NULL,
	"truncated" boolean DEFAULT false NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "scan_status" text DEFAULT 'skipped' NOT NULL;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "scan_signature" text;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "scanned_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "asset_extractions" ADD CONSTRAINT "asset_extractions_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_extractions" ADD CONSTRAINT "asset_extractions_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "asset_extractions_asset_unique" ON "asset_extractions" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "asset_extractions_user_idx" ON "asset_extractions" USING btree ("user_id");