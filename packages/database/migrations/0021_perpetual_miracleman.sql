CREATE TABLE "meetup_operations" (
	"actor_id" uuid NOT NULL,
	"operation_key" uuid NOT NULL,
	"meetup_id" uuid NOT NULL,
	"request" jsonb NOT NULL,
	CONSTRAINT "meetup_operations_actor_id_operation_key_pk" PRIMARY KEY("actor_id","operation_key")
);
--> statement-breakpoint
CREATE TABLE "meetup_responses" (
	"meetup_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"trade_version" integer NOT NULL,
	"response" varchar(16) NOT NULL,
	CONSTRAINT "meetup_responses_meetup_id_user_id_revision_trade_version_pk" PRIMARY KEY("meetup_id","user_id","revision","trade_version"),
	CONSTRAINT "meetup_response_valid" CHECK ("meetup_responses"."response" IN ('confirmed','declined')),
	CONSTRAINT "meetup_response_versions_positive" CHECK ("meetup_responses"."revision" > 0 AND "meetup_responses"."trade_version" > 0)
);
--> statement-breakpoint
CREATE TABLE "meetups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trade_id" uuid NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"place" varchar(500),
	"map_link" varchar(2000),
	"meeting_at" timestamp with time zone NOT NULL,
	"time_zone" varchar(100) NOT NULL,
	CONSTRAINT "meetup_trade_unique" UNIQUE("trade_id"),
	CONSTRAINT "meetup_revision_positive" CHECK ("meetups"."revision" > 0),
	CONSTRAINT "meetup_place_valid" CHECK (("meetups"."place" IS NOT NULL OR "meetups"."map_link" IS NOT NULL) AND ("meetups"."place" IS NULL OR length(trim("meetups"."place")) > 0))
);
--> statement-breakpoint
ALTER TABLE "action_quotas" DROP CONSTRAINT "quota_action_valid";--> statement-breakpoint
ALTER TABLE "meetup_operations" ADD CONSTRAINT "meetup_operations_actor_id_profiles_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetup_operations" ADD CONSTRAINT "meetup_operations_meetup_id_meetups_id_fk" FOREIGN KEY ("meetup_id") REFERENCES "public"."meetups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetup_responses" ADD CONSTRAINT "meetup_responses_meetup_id_meetups_id_fk" FOREIGN KEY ("meetup_id") REFERENCES "public"."meetups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetup_responses" ADD CONSTRAINT "meetup_responses_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetups" ADD CONSTRAINT "meetups_trade_id_trades_id_fk" FOREIGN KEY ("trade_id") REFERENCES "public"."trades"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "meetup_operations_meetup_idx" ON "meetup_operations" USING btree ("meetup_id");--> statement-breakpoint
CREATE INDEX "meetup_responses_user_idx" ON "meetup_responses" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "action_quotas" ADD CONSTRAINT "quota_action_valid" CHECK ("action_quotas"."action" IN ('profile', 'avatar', 'listing', 'photo', 'block', 'report', 'conversation', 'message', 'trade', 'coffee', 'meeting'));
--> statement-breakpoint
ALTER TABLE public.meetups ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.meetups FROM PUBLIC,anon,authenticated,service_role;
CREATE POLICY runtime_meetups ON public.meetups TO swapcircle_runtime USING (true) WITH CHECK (true);
GRANT SELECT,INSERT,UPDATE ON public.meetups TO swapcircle_runtime;

--> statement-breakpoint
ALTER TABLE public.meetup_responses ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.meetup_responses FROM PUBLIC,anon,authenticated,service_role;
CREATE POLICY runtime_meetup_responses ON public.meetup_responses TO swapcircle_runtime USING (true) WITH CHECK (true);
GRANT SELECT,INSERT,UPDATE ON public.meetup_responses TO swapcircle_runtime;

--> statement-breakpoint
ALTER TABLE public.meetup_operations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.meetup_operations FROM PUBLIC,anon,authenticated,service_role;
CREATE POLICY runtime_meetup_operations ON public.meetup_operations TO swapcircle_runtime USING (true) WITH CHECK (true);
GRANT SELECT,INSERT ON public.meetup_operations TO swapcircle_runtime;
