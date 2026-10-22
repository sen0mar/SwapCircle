-- Destructive schema removal, deliberately separate from any legacy data cleanup.
-- No records are discarded. A database containing legacy data requires a reviewed
-- export/retirement plan before this migration can run. Run only locally for now.
LOCK TABLE public.trades, public.trade_participants, public.trade_versions,
  public.conversations, public.conversation_members,
  public.conversation_membership_events, public.notifications IN ACCESS EXCLUSIVE MODE;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.conversations WHERE type <> 'direct' OR trade_id IS NOT NULL)
    OR EXISTS (SELECT 1 FROM public.conversation_membership_events)
    OR EXISTS (SELECT 1 FROM public.notifications WHERE event_type IN ('group_invitation','group_membership'))
    OR EXISTS (SELECT 1 FROM public.conversation_members WHERE status <> 'accepted' OR responded_at IS NOT NULL)
    OR EXISTS (SELECT 1 FROM public.trades t WHERE
      (SELECT count(*) FROM public.trade_participants p WHERE p.trade_id=t.id) <> 2
      OR EXISTS (SELECT 1 FROM public.trade_participants p WHERE p.trade_id=t.id AND NOT p.active))
    OR EXISTS (SELECT 1 FROM public.trade_versions v WHERE cardinality(participant_ids) <> 2
      OR NOT (participant_ids @> ARRAY(SELECT p.user_id FROM public.trade_participants p WHERE p.trade_id=v.trade_id)))
  THEN
    RAISE EXCEPTION 'Two-person migration blocked: legacy exchanges or chat data require an explicit export/retirement plan; no data was changed';
  END IF;
END $$;
--> statement-breakpoint
DROP FUNCTION private.respond_group_membership(uuid,uuid,text);
DROP FUNCTION private.reconcile_trade_group(uuid,uuid,uuid[]);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.guard_conversation_identity() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF (NEW.type, NEW.direct_user_low, NEW.direct_user_high) IS DISTINCT FROM
     (OLD.type, OLD.direct_user_low, OLD.direct_user_high) THEN
    RAISE EXCEPTION 'Conversation identity is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TABLE "conversation_membership_events";--> statement-breakpoint
ALTER TABLE "conversations" DROP CONSTRAINT "conversations_trade_unique";--> statement-breakpoint
ALTER TABLE "conversation_members" DROP CONSTRAINT "membership_status_valid";--> statement-breakpoint
ALTER TABLE "conversation_members" DROP CONSTRAINT "membership_active_accepted";--> statement-breakpoint
ALTER TABLE "conversations" DROP CONSTRAINT "conversation_trade_group";--> statement-breakpoint
ALTER TABLE "conversations" DROP CONSTRAINT "conversation_identity_valid";--> statement-breakpoint
ALTER TABLE "notifications" DROP CONSTRAINT "notification_resource_valid";--> statement-breakpoint
ALTER TABLE "conversations" DROP CONSTRAINT "conversations_trade_id_trades_id_fk";
--> statement-breakpoint
ALTER TABLE "conversation_members" DROP COLUMN "status";--> statement-breakpoint
ALTER TABLE "conversation_members" DROP COLUMN "responded_at";--> statement-breakpoint
ALTER TABLE "conversations" DROP COLUMN "trade_id";--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversation_identity_valid" CHECK ("conversations"."type" = 'direct' AND "conversations"."direct_user_low" IS NOT NULL AND "conversations"."direct_user_high" IS NOT NULL AND "conversations"."direct_user_low" < "conversations"."direct_user_high");--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notification_resource_valid" CHECK (("notifications"."event_type" IN ('trade_invitation', 'trade_status', 'trade_revision') AND "notifications"."resource_type" = 'trade') OR ("notifications"."event_type" = 'proposal_response' AND "notifications"."resource_type" = 'conversation') OR ("notifications"."event_type" IN ('coffee_invitation', 'coffee_response') AND "notifications"."resource_type" = 'coffee_invitation') OR ("notifications"."event_type" = 'meeting_change' AND "notifications"."resource_type" = 'meetup'));--> statement-breakpoint
ALTER TABLE "trade_versions" ADD CONSTRAINT "trade_versions_two_people" CHECK (cardinality("trade_versions"."participant_ids") = 2 AND array_ndims("trade_versions"."participant_ids") = 1 AND array_lower("trade_versions"."participant_ids", 1) = 1 AND "trade_versions"."participant_ids"[1] IS NOT NULL AND "trade_versions"."participant_ids"[2] IS NOT NULL AND "trade_versions"."participant_ids"[1] <> "trade_versions"."participant_ids"[2]);
--> statement-breakpoint
ALTER TABLE public.trade_participants DROP COLUMN active;
CREATE OR REPLACE FUNCTION public.guard_proposal_terms() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
DECLARE current_status text;
BEGIN
  IF TG_TABLE_NAME='trades' THEN
    IF OLD.status <> 'proposed' AND (NEW.status='proposed' OR
       (NEW.current_version,NEW.expires_at,NEW.creator_id) IS DISTINCT FROM
       (OLD.current_version,OLD.expires_at,OLD.creator_id)) THEN
      RAISE EXCEPTION 'Confirmed terms are immutable' USING ERRCODE='23514';
    END IF;
  ELSE
    SELECT status INTO current_status FROM public.trades WHERE id=NEW.trade_id;
    IF current_status <> 'proposed' THEN
      IF TG_OP='INSERT' OR (NEW.invitation_status,NEW.accepted_version,NEW.accepted_at) IS DISTINCT FROM
         (OLD.invitation_status,OLD.accepted_version,OLD.accepted_at) THEN
        RAISE EXCEPTION 'Confirmed terms are immutable' USING ERRCODE='23514';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
