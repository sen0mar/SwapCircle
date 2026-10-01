import { relations, sql } from 'drizzle-orm';
import {
  pgTable,
  integer,
  boolean,
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

export const avatarCleanup = pgTable(
  'avatar_cleanup',
  {
    storageKey: text('storage_key').primaryKey(),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index('avatar_cleanup_owner_idx').on(table.ownerId)],
);

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
    index('listings_search_idx').using(
      'gin',
      sql`to_tsvector('english', ${table.title} || ' ' || ${table.description})`,
    ),
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

export const blocks = pgTable(
  'blocks',
  {
    blockerId: uuid('blocker_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    blockedId: uuid('blocked_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.blockerId, table.blockedId] }),
    index('blocks_blocked_idx').on(table.blockedId),
    check(
      'blocks_distinct_users',
      sql`${table.blockerId} <> ${table.blockedId}`,
    ),
  ],
);

export const reports = pgTable(
  'reports',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    reporterId: uuid('reporter_id')
      .notNull()
      .references(() => profiles.id),
    clientReportId: uuid('client_report_id').notNull(),
    reportedUserId: uuid('reported_user_id').references(() => profiles.id),
    listingId: uuid('listing_id').references(() => listings.id),
    reason: varchar('reason', { length: 2000 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique('reports_retry_unique').on(table.reporterId, table.clientReportId),
    index('reports_member_idx').on(table.reportedUserId),
    index('reports_listing_idx').on(table.listingId),
    check(
      'reports_one_target',
      sql`(${table.reportedUserId} IS NOT NULL) <> (${table.listingId} IS NOT NULL)`,
    ),
    check('reports_reason_nonempty', sql`length(trim(${table.reason})) > 0`),
  ],
);

export const actionQuotas = pgTable(
  'action_quotas',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    action: varchar('action', { length: 32 }).notNull(),
    windowStartedAt: timestamp('window_started_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    used: integer('used').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.action] }),
    check('quota_used_positive', sql`${table.used} > 0`),
    check(
      'quota_action_valid',
      sql`${table.action} IN ('profile', 'avatar', 'listing', 'photo', 'block', 'report', 'conversation', 'message', 'trade')`,
    ),
  ],
);

export const conversations = pgTable(
  'conversations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    type: varchar('type', { length: 16 }).notNull(),
    tradeId: uuid('trade_id').references(() => trades.id),
    directUserLow: uuid('direct_user_low').references(() => profiles.id),
    directUserHigh: uuid('direct_user_high').references(() => profiles.id),
    lastMessageOrder: integer('last_message_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique('conversations_direct_pair_unique').on(
      table.directUserLow,
      table.directUserHigh,
    ),
    index('conversations_direct_high_idx').on(table.directUserHigh),
    unique('conversations_trade_unique').on(table.tradeId),
    check(
      'conversation_trade_group',
      sql`${table.tradeId} IS NULL OR ${table.type} = 'group'`,
    ),
    check(
      'conversation_identity_valid',
      sql`(${table.type} = 'direct' AND ${table.directUserLow} IS NOT NULL AND ${table.directUserHigh} IS NOT NULL AND ${table.directUserLow} < ${table.directUserHigh}) OR (${table.type} = 'group' AND ${table.directUserLow} IS NULL AND ${table.directUserHigh} IS NULL)`,
    ),
    check(
      'conversation_order_nonnegative',
      sql`${table.lastMessageOrder} >= 0`,
    ),
  ],
);

export const conversationMembers = pgTable(
  'conversation_members',
  {
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => profiles.id),
    active: boolean('active').notNull().default(true),
    status: varchar('status', { length: 16 }).notNull().default('accepted'),
    respondedAt: timestamp('responded_at', { withTimezone: true }),
    joinedAt: timestamp('joined_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      'membership_status_valid',
      sql`${table.status} IN ('pending', 'accepted', 'declined', 'left')`,
    ),
    check(
      'membership_active_accepted',
      sql`NOT ${table.active} OR ${table.status} = 'accepted'`,
    ),
    primaryKey({ columns: [table.conversationId, table.userId] }),
    index('conversation_members_user_idx').on(
      table.userId,
      table.conversationId,
    ),
  ],
);

