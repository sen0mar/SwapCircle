CREATE TABLE "listings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"title" varchar(120) NOT NULL,
	"description" varchar(5000) NOT NULL,
	"condition" varchar(20) NOT NULL,
	"availability" varchar(20) DEFAULT 'available' NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "listing_title_nonempty" CHECK (length(trim("listings"."title")) > 0),
	CONSTRAINT "listing_description_nonempty" CHECK (length(trim("listings"."description")) > 0),
	CONSTRAINT "listing_condition_valid" CHECK ("listings"."condition" IN ('like_new', 'good', 'fair', 'poor')),
	CONSTRAINT "listing_availability_valid" CHECK ("listings"."availability" IN ('available', 'withdrawn', 'reserved', 'exchanged', 'disputed')),
	CONSTRAINT "listing_revision_positive" CHECK ("listings"."revision" > 0)
);
--> statement-breakpoint
ALTER TABLE "listings" ADD CONSTRAINT "listings_owner_id_profiles_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "listings_owner_idx" ON "listings" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "listings_page_idx" ON "listings" USING btree ("created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE public.listings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.listings FROM PUBLIC, anon, authenticated;
CREATE POLICY runtime_listings ON public.listings TO swapcircle_runtime USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE ON public.listings TO swapcircle_runtime;
