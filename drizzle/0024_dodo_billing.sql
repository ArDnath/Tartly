ALTER TABLE "billing_accounts" RENAME COLUMN "stripe_customer_id" TO "dodo_customer_id";--> statement-breakpoint
ALTER TABLE "subscriptions" RENAME COLUMN "stripe_customer_id" TO "dodo_customer_id";--> statement-breakpoint
ALTER TABLE "subscriptions" RENAME COLUMN "stripe_subscription_id" TO "dodo_subscription_id";--> statement-breakpoint
ALTER TABLE "subscriptions" RENAME COLUMN "stripe_price_id" TO "dodo_product_id";--> statement-breakpoint
ALTER INDEX "billing_accounts_customer_idx" RENAME TO "billing_accounts_dodo_customer_idx";--> statement-breakpoint
ALTER INDEX "subscriptions_stripe_id_unique" RENAME TO "subscriptions_dodo_id_unique";--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "billing_webhook_events" (
	"id" text PRIMARY KEY NOT NULL,
	"event_type" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "billing_webhook_events_received_idx" ON "billing_webhook_events" USING btree ("received_at");
