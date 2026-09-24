CREATE TABLE "listing_photos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"listing_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"storage_key" text NOT NULL,
	"position" integer NOT NULL,
	"state" varchar(16) DEFAULT 'pending' NOT NULL,
	"width" integer,
	"height" integer,
	"bytes" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "listing_photos_storage_key_unique" UNIQUE("storage_key"),
	CONSTRAINT "listing_photos_position_unique" UNIQUE("listing_id","position") DEFERRABLE INITIALLY IMMEDIATE,
	CONSTRAINT "listing_photo_position_valid" CHECK ("listing_photos"."position" BETWEEN 0 AND 2),
	CONSTRAINT "listing_photo_state_valid" CHECK ("listing_photos"."state" IN ('pending', 'active', 'deleting')),
	CONSTRAINT "listing_photo_dimensions_valid" CHECK (("listing_photos"."state" <> 'active') OR ("listing_photos"."width" > 0 AND "listing_photos"."height" > 0 AND "listing_photos"."bytes" > 0))
);
--> statement-breakpoint
ALTER TABLE "listing_photos" ADD CONSTRAINT "listing_photos_owner_id_profiles_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "listings_id_owner_idx" ON "listings" USING btree ("id","owner_id");--> statement-breakpoint
ALTER TABLE "listing_photos" ADD CONSTRAINT "listing_photos_listing_id_owner_id_listings_id_owner_id_fk" FOREIGN KEY ("listing_id","owner_id") REFERENCES "public"."listings"("id","owner_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "listing_photos_owner_idx" ON "listing_photos" USING btree ("owner_id");--> statement-breakpoint
ALTER TABLE public.listing_photos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.listing_photos FROM PUBLIC, anon, authenticated;
CREATE POLICY runtime_listing_photos ON public.listing_photos TO swapcircle_runtime USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.listing_photos TO swapcircle_runtime;
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('item-media', 'item-media', true, 2097152, ARRAY['image/webp'])
ON CONFLICT (id) DO UPDATE SET public = EXCLUDED.public, file_size_limit = EXCLUDED.file_size_limit, allowed_mime_types = EXCLUDED.allowed_mime_types;
-- Service-role Storage requests bypass RLS; browsers have no write policy for this bucket.
CREATE POLICY item_media_deny_browser_insert ON storage.objects AS RESTRICTIVE FOR INSERT TO anon, authenticated WITH CHECK (bucket_id <> 'item-media');
CREATE POLICY item_media_deny_browser_update ON storage.objects AS RESTRICTIVE FOR UPDATE TO anon, authenticated USING (bucket_id <> 'item-media') WITH CHECK (bucket_id <> 'item-media');
CREATE POLICY item_media_deny_browser_delete ON storage.objects AS RESTRICTIVE FOR DELETE TO anon, authenticated USING (bucket_id <> 'item-media');
