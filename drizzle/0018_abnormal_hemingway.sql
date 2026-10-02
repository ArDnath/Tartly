CREATE TABLE "asset_usages" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"asset_id" text NOT NULL,
	"context" text NOT NULL,
	"reference_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assets" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"kind" text DEFAULT 'file' NOT NULL,
	"filename" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer DEFAULT 0 NOT NULL,
	"width" integer,
	"height" integer,
	"storage_key" text NOT NULL,
	"sha256" text NOT NULL,
	"alt_text" text,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "asset_usages" ADD CONSTRAINT "asset_usages_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_usages" ADD CONSTRAINT "asset_usages_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "asset_usages_asset_idx" ON "asset_usages" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "asset_usages_user_created_idx" ON "asset_usages" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "assets_user_sha_unique" ON "assets" USING btree ("user_id","sha256");--> statement-breakpoint
CREATE INDEX "assets_user_created_idx" ON "assets" USING btree ("user_id","created_at");