CREATE TABLE "account_restrictions" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"restricted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reason" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "interests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" varchar(80) NOT NULL,
	CONSTRAINT "interests_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "profile_interests" (
	"profile_id" uuid NOT NULL,
	"interest_id" uuid NOT NULL,
	CONSTRAINT "profile_interests_profile_id_interest_id_pk" PRIMARY KEY("profile_id","interest_id")
);
--> statement-breakpoint
CREATE TABLE "profiles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"display_name" varchar(80) NOT NULL,
	"biography" varchar(1000) DEFAULT '' NOT NULL,
	"approximate_location" varchar(120) DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "profile_interests" ADD CONSTRAINT "profile_interests_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_interests" ADD CONSTRAINT "profile_interests_interest_id_interests_id_fk" FOREIGN KEY ("interest_id") REFERENCES "public"."interests"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE public.profiles ADD CONSTRAINT profiles_auth_user_fk FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE public.account_restrictions ADD CONSTRAINT account_restrictions_auth_user_fk FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
--> statement-breakpoint
CREATE INDEX profile_interests_interest_id_idx ON public.profile_interests (interest_id);
--> statement-breakpoint
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.interests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profile_interests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_restrictions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY runtime_profiles ON public.profiles TO swapcircle_runtime USING (true) WITH CHECK (true);
CREATE POLICY runtime_interests ON public.interests TO swapcircle_runtime USING (true);
CREATE POLICY runtime_profile_interests ON public.profile_interests TO swapcircle_runtime USING (true) WITH CHECK (true);
CREATE POLICY runtime_account_restrictions ON public.account_restrictions TO swapcircle_runtime USING (true);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON public.profiles TO swapcircle_runtime;
GRANT SELECT ON public.interests TO swapcircle_runtime;
GRANT SELECT, INSERT, DELETE ON public.profile_interests TO swapcircle_runtime;
GRANT SELECT ON public.account_restrictions TO swapcircle_runtime;
--> statement-breakpoint
INSERT INTO public.interests (id, name) VALUES
  ('0e2e936d-6c7c-4818-94d7-33831af8fd55', 'Books'),
  ('ff70f53b-dcd6-49ee-9b17-af6cb7481114', 'Cooking'),
  ('c266e9f8-f2d3-4328-a149-42517161c5f0', 'Gardening'),
  ('38e78063-a1c1-4ad9-a024-30df1c7925ed', 'Music'),
  ('195785b7-dbbe-4a08-96a2-48eae0b55458', 'Outdoors'),
  ('628efae7-41aa-48ba-abcb-475600a89cd3', 'Repair');
