CREATE TABLE "message_proposal_responses" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"message_id" uuid PRIMARY KEY NOT NULL,
	"actor_id" uuid NOT NULL,
	"decision" varchar(16) NOT NULL,
	"responded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "message_proposal_responses_id_unique" UNIQUE("id"),
	CONSTRAINT "message_proposal_decision_valid" CHECK ("message_proposal_responses"."decision" IN ('accepted','refused'))
);
--> statement-breakpoint
ALTER TABLE "notifications" DROP CONSTRAINT "notification_resource_valid";--> statement-breakpoint
ALTER TABLE "message_proposal_responses" ADD CONSTRAINT "message_proposal_responses_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_proposal_responses" ADD CONSTRAINT "message_proposal_responses_actor_id_profiles_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "accepted_message_proposals_page_idx" ON "message_proposal_responses" USING btree ("responded_at","id") WHERE "message_proposal_responses"."decision" = 'accepted';--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notification_resource_valid" CHECK (("notifications"."event_type" IN ('trade_invitation', 'trade_status', 'trade_revision') AND "notifications"."resource_type" = 'trade') OR ("notifications"."event_type" IN ('group_invitation', 'group_membership', 'proposal_response') AND "notifications"."resource_type" = 'conversation') OR ("notifications"."event_type" IN ('coffee_invitation', 'coffee_response') AND "notifications"."resource_type" = 'coffee_invitation') OR ("notifications"."event_type" = 'meeting_change' AND "notifications"."resource_type" = 'meetup'));
--> statement-breakpoint
ALTER TABLE public.message_proposal_responses ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.message_proposal_responses FROM PUBLIC,anon,authenticated,service_role;
CREATE POLICY runtime_message_proposal_responses ON public.message_proposal_responses
TO swapcircle_runtime USING (true) WITH CHECK (true);
GRANT SELECT,INSERT ON public.message_proposal_responses TO swapcircle_runtime;
