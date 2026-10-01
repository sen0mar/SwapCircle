ALTER TABLE "trade_participants" ADD COLUMN "active" boolean DEFAULT true NOT NULL;
--> statement-breakpoint
ALTER TABLE "trade_versions" ADD COLUMN "participant_ids" uuid[];
ALTER TABLE "trade_versions" ADD COLUMN "expires_at" timestamp with time zone;
-- Existing immutable versions precede participation editing, so their membership
-- is exactly the retained participant set. Preserve every existing term row.
UPDATE public.trade_versions v SET participant_ids=(SELECT array_agg(p.user_id ORDER BY p.user_id)
  FROM public.trade_participants p WHERE p.trade_id=v.trade_id),
  expires_at=(SELECT t.expires_at FROM public.trades t WHERE t.id=v.trade_id);
ALTER TABLE public.trade_versions ALTER COLUMN participant_ids SET NOT NULL;
ALTER TABLE public.trade_versions ALTER COLUMN expires_at SET NOT NULL;
--> statement-breakpoint
CREATE TRIGGER trade_versions_append_only BEFORE UPDATE OR DELETE ON public.trade_versions
FOR EACH ROW EXECUTE FUNCTION public.guard_trade_event_history();
CREATE TRIGGER trade_items_append_only BEFORE UPDATE OR DELETE ON public.trade_items
FOR EACH ROW EXECUTE FUNCTION public.guard_trade_event_history();
--> statement-breakpoint
CREATE FUNCTION public.guard_proposal_terms() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
DECLARE target uuid; current_status text;
BEGIN
  IF TG_TABLE_NAME='trades' THEN
    IF OLD.status <> 'proposed' AND (NEW.status='proposed' OR
       (NEW.current_version,NEW.expires_at,NEW.creator_id) IS DISTINCT FROM
       (OLD.current_version,OLD.expires_at,OLD.creator_id)) THEN
      RAISE EXCEPTION 'Confirmed terms are immutable' USING ERRCODE='23514';
    END IF;
  ELSE
    target := NEW.trade_id;
    SELECT status INTO current_status FROM public.trades WHERE id=target;
    IF current_status <> 'proposed' THEN
      IF TG_OP='INSERT' OR (NEW.active,NEW.invitation_status,NEW.accepted_version,NEW.accepted_at) IS DISTINCT FROM
         (OLD.active,OLD.invitation_status,OLD.accepted_version,OLD.accepted_at) THEN
        RAISE EXCEPTION 'Confirmed terms are immutable' USING ERRCODE='23514';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_proposal_terms() FROM PUBLIC,anon,authenticated,service_role,swapcircle_runtime;
CREATE TRIGGER trades_frozen_terms BEFORE UPDATE ON public.trades FOR EACH ROW EXECUTE FUNCTION public.guard_proposal_terms();
CREATE TRIGGER participants_frozen_terms BEFORE INSERT OR UPDATE ON public.trade_participants FOR EACH ROW EXECUTE FUNCTION public.guard_proposal_terms();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION private.respond_group_membership(target uuid, actor uuid, response text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE previous text;
BEGIN
  PERFORM 1 FROM public.conversations c WHERE c.id=target AND c.type='group' AND c.trade_id IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.trade_participants p WHERE p.trade_id=c.trade_id AND p.user_id=actor AND p.active)
    FOR NO KEY UPDATE;
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
--> statement-breakpoint
CREATE FUNCTION public.guard_new_trade_snapshot() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.trades WHERE id=NEW.trade_id AND status='proposed') THEN
    RAISE EXCEPTION 'Confirmed terms are immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_new_trade_snapshot() FROM PUBLIC,anon,authenticated,service_role,swapcircle_runtime;
CREATE TRIGGER trade_versions_proposed_only BEFORE INSERT ON public.trade_versions
FOR EACH ROW EXECUTE FUNCTION public.guard_new_trade_snapshot();
CREATE TRIGGER trade_items_proposed_only BEFORE INSERT ON public.trade_items
FOR EACH ROW EXECUTE FUNCTION public.guard_new_trade_snapshot();
