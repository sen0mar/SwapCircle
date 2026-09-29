-- RLS remains the delivery boundary; never publish private application tables wholesale.
ALTER PUBLICATION supabase_realtime ADD TABLE public.messages, public.conversations, public.conversation_members;
--> statement-breakpoint
-- A departing member may observe their own membership revocation, but no history
-- or other members after leaving. Postgres Changes cannot deliver a row hidden by RLS.
CREATE POLICY own_membership_status ON public.conversation_members FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));