export const conversationMembershipEvents = pgTable(
  'conversation_membership_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    actorId: uuid('actor_id')
      .notNull()
      .references(() => profiles.id),
    eventType: varchar('event_type', { length: 16 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('membership_events_conversation_idx').on(table.conversationId),
    check(
      'membership_event_type_valid',
      sql`${table.eventType} IN ('invited', 'accepted', 'declined', 'left')`,
    ),
  ],
);

export const messages = pgTable(
  'messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    senderId: uuid('sender_id')
      .notNull()
      .references(() => profiles.id),
    body: varchar('body', { length: 5000 }).notNull(),
    clientMessageId: uuid('client_message_id').notNull(),
    messageOrder: integer('message_order').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique('messages_sender_client_unique').on(
      table.senderId,
      table.clientMessageId,
    ),
    unique('messages_conversation_order_unique').on(
      table.conversationId,
      table.messageOrder,
    ),
    index('messages_sender_idx').on(table.senderId),
    foreignKey({
      columns: [table.conversationId, table.senderId],
      foreignColumns: [
        conversationMembers.conversationId,
        conversationMembers.userId,
      ],
    }),
    check('message_body_nonempty', sql`length(trim(${table.body})) > 0`),
    check('message_order_positive', sql`${table.messageOrder} > 0`),
  ],
);

// Read progress is private even from other members of the same conversation.
export const conversationReads = pgTable(
  'conversation_reads',
  {
    conversationId: uuid('conversation_id').notNull(),
    userId: uuid('user_id').notNull(),
    lastViewedOrder: integer('last_viewed_order').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.conversationId, table.userId] }),
    foreignKey({
      columns: [table.conversationId, table.userId],
      foreignColumns: [
        conversationMembers.conversationId,
        conversationMembers.userId,
      ],
    }).onDelete('cascade'),
    check('read_order_positive', sql`${table.lastViewedOrder} > 0`),
  ],
);

// References are typed UUIDs, not authorization grants. Target tables/services
// arrive with their domains; readers must reauthorize any target before opening it.
export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    recipientId: uuid('recipient_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    domainEventId: uuid('domain_event_id').notNull(),
    eventType: varchar('event_type', { length: 32 }).notNull(),
    resourceType: varchar('resource_type', { length: 32 }).notNull(),
    resourceId: uuid('resource_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    readAt: timestamp('read_at', { withTimezone: true }),
  },
  (table) => [
    unique('notifications_event_recipient_unique').on(
      table.domainEventId,
      table.recipientId,
    ),
    index('notifications_recipient_created_idx').on(
      table.recipientId,
      table.createdAt,
      table.id,
    ),
    index('notifications_recipient_unread_idx')
      .on(table.recipientId)
      .where(sql`${table.readAt} IS NULL`),
    check(
      'notification_resource_valid',
      sql`(${table.eventType} IN ('trade_invitation', 'trade_status', 'trade_revision') AND ${table.resourceType} = 'trade') OR (${table.eventType} IN ('group_invitation', 'group_membership') AND ${table.resourceType} = 'conversation') OR (${table.eventType} IN ('coffee_invitation', 'coffee_response') AND ${table.resourceType} = 'coffee_invitation') OR (${table.eventType} = 'meeting_change' AND ${table.resourceType} = 'meetup')`,
    ),
  ],
);

export const trades = pgTable(
  'trades',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    creatorId: uuid('creator_id')
      .notNull()
      .references(() => profiles.id),
    operationKey: uuid('operation_key'),
    operationHash: varchar('operation_hash', { length: 64 }),
    status: varchar('status', { length: 16 }).notNull().default('proposed'),
    currentVersion: integer('current_version').notNull().default(1),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('trades_creator_idx').on(table.creatorId),
    unique('trades_creator_operation_unique').on(
      table.creatorId,
      table.operationKey,
    ),
    check(
      'trade_operation_pair_valid',
      sql`(${table.operationKey} IS NULL) = (${table.operationHash} IS NULL)`,
    ),
    check(
      'trade_status_valid',
      sql`${table.status} IN ('proposed','confirmed','completed','declined','expired','cancelled','disputed')`,
    ),
    check('trade_version_positive', sql`${table.currentVersion} > 0`),
    check(
      'trade_expiry_after_creation',
      sql`${table.expiresAt} > ${table.createdAt}`,
    ),
  ],
);

export const tradeVersions = pgTable(
  'trade_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tradeId: uuid('trade_id')
      .notNull()
      .references(() => trades.id),
    version: integer('version').notNull(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => profiles.id),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique('trade_versions_number_unique').on(table.tradeId, table.version),
    unique('trade_versions_id_trade_unique').on(table.id, table.tradeId),
    check('trade_versions_positive', sql`${table.version} > 0`),
  ],
);

