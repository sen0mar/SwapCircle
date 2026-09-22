import { relations } from 'drizzle-orm';
import {
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

export const profiles = pgTable('profiles', {
  id: uuid('id').primaryKey(),
  displayName: varchar('display_name', { length: 80 }).notNull(),
  biography: varchar('biography', { length: 1000 }).notNull().default(''),
  approximateLocation: varchar('approximate_location', { length: 120 })
    .notNull()
    .default(''),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const interests = pgTable('interests', {
  id: uuid('id').primaryKey(),
  name: varchar('name', { length: 80 }).notNull().unique(),
});

export const profileInterests = pgTable(
  'profile_interests',
  {
    profileId: uuid('profile_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    interestId: uuid('interest_id')
      .notNull()
      .references(() => interests.id),
  },
  (table) => [primaryKey({ columns: [table.profileId, table.interestId] })],
);

// Private restriction records are never part of a public profile response.
export const accountRestrictions = pgTable('account_restrictions', {
  userId: uuid('user_id').primaryKey(),
  restrictedAt: timestamp('restricted_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  reason: text('reason').notNull(),
});

export const profilesRelations = relations(profiles, ({ many }) => ({
  interests: many(profileInterests),
}));
export const profileInterestsRelations = relations(
  profileInterests,
  ({ one }) => ({
    profile: one(profiles, {
      fields: [profileInterests.profileId],
      references: [profiles.id],
    }),
    interest: one(interests, {
      fields: [profileInterests.interestId],
      references: [interests.id],
    }),
  }),
);
