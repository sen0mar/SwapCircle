CREATE TABLE "item_reservations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trade_id" uuid NOT NULL,
	"listing_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"released_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "trade_acceptance_operations" (
	"actor_id" uuid NOT NULL,
	"operation_key" uuid NOT NULL,
	"trade_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"result_status" varchar(16) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trade_acceptance_operations_actor_id_operation_key_pk" PRIMARY KEY("actor_id","operation_key"),
	CONSTRAINT "acceptance_result_status_valid" CHECK ("trade_acceptance_operations"."result_status" IN ('proposed','confirmed'))
);
--> statement-breakpoint
CREATE TABLE "trade_acceptances" (
	"trade_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"actor_id" uuid NOT NULL,
	"accepted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trade_acceptances_trade_id_version_actor_id_pk" PRIMARY KEY("trade_id","version","actor_id")
);
--> statement-breakpoint
ALTER TABLE "trade_events" DROP CONSTRAINT "trade_event_type_valid";--> statement-breakpoint
ALTER TABLE "item_reservations" ADD CONSTRAINT "item_reservations_trade_id_trades_id_fk" FOREIGN KEY ("trade_id") REFERENCES "public"."trades"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_reservations" ADD CONSTRAINT "item_reservations_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_acceptance_operations" ADD CONSTRAINT "trade_acceptance_operations_actor_id_profiles_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_acceptance_operations" ADD CONSTRAINT "trade_acceptance_operations_trade_id_version_actor_id_trade_acceptances_trade_id_version_actor_id_fk" FOREIGN KEY ("trade_id","version","actor_id") REFERENCES "public"."trade_acceptances"("trade_id","version","actor_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_acceptances" ADD CONSTRAINT "trade_acceptances_trade_id_version_trade_versions_trade_id_version_fk" FOREIGN KEY ("trade_id","version") REFERENCES "public"."trade_versions"("trade_id","version") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_acceptances" ADD CONSTRAINT "trade_acceptances_trade_id_actor_id_trade_participants_trade_id_user_id_fk" FOREIGN KEY ("trade_id","actor_id") REFERENCES "public"."trade_participants"("trade_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "item_reservations_active_listing_unique" ON "item_reservations" USING btree ("listing_id") WHERE "item_reservations"."released_at" IS NULL;--> statement-breakpoint
CREATE INDEX "item_reservations_trade_idx" ON "item_reservations" USING btree ("trade_id");--> statement-breakpoint
CREATE UNIQUE INDEX "trade_confirmation_unique" ON "trade_events" USING btree ("trade_id") WHERE "trade_events"."event_type" = 'confirmed';--> statement-breakpoint
ALTER TABLE "trade_events" ADD CONSTRAINT "trade_event_type_valid" CHECK ("trade_events"."event_type" IN ('proposed','revised','accepted','confirmed','completed','declined','expired','cancelled','disputed'));
--> statement-breakpoint
ALTER TABLE public.trade_acceptances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trade_acceptance_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.item_reservations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.trade_acceptances,public.trade_acceptance_operations,public.item_reservations FROM PUBLIC,anon,authenticated,service_role;
CREATE POLICY runtime_trade_acceptances ON public.trade_acceptances TO swapcircle_runtime USING (true) WITH CHECK (true);
CREATE POLICY runtime_acceptance_operations ON public.trade_acceptance_operations TO swapcircle_runtime USING (true) WITH CHECK (true);
CREATE POLICY runtime_reservations ON public.item_reservations TO swapcircle_runtime USING (true) WITH CHECK (true);
GRANT SELECT,INSERT ON public.trade_acceptances,public.trade_acceptance_operations,public.item_reservations TO swapcircle_runtime;
CREATE TRIGGER trade_acceptances_append_only BEFORE UPDATE OR DELETE ON public.trade_acceptances
FOR EACH ROW EXECUTE FUNCTION public.guard_trade_event_history();
CREATE TRIGGER acceptance_operations_append_only BEFORE UPDATE OR DELETE ON public.trade_acceptance_operations
FOR EACH ROW EXECUTE FUNCTION public.guard_trade_event_history();
