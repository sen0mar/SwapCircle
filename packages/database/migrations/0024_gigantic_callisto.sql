CREATE TABLE "message_photos" (
	"message_id" uuid PRIMARY KEY NOT NULL,
	"source_digest" varchar(64) NOT NULL,
	"photo_base64" text NOT NULL,
	CONSTRAINT "message_photo_size" CHECK (length("message_photos"."photo_base64") BETWEEN 1 AND 2796204)
);
--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "has_photo" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "message_photos" ADD CONSTRAINT "message_photos_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE public.message_photos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.message_photos FROM PUBLIC,anon,authenticated,service_role;
CREATE POLICY runtime_message_photos ON public.message_photos
TO swapcircle_runtime USING (true) WITH CHECK (true);
GRANT SELECT,INSERT ON public.message_photos TO swapcircle_runtime;
