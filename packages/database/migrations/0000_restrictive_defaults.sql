-- Application runtime is not a schema owner, superuser, or RLS bypass role.
CREATE ROLE swapcircle_runtime NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
--> statement-breakpoint
REVOKE ALL ON SCHEMA public FROM PUBLIC, anon, authenticated, service_role;
GRANT USAGE ON SCHEMA public TO anon, authenticated, swapcircle_runtime;
--> statement-breakpoint
-- Defaults belong to the migration creator (postgres), not the runtime role.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM PUBLIC, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM PUBLIC, anon, authenticated, service_role;
--> statement-breakpoint
-- Function EXECUTE is granted to PUBLIC globally by PostgreSQL unless revoked
-- globally; a schema-local revoke alone cannot remove that global default.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
