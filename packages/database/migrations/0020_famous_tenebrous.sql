CREATE TABLE "coffee_invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trade_id" uuid NOT NULL,
	"inviter_id" uuid NOT NULL,
	"invitee_id" uuid NOT NULL,
	"operation_key" uuid NOT NULL,
	"offer_to_pay" boolean DEFAULT false NOT NULL,
	"status" varchar(16) DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"responded_at" timestamp with time zone,
	CONSTRAINT "coffee_distinct_pair" CHECK ("coffee_invitations"."inviter_id" <> "coffee_invitations"."invitee_id"),
	CONSTRAINT "coffee_status_valid" CHECK ("coffee_invitations"."status" IN ('pending','accepted','declined','cancelled')),
	CONSTRAINT "coffee_response_consistent" CHECK (("coffee_invitations"."status" = 'pending') = ("coffee_invitations"."responded_at" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "action_quotas" DROP CONSTRAINT "quota_action_valid";--> statement-breakpoint
ALTER TABLE "coffee_invitations" ADD CONSTRAINT "coffee_invitations_trade_id_trades_id_fk" FOREIGN KEY ("trade_id") REFERENCES "public"."trades"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coffee_invitations" ADD CONSTRAINT "coffee_invitations_inviter_id_profiles_id_fk" FOREIGN KEY ("inviter_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coffee_invitations" ADD CONSTRAINT "coffee_invitations_invitee_id_profiles_id_fk" FOREIGN KEY ("invitee_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coffee_invitations" ADD CONSTRAINT "coffee_invitations_trade_id_inviter_id_trade_participants_trade_id_user_id_fk" FOREIGN KEY ("trade_id","inviter_id") REFERENCES "public"."trade_participants"("trade_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coffee_invitations" ADD CONSTRAINT "coffee_invitations_trade_id_invitee_id_trade_participants_trade_id_user_id_fk" FOREIGN KEY ("trade_id","invitee_id") REFERENCES "public"."trade_participants"("trade_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "coffee_operation_unique" ON "coffee_invitations" USING btree ("inviter_id","operation_key");--> statement-breakpoint
CREATE UNIQUE INDEX "coffee_active_pair_unique" ON "coffee_invitations" USING btree ("trade_id",least("inviter_id", "invitee_id"),greatest("inviter_id", "invitee_id")) WHERE "coffee_invitations"."status" IN ('pending', 'accepted');--> statement-breakpoint
ALTER TABLE "action_quotas" ADD CONSTRAINT "quota_action_valid" CHECK ("action_quotas"."action" IN ('profile', 'avatar', 'listing', 'photo', 'block', 'report', 'conversation', 'message', 'trade', 'coffee'));--> statement-breakpoint
ALTER TABLE public.coffee_invitations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.coffee_invitations FROM PUBLIC,anon,authenticated,service_role;
CREATE POLICY runtime_coffee ON public.coffee_invitations TO swapcircle_runtime USING (true) WITH CHECK (true);
GRANT SELECT,INSERT,UPDATE ON public.coffee_invitations TO swapcircle_runtime;
