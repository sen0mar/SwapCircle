ALTER TABLE "trade_events" DROP CONSTRAINT "trade_event_type_valid";--> statement-breakpoint
ALTER TABLE "trade_events" ADD CONSTRAINT "trade_event_type_valid" CHECK ("trade_events"."event_type" IN ('proposed','revised','accepted','confirmed','completed','declined','expired','cancelled','disputed','receipt_acknowledged','handover_reported'));--> statement-breakpoint
-- Release timestamps are the only reservation field application writes may change.
GRANT UPDATE (released_at) ON public.item_reservations TO swapcircle_runtime;
--> statement-breakpoint
-- Evidence writers share the proposal boundary even before receipt endpoints exist.
CREATE FUNCTION private.guard_trade_handover() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
DECLARE current_status text;
BEGIN
  IF NEW.event_type IN ('receipt_acknowledged','handover_reported') THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('proposal-terms', 0));
    SELECT status INTO current_status FROM public.trades WHERE id=NEW.trade_id FOR UPDATE;
    IF current_status NOT IN ('confirmed','disputed') THEN
      RAISE EXCEPTION 'Handover requires an active confirmed trade' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION private.guard_trade_handover() FROM PUBLIC,anon,authenticated,service_role,swapcircle_runtime;
--> statement-breakpoint
CREATE TRIGGER trade_handover_guard BEFORE INSERT ON public.trade_events
FOR EACH ROW EXECUTE FUNCTION private.guard_trade_handover();
