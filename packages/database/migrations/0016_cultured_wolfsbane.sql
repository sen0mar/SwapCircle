CREATE TABLE "conversation_membership_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"event_type" varchar(16) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "membership_event_type_valid" CHECK ("conversation_membership_events"."event_type" IN ('invited', 'accepted', 'declined', 'left'))
);
--> statement-breakpoint
ALTER TABLE "notifications" DROP CONSTRAINT "notification_resource_valid";--> statement-breakpoint
ALTER TABLE "conversation_members" ADD COLUMN "status" varchar(16) DEFAULT 'accepted' NOT NULL;--> statement-breakpoint
ALTER TABLE "conversation_members" ADD COLUMN "responded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "trade_id" uuid;--> statement-breakpoint
ALTER TABLE "conversation_membership_events" ADD CONSTRAINT "conversation_membership_events_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_membership_events" ADD CONSTRAINT "conversation_membership_events_actor_id_profiles_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "membership_events_conversation_idx" ON "conversation_membership_events" USING btree ("conversation_id");--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_trade_id_trades_id_fk" FOREIGN KEY ("trade_id") REFERENCES "public"."trades"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_trade_unique" UNIQUE("trade_id");--> statement-breakpoint
ALTER TABLE "conversation_members" ADD CONSTRAINT "membership_status_valid" CHECK ("conversation_members"."status" IN ('pending', 'accepted', 'declined', 'left'));--> statement-breakpoint
ALTER TABLE "conversation_members" ADD CONSTRAINT "membership_active_accepted" CHECK (NOT "conversation_members"."active" OR "conversation_members"."status" = 'accepted');--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversation_trade_group" CHECK ("conversations"."trade_id" IS NULL OR "conversations"."type" = 'group');--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notification_resource_valid" CHECK (("notifications"."event_type" IN ('trade_invitation', 'trade_status', 'trade_revision') AND "notifications"."resource_type" = 'trade') OR ("notifications"."event_type" IN ('group_invitation', 'group_membership') AND "notifications"."resource_type" = 'conversation') OR ("notifications"."event_type" IN ('coffee_invitation', 'coffee_response') AND "notifications"."resource_type" = 'coffee_invitation') OR ("notifications"."event_type" = 'meeting_change' AND "notifications"."resource_type" = 'meetup'));--> statement-breakpoint
ALTER TABLE public.conversation_membership_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.conversation_membership_events FROM PUBLIC, anon, authenticated, service_role;
CREATE POLICY runtime_membership_events ON public.conversation_membership_events TO swapcircle_runtime USING (true) WITH CHECK (true);
GRANT SELECT, INSERT ON public.conversation_membership_events TO swapcircle_runtime;
--> statement-breakpoint
-- Keep the trade link immutable just like direct identity. Existing unlinked
-- synthetic/legacy groups remain valid; new proposals always create linked groups.
CREATE OR REPLACE FUNCTION public.guard_conversation_identity() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF (NEW.type, NEW.direct_user_low, NEW.direct_user_high, NEW.trade_id) IS DISTINCT FROM
     (OLD.type, OLD.direct_user_low, OLD.direct_user_high, OLD.trade_id) THEN
    RAISE EXCEPTION 'Conversation identity is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
-- No general membership UPDATE grant. The only runtime transition path is
-- restricted to the caller's existing invitation in a linked group, under the
-- same conversation lock used by sends and read acknowledgements.
CREATE FUNCTION private.respond_group_membership(target uuid, actor uuid, response text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE previous text;
BEGIN
  PERFORM 1 FROM public.conversations WHERE id=target AND type='group' AND trade_id IS NOT NULL FOR NO KEY UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Group unavailable' USING ERRCODE='23514'; END IF;
  SELECT status INTO previous FROM public.conversation_members WHERE conversation_id=target AND user_id=actor FOR UPDATE;
  IF NOT FOUND OR NOT ((previous='pending' AND response IN ('accepted','declined')) OR (previous='accepted' AND response='left')) THEN
    RAISE EXCEPTION 'Invalid membership transition' USING ERRCODE='23514';
  END IF;
  UPDATE public.conversation_members SET status=response,active=(response='accepted'),responded_at=statement_timestamp(),
    joined_at=CASE WHEN response='accepted' THEN statement_timestamp() ELSE joined_at END
    WHERE conversation_id=target AND user_id=actor;
END;
$$;
REVOKE ALL ON FUNCTION private.respond_group_membership(uuid,uuid,text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.respond_group_membership(uuid,uuid,text) TO swapcircle_runtime;
