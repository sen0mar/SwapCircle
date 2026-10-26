CREATE TABLE "proposal_meeting_operations" (
	"message_id" uuid NOT NULL,
	"operation_key" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"input" jsonb NOT NULL,
	CONSTRAINT "proposal_meeting_operations_message_id_operation_key_pk" PRIMARY KEY("message_id","operation_key")
);
--> statement-breakpoint
ALTER TABLE "message_proposal_responses" ADD COLUMN "meeting_revision" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "proposal_meeting_operations" ADD CONSTRAINT "proposal_meeting_operations_message_id_message_proposal_responses_message_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."message_proposal_responses"("message_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposal_meeting_operations" ADD CONSTRAINT "proposal_meeting_operations_actor_id_profiles_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE public.proposal_meeting_operations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.proposal_meeting_operations FROM PUBLIC,anon,authenticated,service_role;
CREATE POLICY runtime_proposal_meeting_operations ON public.proposal_meeting_operations
TO swapcircle_runtime USING (true) WITH CHECK (true);
GRANT SELECT,INSERT ON public.proposal_meeting_operations TO swapcircle_runtime;
GRANT UPDATE (meeting,meeting_revision) ON public.message_proposal_responses TO swapcircle_runtime;
--> statement-breakpoint
CREATE TRIGGER proposal_meeting_operations_append_only BEFORE UPDATE OR DELETE ON public.proposal_meeting_operations
FOR EACH ROW EXECUTE FUNCTION public.guard_trade_event_history();
