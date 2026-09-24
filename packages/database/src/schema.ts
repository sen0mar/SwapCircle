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
  uniqueIndex,
  unique,
  foreignKey,
} from 'drizzle-orm/pg-core';

export const profiles = pgTable('profiles', {
  id: uuid('id').primaryKey(),
  displayName: varchar('display_name', { length: 80 }).notNull(),
  biography: varchar('biography', { length: 1000 }).notNull().default(''),
  approximateLocation: varchar('approximate_location', { length: 120 })
    .notNull()
    .default(''),
  avatarStorageKey: text('avatar_storage_key'),
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
    uniqueIndex('listings_id_owner_idx').on(table.id, table.ownerId),
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

export const listingPhotos = pgTable(
  'listing_photos',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    listingId: uuid('listing_id').notNull(),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => profiles.id),
    storageKey: text('storage_key').notNull().unique(),
    position: integer('position').notNull(),
    state: varchar('state', { length: 16 }).notNull().default('pending'),
    width: integer('width'),
    height: integer('height'),
    bytes: integer('bytes'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique('listing_photos_position_unique').on(
      table.listingId,
      table.position,
    ),
    foreignKey({
      columns: [table.listingId, table.ownerId],
      foreignColumns: [listings.id, listings.ownerId],
    }),
    index('listing_photos_owner_idx').on(table.ownerId),
    check(
      'listing_photo_position_valid',
      sql`${table.position} BETWEEN 0 AND 2`,
    ),
    check(
      'listing_photo_state_valid',
      sql`${table.state} IN ('pending', 'active', 'deleting')`,
    ),
    check(
      'listing_photo_dimensions_valid',
      sql`(${table.state} <> 'active') OR (${table.width} > 0 AND ${table.height} > 0 AND ${table.bytes} > 0)`,
    ),
  ],
);
