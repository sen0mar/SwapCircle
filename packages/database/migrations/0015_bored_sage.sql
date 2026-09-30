ALTER TABLE "action_quotas" DROP CONSTRAINT "quota_action_valid";--> statement-breakpoint
ALTER TABLE "trades" ADD COLUMN "operation_key" uuid;--> statement-breakpoint
ALTER TABLE "trades" ADD COLUMN "operation_hash" varchar(64);--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_creator_operation_unique" UNIQUE("creator_id","operation_key");--> statement-breakpoint
ALTER TABLE "action_quotas" ADD CONSTRAINT "quota_action_valid" CHECK ("action_quotas"."action" IN ('profile', 'avatar', 'listing', 'photo', 'block', 'report', 'conversation', 'message', 'trade'));--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trade_operation_pair_valid" CHECK (("trades"."operation_key" IS NULL) = ("trades"."operation_hash" IS NULL));