export const tradeParticipants = pgTable(
  'trade_participants',
  {
    tradeId: uuid('trade_id')
      .notNull()
      .references(() => trades.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => profiles.id),
    invitationStatus: varchar('invitation_status', { length: 16 })
      .notNull()
      .default('invited'),
    invitedAt: timestamp('invited_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    respondedAt: timestamp('responded_at', { withTimezone: true }),
    acceptedVersion: integer('accepted_version'),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
  },
  (table) => [
    primaryKey({ columns: [table.tradeId, table.userId] }),
    index('trade_participants_user_idx').on(table.userId, table.tradeId),
    check(
      'trade_invitation_valid',
      sql`${table.invitationStatus} IN ('invited','joined','declined')`,
    ),
    check(
      'trade_acceptance_pair_valid',
      sql`(${table.acceptedVersion} IS NULL AND ${table.acceptedAt} IS NULL) OR (${table.acceptedVersion} > 0 AND ${table.acceptedAt} IS NOT NULL)`,
    ),
    foreignKey({
      columns: [table.tradeId, table.acceptedVersion],
      foreignColumns: [tradeVersions.tradeId, tradeVersions.version],
    }),
  ],
);

export const tradeItems = pgTable(
  'trade_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tradeId: uuid('trade_id').notNull(),
    versionId: uuid('version_id').notNull(),
    listingId: uuid('listing_id').notNull(),
    ownerId: uuid('owner_id').notNull(),
    recipientId: uuid('recipient_id').notNull(),
    listingRevision: integer('listing_revision').notNull(),
    titleSnapshot: varchar('title_snapshot', { length: 120 }).notNull(),
    descriptionSnapshot: varchar('description_snapshot', {
      length: 5000,
    }).notNull(),
    conditionSnapshot: varchar('condition_snapshot', { length: 20 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique('trade_items_version_listing_unique').on(
      table.versionId,
      table.listingId,
    ),
    index('trade_items_owner_idx').on(table.ownerId),
    index('trade_items_recipient_idx').on(table.recipientId),
    foreignKey({
      columns: [table.versionId, table.tradeId],
      foreignColumns: [tradeVersions.id, tradeVersions.tradeId],
    }),
    foreignKey({
      columns: [table.listingId, table.ownerId],
      foreignColumns: [listings.id, listings.ownerId],
    }),
    foreignKey({
      columns: [table.tradeId, table.ownerId],
      foreignColumns: [tradeParticipants.tradeId, tradeParticipants.userId],
    }),
    foreignKey({
      columns: [table.tradeId, table.recipientId],
      foreignColumns: [tradeParticipants.tradeId, tradeParticipants.userId],
    }),
    check(
      'trade_item_distinct_users',
      sql`${table.ownerId} <> ${table.recipientId}`,
    ),
    check('trade_item_revision_positive', sql`${table.listingRevision} > 0`),
    check(
      'trade_item_title_nonempty',
      sql`length(trim(${table.titleSnapshot})) > 0`,
    ),
    check(
      'trade_item_description_nonempty',
      sql`length(trim(${table.descriptionSnapshot})) > 0`,
    ),
    check(
      'trade_item_condition_valid',
      sql`${table.conditionSnapshot} IN ('like_new','good','fair','poor')`,
    ),
  ],
);

export const tradeEvents = pgTable(
  'trade_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tradeId: uuid('trade_id')
      .notNull()
      .references(() => trades.id),
    versionId: uuid('version_id').notNull(),
    actorId: uuid('actor_id').notNull(),
    eventType: varchar('event_type', { length: 32 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('trade_events_trade_created_idx').on(
      table.tradeId,
      table.createdAt,
      table.id,
    ),
    foreignKey({
      columns: [table.versionId, table.tradeId],
      foreignColumns: [tradeVersions.id, tradeVersions.tradeId],
    }),
    foreignKey({
      columns: [table.tradeId, table.actorId],
      foreignColumns: [tradeParticipants.tradeId, tradeParticipants.userId],
    }),
    check(
      'trade_event_type_valid',
      sql`${table.eventType} IN ('proposed','revised','confirmed','completed','declined','expired','cancelled','disputed')`,
    ),
  ],
);
