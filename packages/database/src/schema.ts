import { relations, sql } from 'drizzle-orm';
import {
  pgTable,
  integer,
  index,
  check,
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

export const listings = pgTable(
  'listings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => profiles.id),
    title: varchar('title', { length: 120 }).notNull(),
    description: varchar('description', { length: 5000 }).notNull(),
    condition: varchar('condition', { length: 20 }).notNull(),
    availability: varchar('availability', { length: 20 })
      .notNull()
      .default('available'),
    revision: integer('revision').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('listings_owner_idx').on(table.ownerId),
    index('listings_page_idx').on(table.createdAt.desc(), table.id.desc()),
    check('listing_title_nonempty', sql`length(trim(${table.title})) > 0`),
    check(
      'listing_description_nonempty',
      sql`length(trim(${table.description})) > 0`,
    ),
    check(
      'listing_condition_valid',
      sql`${table.condition} IN ('like_new', 'good', 'fair', 'poor')`,
    ),
    check(
      'listing_availability_valid',
      sql`${table.availability} IN ('available', 'withdrawn', 'reserved', 'exchanged', 'disputed')`,
    ),
    check('listing_revision_positive', sql`${table.revision} > 0`),
  ],
);
