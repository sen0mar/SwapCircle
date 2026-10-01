ALTER TABLE "conversation_membership_events" DROP CONSTRAINT "membership_event_type_valid";--> statement-breakpoint
ALTER TABLE "conversation_membership_events" ADD COLUMN "affected_user_id" uuid;--> statement-breakpoint
ALTER TABLE "conversation_membership_events" ADD CONSTRAINT "conversation_membership_events_affected_user_id_profiles_id_fk" FOREIGN KEY ("affected_user_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_membership_events" ADD CONSTRAINT "membership_event_type_valid" CHECK ("conversation_membership_events"."event_type" IN ('invited', 'accepted', 'declined', 'left', 'removed'));--> statement-breakpoint
-- Only editable, linked trades can reconcile membership. Retained members keep
-- their independent chat response; additions stay pending and removals revoke.
CREATE FUNCTION private.reconcile_trade_group(target uuid, actor uuid, added uuid[])
RETURNS TABLE(user_id uuid, event_id uuid, event_type text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE trade uuid; member record;
BEGIN
  SELECT c.trade_id INTO trade FROM public.conversations c JOIN public.trades t ON t.id=c.trade_id
    WHERE c.id=target AND c.type='group' AND t.status='proposed' AND t.expires_at>statement_timestamp()
    AND EXISTS (SELECT 1 FROM public.trade_participants p WHERE p.trade_id=t.id AND p.user_id=actor AND p.active)
    FOR NO KEY UPDATE OF c;
  IF NOT FOUND THEN RAISE EXCEPTION 'Group unavailable' USING ERRCODE='23514'; END IF;
  FOR member IN SELECT m.user_id FROM public.conversation_members m WHERE m.conversation_id=target
    AND m.status IN ('pending','accepted') AND NOT EXISTS
      (SELECT 1 FROM public.trade_participants p WHERE p.trade_id=trade AND p.user_id=m.user_id AND p.active)
  LOOP
    UPDATE public.conversation_members m SET active=false,status='left',responded_at=statement_timestamp()
      WHERE m.conversation_id=target AND m.user_id=member.user_id;
    INSERT INTO public.conversation_membership_events (conversation_id,actor_id,affected_user_id,event_type)
      VALUES (target,actor,member.user_id,'removed') RETURNING id INTO event_id;
    user_id := member.user_id;
    event_type := 'removed';
    RETURN NEXT;
  END LOOP;
  FOR member IN SELECT p.user_id FROM public.trade_participants p WHERE p.trade_id=trade AND p.active AND p.user_id=ANY(added)
    AND NOT EXISTS (SELECT 1 FROM public.conversation_members m WHERE m.conversation_id=target AND m.user_id=p.user_id
      AND m.status IN ('pending','accepted'))
  LOOP
    INSERT INTO public.conversation_members (conversation_id,user_id,active,status)
      VALUES (target,member.user_id,false,'pending') ON CONFLICT ON CONSTRAINT conversation_members_conversation_id_user_id_pk
      DO UPDATE SET active=false,status='pending',responded_at=NULL;
    INSERT INTO public.conversation_membership_events (conversation_id,actor_id,affected_user_id,event_type)
      VALUES (target,actor,member.user_id,'invited') RETURNING id INTO event_id;
    user_id := member.user_id;
    event_type := 'invited';
    RETURN NEXT;
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION private.reconcile_trade_group(uuid,uuid,uuid[]) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION private.reconcile_trade_group(uuid,uuid,uuid[]) TO swapcircle_runtime;
