CREATE TABLE "trade_outcome_operations" (
	"actor_id" uuid NOT NULL,
	"operation_key" uuid NOT NULL,
	"trade_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"kind" varchar(32) NOT NULL,
	"reason" varchar(2000),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trade_outcome_operations_actor_id_operation_key_pk" PRIMARY KEY("actor_id","operation_key"),
	CONSTRAINT "trade_outcome_kind_valid" CHECK ("trade_outcome_operations"."kind" IN ('receipt','problem','partial_handover')),
	CONSTRAINT "trade_outcome_reason_valid" CHECK (("trade_outcome_operations"."kind" = 'receipt' AND "trade_outcome_operations"."reason" IS NULL) OR ("trade_outcome_operations"."kind" <> 'receipt' AND "trade_outcome_operations"."reason" IS NOT NULL AND length(trim("trade_outcome_operations"."reason")) > 0))
);
--> statement-breakpoint
ALTER TABLE "trade_outcome_operations" ADD CONSTRAINT "trade_outcome_operations_trade_id_trades_id_fk" FOREIGN KEY ("trade_id") REFERENCES "public"."trades"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_outcome_operations" ADD CONSTRAINT "trade_outcome_operations_trade_id_actor_id_trade_participants_trade_id_user_id_fk" FOREIGN KEY ("trade_id","actor_id") REFERENCES "public"."trade_participants"("trade_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_outcome_operations" ADD CONSTRAINT "trade_outcome_operations_trade_id_version_trade_versions_trade_id_version_fk" FOREIGN KEY ("trade_id","version") REFERENCES "public"."trade_versions"("trade_id","version") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "trade_outcome_operations_trade_idx" ON "trade_outcome_operations" USING btree ("trade_id");
--> statement-breakpoint
ALTER TABLE public.trade_outcome_operations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.trade_outcome_operations FROM PUBLIC,anon,authenticated,service_role;
CREATE POLICY runtime_trade_outcome_operations ON public.trade_outcome_operations
TO swapcircle_runtime USING (true) WITH CHECK (true);
GRANT SELECT,INSERT ON public.trade_outcome_operations TO swapcircle_runtime;
--> statement-breakpoint
CREATE TRIGGER trade_outcome_operations_append_only BEFORE UPDATE OR DELETE ON public.trade_outcome_operations
FOR EACH ROW EXECUTE FUNCTION public.guard_trade_event_history();
--> statement-breakpoint
-- Exchanged items are historical records, never reusable listing inventory.
CREATE FUNCTION private.guard_exchanged_listing() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
  IF OLD.availability='exchanged' AND NEW.availability <> 'exchanged' THEN
    RAISE EXCEPTION 'Exchanged listings cannot return to inventory' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION private.guard_exchanged_listing() FROM PUBLIC,anon,authenticated,service_role,swapcircle_runtime;
--> statement-breakpoint
CREATE TRIGGER listings_exchanged_guard BEFORE UPDATE OF availability ON public.listings
FOR EACH ROW EXECUTE FUNCTION private.guard_exchanged_listing();
