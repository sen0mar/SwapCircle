CREATE TABLE "conversation_reads" (
	"conversation_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"last_viewed_order" integer NOT NULL,
	CONSTRAINT "conversation_reads_conversation_id_user_id_pk" PRIMARY KEY("conversation_id","user_id"),
	CONSTRAINT "read_order_positive" CHECK ("conversation_reads"."last_viewed_order" > 0)
);
--> statement-breakpoint
ALTER TABLE "conversation_reads" ADD CONSTRAINT "conversation_reads_conversation_id_user_id_conversation_members_conversation_id_user_id_fk" FOREIGN KEY ("conversation_id","user_id") REFERENCES "public"."conversation_members"("conversation_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE public.conversation_reads ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.conversation_reads FROM PUBLIC, anon, authenticated, service_role;
CREATE POLICY own_read_progress ON public.conversation_reads FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()) AND private.can_read_conversation(conversation_id));
GRANT SELECT ON public.conversation_reads TO authenticated;
CREATE POLICY runtime_read_progress ON public.conversation_reads TO swapcircle_runtime USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE ON public.conversation_reads TO swapcircle_runtime;
ALTER PUBLICATION supabase_realtime ADD TABLE public.conversation_reads;
--> statement-breakpoint
-- Runtime may lock membership for authorization without gaining membership writes.
CREATE FUNCTION private.lock_conversation_reader(target uuid, actor uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM 1 FROM public.conversation_members
    WHERE conversation_id=target AND user_id=actor AND active FOR SHARE;
  RETURN FOUND;
END;
$$;
REVOKE ALL ON FUNCTION private.lock_conversation_reader(uuid,uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT USAGE ON SCHEMA private TO swapcircle_runtime;
GRANT EXECUTE ON FUNCTION private.lock_conversation_reader(uuid,uuid) TO swapcircle_runtime;
