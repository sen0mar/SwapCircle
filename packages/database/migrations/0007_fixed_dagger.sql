CREATE TABLE "action_quotas" (
	"user_id" uuid NOT NULL,
	"action" varchar(32) NOT NULL,
	"window_started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"used" integer NOT NULL,
	CONSTRAINT "action_quotas_user_id_action_pk" PRIMARY KEY("user_id","action"),
	CONSTRAINT "quota_used_positive" CHECK ("action_quotas"."used" > 0),
	CONSTRAINT "quota_action_valid" CHECK ("action_quotas"."action" IN ('profile', 'avatar', 'listing', 'photo', 'block', 'report'))
);
--> statement-breakpoint
CREATE TABLE "blocks" (
	"blocker_id" uuid NOT NULL,
	"blocked_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "blocks_blocker_id_blocked_id_pk" PRIMARY KEY("blocker_id","blocked_id"),
	CONSTRAINT "blocks_distinct_users" CHECK ("blocks"."blocker_id" <> "blocks"."blocked_id")
);
--> statement-breakpoint
CREATE TABLE "reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reporter_id" uuid NOT NULL,
	"client_report_id" uuid NOT NULL,
	"reported_user_id" uuid,
	"listing_id" uuid,
	"reason" varchar(2000) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reports_retry_unique" UNIQUE("reporter_id","client_report_id"),
	CONSTRAINT "reports_one_target" CHECK (("reports"."reported_user_id" IS NOT NULL) <> ("reports"."listing_id" IS NOT NULL)),
	CONSTRAINT "reports_reason_nonempty" CHECK (length(trim("reports"."reason")) > 0)
);
--> statement-breakpoint
ALTER TABLE "action_quotas" ADD CONSTRAINT "action_quotas_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blocks" ADD CONSTRAINT "blocks_blocker_id_profiles_id_fk" FOREIGN KEY ("blocker_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blocks" ADD CONSTRAINT "blocks_blocked_id_profiles_id_fk" FOREIGN KEY ("blocked_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_reporter_id_profiles_id_fk" FOREIGN KEY ("reporter_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_reported_user_id_profiles_id_fk" FOREIGN KEY ("reported_user_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "blocks_blocked_idx" ON "blocks" USING btree ("blocked_id");
--> statement-breakpoint
ALTER TABLE public.blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.action_quotas ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON public.blocks, public.reports, public.action_quotas FROM PUBLIC, anon, authenticated, service_role;
--> statement-breakpoint
CREATE POLICY runtime_blocks ON public.blocks TO swapcircle_runtime USING (true) WITH CHECK (true);
CREATE POLICY runtime_reports ON public.reports TO swapcircle_runtime USING (true) WITH CHECK (true);
CREATE POLICY runtime_action_quotas ON public.action_quotas TO swapcircle_runtime USING (true) WITH CHECK (true);
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON public.blocks TO swapcircle_runtime;
GRANT SELECT, INSERT ON public.reports TO swapcircle_runtime;
GRANT SELECT, INSERT, UPDATE ON public.action_quotas TO swapcircle_runtime;
