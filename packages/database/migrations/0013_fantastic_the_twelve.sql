CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recipient_id" uuid NOT NULL,
	"domain_event_id" uuid NOT NULL,
	"event_type" varchar(32) NOT NULL,
	"resource_type" varchar(32) NOT NULL,
	"resource_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"read_at" timestamp with time zone,
	CONSTRAINT "notifications_event_recipient_unique" UNIQUE("domain_event_id","recipient_id"),
	CONSTRAINT "notification_resource_valid" CHECK (("notifications"."event_type" IN ('trade_invitation', 'trade_status', 'trade_revision') AND "notifications"."resource_type" = 'trade') OR ("notifications"."event_type" = 'group_invitation' AND "notifications"."resource_type" = 'conversation') OR ("notifications"."event_type" IN ('coffee_invitation', 'coffee_response') AND "notifications"."resource_type" = 'coffee_invitation') OR ("notifications"."event_type" = 'meeting_change' AND "notifications"."resource_type" = 'meetup'))
);
--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipient_id_profiles_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notifications_recipient_created_idx" ON "notifications" USING btree ("recipient_id","created_at","id");--> statement-breakpoint
CREATE INDEX "notifications_recipient_unread_idx" ON "notifications" USING btree ("recipient_id") WHERE "notifications"."read_at" IS NULL;--> statement-breakpoint
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.notifications FROM PUBLIC, anon, authenticated, service_role;
-- Keep restriction checks out of the exposed RPC schema. No client-selected identity.
CREATE FUNCTION private.can_read_notifications() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT NOT EXISTS (SELECT 1 FROM public.account_restrictions WHERE user_id = (SELECT auth.uid()));
$$;
REVOKE ALL ON FUNCTION private.can_read_notifications() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.can_read_notifications() TO authenticated;
CREATE POLICY recipient_notifications ON public.notifications FOR SELECT TO authenticated
  USING (recipient_id = (SELECT auth.uid()) AND (SELECT private.can_read_notifications()));
GRANT SELECT ON public.notifications TO authenticated;
CREATE POLICY runtime_notifications ON public.notifications TO swapcircle_runtime USING (true) WITH CHECK (true);
GRANT SELECT, INSERT ON public.notifications TO swapcircle_runtime;
GRANT UPDATE (read_at) ON public.notifications TO swapcircle_runtime;
ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
