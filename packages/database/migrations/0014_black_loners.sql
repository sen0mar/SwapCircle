CREATE TABLE "trade_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trade_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"event_type" varchar(32) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trade_event_type_valid" CHECK ("trade_events"."event_type" IN ('proposed','revised','confirmed','completed','declined','expired','cancelled','disputed'))
);
--> statement-breakpoint
CREATE TABLE "trade_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trade_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"listing_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"recipient_id" uuid NOT NULL,
	"listing_revision" integer NOT NULL,
	"title_snapshot" varchar(120) NOT NULL,
	"description_snapshot" varchar(5000) NOT NULL,
	"condition_snapshot" varchar(20) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trade_items_version_listing_unique" UNIQUE("version_id","listing_id"),
	CONSTRAINT "trade_item_distinct_users" CHECK ("trade_items"."owner_id" <> "trade_items"."recipient_id"),
	CONSTRAINT "trade_item_revision_positive" CHECK ("trade_items"."listing_revision" > 0),
	CONSTRAINT "trade_item_title_nonempty" CHECK (length(trim("trade_items"."title_snapshot")) > 0),
	CONSTRAINT "trade_item_description_nonempty" CHECK (length(trim("trade_items"."description_snapshot")) > 0),
	CONSTRAINT "trade_item_condition_valid" CHECK ("trade_items"."condition_snapshot" IN ('like_new','good','fair','poor'))
);
--> statement-breakpoint
CREATE TABLE "trade_participants" (
	"trade_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"invitation_status" varchar(16) DEFAULT 'invited' NOT NULL,
	"invited_at" timestamp with time zone DEFAULT now() NOT NULL,
	"responded_at" timestamp with time zone,
	"accepted_version" integer,
	"accepted_at" timestamp with time zone,
	CONSTRAINT "trade_participants_trade_id_user_id_pk" PRIMARY KEY("trade_id","user_id"),
	CONSTRAINT "trade_invitation_valid" CHECK ("trade_participants"."invitation_status" IN ('invited','joined','declined')),
	CONSTRAINT "trade_acceptance_pair_valid" CHECK (("trade_participants"."accepted_version" IS NULL AND "trade_participants"."accepted_at" IS NULL) OR ("trade_participants"."accepted_version" > 0 AND "trade_participants"."accepted_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "trade_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trade_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trade_versions_number_unique" UNIQUE("trade_id","version"),
	CONSTRAINT "trade_versions_id_trade_unique" UNIQUE("id","trade_id"),
	CONSTRAINT "trade_versions_positive" CHECK ("trade_versions"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "trades" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"creator_id" uuid NOT NULL,
	"status" varchar(16) DEFAULT 'proposed' NOT NULL,
	"current_version" integer DEFAULT 1 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trade_status_valid" CHECK ("trades"."status" IN ('proposed','confirmed','completed','declined','expired','cancelled','disputed')),
	CONSTRAINT "trade_version_positive" CHECK ("trades"."current_version" > 0),
	CONSTRAINT "trade_expiry_after_creation" CHECK ("trades"."expires_at" > "trades"."created_at")
);
--> statement-breakpoint
ALTER TABLE "trade_events" ADD CONSTRAINT "trade_events_trade_id_trades_id_fk" FOREIGN KEY ("trade_id") REFERENCES "public"."trades"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_events" ADD CONSTRAINT "trade_events_version_id_trade_id_trade_versions_id_trade_id_fk" FOREIGN KEY ("version_id","trade_id") REFERENCES "public"."trade_versions"("id","trade_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_events" ADD CONSTRAINT "trade_events_trade_id_actor_id_trade_participants_trade_id_user_id_fk" FOREIGN KEY ("trade_id","actor_id") REFERENCES "public"."trade_participants"("trade_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_items" ADD CONSTRAINT "trade_items_version_id_trade_id_trade_versions_id_trade_id_fk" FOREIGN KEY ("version_id","trade_id") REFERENCES "public"."trade_versions"("id","trade_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_items" ADD CONSTRAINT "trade_items_listing_id_owner_id_listings_id_owner_id_fk" FOREIGN KEY ("listing_id","owner_id") REFERENCES "public"."listings"("id","owner_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_items" ADD CONSTRAINT "trade_items_trade_id_owner_id_trade_participants_trade_id_user_id_fk" FOREIGN KEY ("trade_id","owner_id") REFERENCES "public"."trade_participants"("trade_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_items" ADD CONSTRAINT "trade_items_trade_id_recipient_id_trade_participants_trade_id_user_id_fk" FOREIGN KEY ("trade_id","recipient_id") REFERENCES "public"."trade_participants"("trade_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_participants" ADD CONSTRAINT "trade_participants_trade_id_trades_id_fk" FOREIGN KEY ("trade_id") REFERENCES "public"."trades"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_participants" ADD CONSTRAINT "trade_participants_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_participants" ADD CONSTRAINT "trade_participants_accepted_version_fk" FOREIGN KEY ("trade_id","accepted_version") REFERENCES "public"."trade_versions"("trade_id","version");--> statement-breakpoint
ALTER TABLE "trade_versions" ADD CONSTRAINT "trade_versions_trade_id_trades_id_fk" FOREIGN KEY ("trade_id") REFERENCES "public"."trades"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_versions" ADD CONSTRAINT "trade_versions_created_by_profiles_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_creator_id_profiles_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- These circular references are deferred until the proposal transaction commits.
ALTER TABLE public.trades ADD CONSTRAINT trades_current_version_fk
  FOREIGN KEY (id,current_version) REFERENCES public.trade_versions(trade_id,version)
  DEFERRABLE INITIALLY DEFERRED;--> statement-breakpoint
ALTER TABLE public.trades ADD CONSTRAINT trades_creator_participant_fk
  FOREIGN KEY (id,creator_id) REFERENCES public.trade_participants(trade_id,user_id)
  DEFERRABLE INITIALLY DEFERRED;--> statement-breakpoint
CREATE INDEX "trade_events_trade_created_idx" ON "trade_events" USING btree ("trade_id","created_at","id");--> statement-breakpoint
CREATE INDEX "trade_items_owner_idx" ON "trade_items" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "trade_items_recipient_idx" ON "trade_items" USING btree ("recipient_id");--> statement-breakpoint
CREATE INDEX "trade_participants_user_idx" ON "trade_participants" USING btree ("user_id","trade_id");--> statement-breakpoint
CREATE INDEX "trades_creator_idx" ON "trades" USING btree ("creator_id");
--> statement-breakpoint
-- Browser roles cannot inspect proposal terms or write trade records directly.
ALTER TABLE public.trades ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trade_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trade_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trade_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trade_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.trades, public.trade_versions, public.trade_participants, public.trade_items, public.trade_events FROM PUBLIC, anon, authenticated, service_role;
CREATE POLICY runtime_trades ON public.trades TO swapcircle_runtime USING (true) WITH CHECK (true);
CREATE POLICY runtime_trade_versions ON public.trade_versions TO swapcircle_runtime USING (true) WITH CHECK (true);
CREATE POLICY runtime_trade_participants ON public.trade_participants TO swapcircle_runtime USING (true) WITH CHECK (true);
CREATE POLICY runtime_trade_items ON public.trade_items TO swapcircle_runtime USING (true) WITH CHECK (true);
CREATE POLICY runtime_trade_events ON public.trade_events TO swapcircle_runtime USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE ON public.trades, public.trade_participants TO swapcircle_runtime;
GRANT SELECT, INSERT ON public.trade_versions, public.trade_items, public.trade_events TO swapcircle_runtime;
-- Event history stays append-only even if a privileged role gains table update rights.
CREATE FUNCTION public.guard_trade_event_history() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  RAISE EXCEPTION 'trade events are append-only';
END;
$$;
REVOKE ALL ON FUNCTION public.guard_trade_event_history() FROM PUBLIC, anon, authenticated, service_role, swapcircle_runtime;
CREATE TRIGGER trade_events_append_only BEFORE UPDATE OR DELETE ON public.trade_events
FOR EACH ROW EXECUTE FUNCTION public.guard_trade_event_history();
