CREATE TABLE "conversation_members" (
	"conversation_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversation_members_conversation_id_user_id_pk" PRIMARY KEY("conversation_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" varchar(16) NOT NULL,
	"direct_user_low" uuid,
	"direct_user_high" uuid,
	"last_message_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversations_direct_pair_unique" UNIQUE("direct_user_low","direct_user_high"),
	CONSTRAINT "conversation_identity_valid" CHECK (("conversations"."type" = 'direct' AND "conversations"."direct_user_low" IS NOT NULL AND "conversations"."direct_user_high" IS NOT NULL AND "conversations"."direct_user_low" < "conversations"."direct_user_high") OR ("conversations"."type" = 'group' AND "conversations"."direct_user_low" IS NULL AND "conversations"."direct_user_high" IS NULL)),
	CONSTRAINT "conversation_order_nonnegative" CHECK ("conversations"."last_message_order" >= 0)
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"sender_id" uuid NOT NULL,
	"body" varchar(5000) NOT NULL,
	"client_message_id" uuid NOT NULL,
	"message_order" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "messages_sender_client_unique" UNIQUE("sender_id","client_message_id"),
	CONSTRAINT "messages_conversation_order_unique" UNIQUE("conversation_id","message_order"),
	CONSTRAINT "message_body_nonempty" CHECK (length(trim("messages"."body")) > 0),
	CONSTRAINT "message_order_positive" CHECK ("messages"."message_order" > 0)
);
--> statement-breakpoint
ALTER TABLE "action_quotas" DROP CONSTRAINT "quota_action_valid";--> statement-breakpoint
ALTER TABLE "conversation_members" ADD CONSTRAINT "conversation_members_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_members" ADD CONSTRAINT "conversation_members_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_direct_user_low_profiles_id_fk" FOREIGN KEY ("direct_user_low") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_direct_user_high_profiles_id_fk" FOREIGN KEY ("direct_user_high") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_sender_id_profiles_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_sender_id_conversation_members_conversation_id_user_id_fk" FOREIGN KEY ("conversation_id","sender_id") REFERENCES "public"."conversation_members"("conversation_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "conversation_members_user_idx" ON "conversation_members" USING btree ("user_id","conversation_id");--> statement-breakpoint
CREATE INDEX "conversations_direct_high_idx" ON "conversations" USING btree ("direct_user_high");--> statement-breakpoint
CREATE INDEX "messages_sender_idx" ON "messages" USING btree ("sender_id");--> statement-breakpoint
ALTER TABLE "action_quotas" ADD CONSTRAINT "quota_action_valid" CHECK ("action_quotas"."action" IN ('profile', 'avatar', 'listing', 'photo', 'block', 'report', 'conversation'));
--> statement-breakpoint
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.conversations, public.conversation_members, public.messages FROM PUBLIC, anon, authenticated, service_role;
--> statement-breakpoint
-- Keep the membership lookup out of the exposed PostgREST schema and avoid recursive
-- membership policies. Identity is always auth.uid(), never a supplied reader ID.
CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated, service_role;
CREATE FUNCTION private.can_read_conversation(target uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM public.conversation_members
    WHERE conversation_id = target AND user_id = (SELECT auth.uid()) AND active)
  AND NOT EXISTS (SELECT 1 FROM public.account_restrictions WHERE user_id = (SELECT auth.uid()));
$$;
REVOKE ALL ON FUNCTION private.can_read_conversation(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.can_read_conversation(uuid) TO authenticated;
--> statement-breakpoint
CREATE POLICY member_conversations ON public.conversations FOR SELECT TO authenticated
  USING (private.can_read_conversation(id));
CREATE POLICY member_memberships ON public.conversation_members FOR SELECT TO authenticated
  USING (active AND private.can_read_conversation(conversation_id));
CREATE POLICY member_messages ON public.messages FOR SELECT TO authenticated
  USING (private.can_read_conversation(conversation_id));
GRANT SELECT ON public.conversations, public.conversation_members, public.messages TO authenticated;
--> statement-breakpoint
CREATE POLICY runtime_conversations ON public.conversations TO swapcircle_runtime USING (true) WITH CHECK (true);
CREATE POLICY runtime_memberships ON public.conversation_members TO swapcircle_runtime USING (true) WITH CHECK (true);
CREATE POLICY runtime_messages ON public.messages TO swapcircle_runtime USING (true) WITH CHECK (true);
GRANT SELECT, INSERT ON public.conversations, public.conversation_members, public.messages TO swapcircle_runtime;
GRANT UPDATE (last_message_order) ON public.conversations TO swapcircle_runtime;
--> statement-breakpoint
-- Direct identity is permanent; a group always has its own history.
CREATE FUNCTION public.guard_conversation_identity() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF (NEW.type, NEW.direct_user_low, NEW.direct_user_high) IS DISTINCT FROM
     (OLD.type, OLD.direct_user_low, OLD.direct_user_high) THEN
    RAISE EXCEPTION 'Conversation identity is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_conversation_identity() FROM PUBLIC, anon, authenticated, service_role, swapcircle_runtime;
CREATE TRIGGER conversation_identity BEFORE UPDATE ON public.conversations
  FOR EACH ROW EXECUTE FUNCTION public.guard_conversation_identity();
--> statement-breakpoint
CREATE FUNCTION public.guard_direct_membership() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.conversations WHERE id = NEW.conversation_id
    AND type = 'direct' AND NEW.user_id NOT IN (direct_user_low, direct_user_high)) THEN
    RAISE EXCEPTION 'Invalid direct member' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_direct_membership() FROM PUBLIC, anon, authenticated, service_role, swapcircle_runtime;
CREATE TRIGGER direct_membership BEFORE INSERT OR UPDATE ON public.conversation_members
  FOR EACH ROW EXECUTE FUNCTION public.guard_direct_membership();
--> statement-breakpoint
-- UPDATE obtains a row lock held until COMMIT. The next writer cannot allocate a
-- higher order until the previous transaction commits or rolls back. Do not use a
-- sequence, timestamps, or MAX(order)+1: those can skip a later-committing message.
-- Future send services must take ordered safety locks before this conversation lock,
-- and perform deduplication, current permissions and notifications in one transaction.
CREATE FUNCTION public.allocate_message_order() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  UPDATE public.conversations SET last_message_order = last_message_order + 1
    WHERE id = NEW.conversation_id RETURNING last_message_order INTO NEW.message_order;
  IF NOT FOUND OR NOT EXISTS (SELECT 1 FROM public.conversation_members
    WHERE conversation_id = NEW.conversation_id AND user_id = NEW.sender_id AND active) THEN
    RAISE EXCEPTION 'Inactive or missing sender membership' USING ERRCODE = '23514';
  END IF;
  NEW.created_at := statement_timestamp();
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.allocate_message_order() FROM PUBLIC, anon, authenticated, service_role, swapcircle_runtime;
CREATE TRIGGER message_order BEFORE INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.allocate_message_order();
