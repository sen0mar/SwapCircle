CREATE INDEX "reports_member_idx" ON "reports" USING btree ("reported_user_id");--> statement-breakpoint
CREATE INDEX "reports_listing_idx" ON "reports" USING btree ("listing_id");