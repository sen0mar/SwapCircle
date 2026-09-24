CREATE TABLE "avatar_cleanup" (
	"storage_key" text PRIMARY KEY NOT NULL,
	"owner_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "avatar_cleanup" ADD CONSTRAINT "avatar_cleanup_owner_id_profiles_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "avatar_cleanup_owner_idx" ON "avatar_cleanup" USING btree ("owner_id");
--> statement-breakpoint
ALTER TABLE public.avatar_cleanup ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.avatar_cleanup FROM PUBLIC, anon, authenticated;
CREATE POLICY runtime_avatar_cleanup ON public.avatar_cleanup TO swapcircle_runtime USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, DELETE ON public.avatar_cleanup TO swapcircle_runtime;