-- Serialize all participant changes on their parent, including direct SQL writes.
CREATE FUNCTION public.guard_swap_pair() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE target uuid;
BEGIN
  target := CASE WHEN TG_OP='DELETE' THEN OLD.trade_id ELSE NEW.trade_id END;
  PERFORM 1 FROM public.trades WHERE id=target FOR UPDATE;
  IF TG_OP <> 'INSERT' AND (
    TG_OP='DELETE' OR (NEW.trade_id,NEW.user_id) IS DISTINCT FROM (OLD.trade_id,OLD.user_id)
  ) THEN
    RAISE EXCEPTION 'Swap participants are fixed' USING ERRCODE='23514';
  END IF;
  IF TG_OP='INSERT' AND (
    (SELECT count(*) FROM public.trade_participants WHERE trade_id=target) >= 2
    OR EXISTS (SELECT 1 FROM public.trade_versions WHERE trade_id=target)) THEN
    RAISE EXCEPTION 'A swap has exactly two fixed participants' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_swap_pair() FROM PUBLIC,anon,authenticated,service_role,swapcircle_runtime;
CREATE TRIGGER swap_pair_fixed BEFORE INSERT OR UPDATE OR DELETE ON public.trade_participants
FOR EACH ROW EXECUTE FUNCTION public.guard_swap_pair();
--> statement-breakpoint
-- Deferred checks permit inserting the parent, its two participants and initial
-- version in one transaction, but never committing an incomplete swap.
CREATE FUNCTION public.check_swap_pair() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE target uuid; pair uuid[];
BEGIN
  IF TG_TABLE_NAME='trades' THEN
    target := NEW.id;
  ELSE
    target := NEW.trade_id;
  END IF;
  SELECT array_agg(user_id ORDER BY user_id) INTO pair FROM public.trade_participants WHERE trade_id=target;
  IF cardinality(pair) IS DISTINCT FROM 2
    OR NOT EXISTS (SELECT 1 FROM public.trade_versions WHERE trade_id=target AND version=1)
    OR EXISTS (SELECT 1 FROM public.trade_versions WHERE trade_id=target
      AND NOT (participant_ids @> pair AND participant_ids <@ pair)) THEN
    RAISE EXCEPTION 'A swap and all its versions require the same two participants' USING ERRCODE='23514';
  END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.check_swap_pair() FROM PUBLIC,anon,authenticated,service_role,swapcircle_runtime;
CREATE CONSTRAINT TRIGGER swap_pair_complete AFTER INSERT OR UPDATE ON public.trades
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.check_swap_pair();
CREATE CONSTRAINT TRIGGER swap_participants_complete AFTER INSERT OR UPDATE ON public.trade_participants
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.check_swap_pair();
CREATE CONSTRAINT TRIGGER swap_version_pair AFTER INSERT ON public.trade_versions
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.check_swap_pair();
