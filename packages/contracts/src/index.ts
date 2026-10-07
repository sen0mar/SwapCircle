import { z } from 'zod';

export const livenessSchema = z.object({ status: z.literal('ok') });

export type Liveness = z.infer<typeof livenessSchema>;

export const readinessSchema = z.object({
  status: z.enum(['ready', 'unavailable']),
  revision: z.union([z.literal('unknown'), z.string().regex(/^[a-f0-9]{40}$/)]),
});

export type Readiness = z.infer<typeof readinessSchema>;

export const apiErrorSchema = z.object({
  error: z.object({
    code: z.string().regex(/^[A-Z_]{1,64}$/),
    message: z.string().max(200),
    requestId: z.uuid(),
  }),
});

export type ApiErrorResponse = z.infer<typeof apiErrorSchema>;

export const identitySchema = z.object({ userId: z.uuid() });

export type Identity = z.infer<typeof identitySchema>;

export const interestIdSchema = z.uuid();

export const interestSchema = z.object({
  id: interestIdSchema,
  name: z.string().min(1).max(80),
});

export type Interest = z.infer<typeof interestSchema>;

export const interestCatalogueSchema = z.array(interestSchema);

export const profileUpdateSchema = z.strictObject({
  displayName: z
    .string()
    .trim()
    .min(1, 'Enter a display name.')
    .max(80, 'Use at most 80 characters for your display name.'),
  biography: z
    .string()
    .trim()
    .max(1000, 'Use at most 1,000 characters for your biography.'),
  approximateLocation: z
    .string()
    .trim()
    .max(120, 'Use at most 120 characters for your approximate location.'),
  interestIds: z
    .array(interestIdSchema)
    .max(30)
    .refine(
      (ids) => new Set(ids).size === ids.length,
      'Duplicate interests are not allowed.',
    ),
});

export const publicProfileSchema = profileUpdateSchema
  .omit({ interestIds: true })
  .extend({
    id: z.uuid(),
    interests: interestCatalogueSchema,
    avatarUrl: z.url().nullable().default(null),
  });

export const currentProfileSchema = publicProfileSchema.extend({
  avatarCleanupPending: z.boolean().default(false),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
});

export type ProfileUpdate = z.infer<typeof profileUpdateSchema>;
export type PublicProfile = z.infer<typeof publicProfileSchema>;
export type CurrentProfile = z.infer<typeof currentProfileSchema>;

export const listingConditionSchema = z.enum([
  'like_new',
  'good',
  'fair',
  'poor',
]);
export const listingAvailabilitySchema = z.enum([
  'available',
  'withdrawn',
  'reserved',
  'exchanged',
  'disputed',
]);
export const listingCreateSchema = z.strictObject({
  title: z
    .string()
    .trim()
    .min(1, 'Enter an item title.')
    .max(120, 'Use at most 120 characters for the title.'),
  description: z
    .string()
    .trim()
    .min(1, 'Describe your item.')
    .max(5000, 'Use at most 5,000 characters for the description.'),
  condition: listingConditionSchema,
});
export const listingRevisionSchema = z.strictObject({
  revision: z.number().int().min(1).max(2147483646),
});
export const listingUpdateSchema = listingCreateSchema.extend(
  listingRevisionSchema.shape,
);
export const listingSchema = listingCreateSchema.extend({
  id: z.uuid(),
  ownerId: z.uuid(),
  availability: listingAvailabilitySchema,
  revision: z.number().int().positive(),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
});
// Keep the exact database timestamp in cursors: JS Dates truncate microseconds.
export const listingCursorSchema = z.strictObject({
  createdAt: z.iso.datetime({ offset: true }),
  id: z.uuid(),
});
export const listingQuerySchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().max(300).optional(),
});
export const catalogQuerySchema = listingQuerySchema.extend({
  q: z.string().trim().max(120).default(''),
  condition: listingConditionSchema.optional(),
  availability: z
    .enum(['all', 'available', 'reserved', 'exchanged', 'disputed'])
    .default('available'),
  sort: z.enum(['newest', 'oldest']).default('newest'),
  owner: z.uuid().optional(),
});
export type CatalogQuery = z.infer<typeof catalogQuerySchema>;

export const memberCursorSchema = z.strictObject({
  id: z.uuid(),
  sharedInterestCount: z.number().int().min(0).max(30),
});
export const memberQuerySchema = listingQuerySchema.extend({
  interest: z.uuid().optional(),
});
export const discoveredMemberSchema = publicProfileSchema.extend({
  sharedInterests: interestCatalogueSchema,
  sharedInterestCount: z.number().int().min(0).max(30).nullable(),
});
export const memberPageSchema = z.object({
  items: z.array(discoveredMemberSchema),
  nextCursor: z.string().nullable(),
});
export type DiscoveredMember = z.infer<typeof discoveredMemberSchema>;
export type MemberQuery = z.infer<typeof memberQuerySchema>;
export type MemberCursor = z.infer<typeof memberCursorSchema>;

export const listingPageSchema = z.object({
  items: z.array(listingSchema),
  nextCursor: z.string().nullable(),
});
export type Listing = z.infer<typeof listingSchema>;
export type ListingCreate = z.infer<typeof listingCreateSchema>;
export type ListingUpdate = z.infer<typeof listingUpdateSchema>;
export type ListingCursor = z.infer<typeof listingCursorSchema>;

export const listingPhotoSchema = z.object({
  id: z.uuid(),
  listingId: z.uuid(),
  position: z.number().int().min(0).max(2),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  bytes: z.number().int().positive(),
  url: z.url(),
});
export const listingPhotosSchema = z.array(listingPhotoSchema).max(3);
export type ListingPhoto = z.infer<typeof listingPhotoSchema>;

export const blockTargetSchema = z.strictObject({ userId: z.uuid() });
export const blockQuerySchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  after: z.uuid().optional(),
});
export const emptyResponseSchema = z.null();
export const safetyStatusQuerySchema = z.strictObject({
  userId: z.uuid().optional(),
});
export const safetyStatusSchema = z.object({
  restricted: z.boolean(),
  ownBlocked: z.boolean(),
});
export const blockSchema = z.object({
  userId: z.uuid(),
  displayName: z.string(),
  createdAt: z.iso.datetime(),
});
export const blockPageSchema = z.object({
  items: z.array(blockSchema),
  nextAfter: z.uuid().nullable(),
});
export const reportSubmissionSchema = z.strictObject({
  clientReportId: z.uuid(),
  targetType: z.enum(['member', 'listing']),
  targetId: z.uuid(),
  reason: z.string().trim().min(1).max(2000),
});
export const reportReceiptSchema = z.object({
  id: z.uuid(),
  createdAt: z.iso.datetime(),
});
export type ReportSubmission = z.infer<typeof reportSubmissionSchema>;
export type BlockQuery = z.infer<typeof blockQuerySchema>;

export const directConversationStartSchema = z.strictObject({
  userId: z.uuid().transform((value) => value.toLowerCase()),
});
export const directConversationReceiptSchema = z.object({
  id: z.uuid(),
  type: z.literal('direct'),
});

// Authorized Supabase read projections; do not include private profile fields.
export const conversationReadSchema = z.object({
  id: z.uuid(),
  type: z.enum(['direct', 'group']),
  direct_user_low: z.uuid().nullable(),
  direct_user_high: z.uuid().nullable(),
  created_at: z.string().datetime({ offset: true }),
});
export const messageReadSchema = z.object({
  id: z.uuid(),
  client_message_id: z.uuid(),
  conversation_id: z.uuid(),
  sender_id: z.uuid(),
  body: z.string().min(1).max(5000),
  message_order: z.number().int().positive(),
  created_at: z.string().datetime({ offset: true }),
});
export type ConversationRead = z.infer<typeof conversationReadSchema>;
export type MessageRead = z.infer<typeof messageReadSchema>;

export const messageSubmissionSchema = z.strictObject({
  conversation_id: z.uuid().transform((value) => value.toLowerCase()),
  body: z
    .string()
    .min(1)
    .max(5000)
    .refine((value) => value.trim().length > 0),
  client_message_id: z.uuid().transform((value) => value.toLowerCase()),
});
export const messageReceiptSchema = messageReadSchema.extend({
  client_message_id: z.uuid(),
});
export type MessageSubmission = z.infer<typeof messageSubmissionSchema>;
export type MessageReceipt = z.infer<typeof messageReceiptSchema>;

export const conversationReadUpdateSchema = z.strictObject({
  conversation_id: z.uuid(),
  message_id: z.uuid(),
});
export type ConversationReadUpdate = z.infer<
  typeof conversationReadUpdateSchema
>;
export const unreadStateSchema = z.object({
  lastViewedOrder: z.number().int().nonnegative(),
  unreadCount: z.number().int().nonnegative(),
});

// Domain notifications deliberately exclude ordinary messages and private text.
export const notificationEventTypeSchema = z.enum([
  'trade_invitation',
  'trade_status',
  'trade_revision',
  'group_invitation',
  'group_membership',
  'coffee_invitation',
  'coffee_response',
  'meeting_change',
]);
export const notificationResourceTypeSchema = z.enum([
  'trade',
  'conversation',
  'coffee_invitation',
  'meetup',
]);
export const notificationCreationSchema = z
  .strictObject({
    recipient_id: z.uuid().transform((value) => value.toLowerCase()),
    domain_event_id: z.uuid().transform((value) => value.toLowerCase()),
    event_type: notificationEventTypeSchema,
    resource_type: notificationResourceTypeSchema,
    resource_id: z.uuid().transform((value) => value.toLowerCase()),
  })
  .refine((value) => {
    const resource = {
      trade_invitation: 'trade',
      trade_status: 'trade',
      trade_revision: 'trade',
      group_invitation: 'conversation',
      group_membership: 'conversation',
      coffee_invitation: 'coffee_invitation',
      coffee_response: 'coffee_invitation',
      meeting_change: 'meetup',
    } as const;

    return resource[value.event_type] === value.resource_type;
  });
export type NotificationCreation = z.infer<typeof notificationCreationSchema>;
export const notificationReadSchema = z.object({
  id: z.uuid(),
  recipient_id: z.uuid(),
  domain_event_id: z.uuid(),
  event_type: notificationEventTypeSchema,
  resource_type: notificationResourceTypeSchema,
  resource_id: z.uuid(),
  created_at: z.string().datetime({ offset: true }),
  read_at: z.string().datetime({ offset: true }).nullable(),
});
export type NotificationRead = z.infer<typeof notificationReadSchema>;

export const notificationMarkReadSchema = z.strictObject({
  notification_id: z.uuid().transform((value) => value.toLowerCase()),
});
// Explicit IDs acknowledge the intended existing set, including on delayed retry.
// Larger sets can be sent in bounded batches; a timestamp cutoff can consume late commits.
export const notificationsMarkAllReadSchema = z.strictObject({
  notification_ids: z
    .array(z.uuid().transform((value) => value.toLowerCase()))
    .min(1)
    .max(100)
    .refine((ids) => new Set(ids).size === ids.length),
});
export const notificationsReadReceiptSchema = z.object({
  items: z
    .array(
      z.object({
        id: z.uuid(),
        read_at: z.string().datetime({ offset: true }),
      }),
    )
    .max(100),
});

export const tradeStatusSchema = z.enum([
  'proposed',
  'confirmed',
  'completed',
  'declined',
  'expired',
  'cancelled',
  'disputed',
]);
export const tradeInvitationStatusSchema = z.enum([
  'invited',
  'joined',
  'declined',
]);
export const proposalDraftSchema = z
  .strictObject({
    participantIds: z.array(z.uuid()).min(2),
    transfers: z.array(
      z.strictObject({
        listingId: z.uuid(),
        ownerId: z.uuid(),
        recipientId: z.uuid(),
      }),
    ),
    meetingMode: z.literal('meet_to_swap'),
  })
  .superRefine((draft, context) => {
    const participants = new Set(draft.participantIds);

    if (participants.size !== draft.participantIds.length)
      context.addIssue({ code: 'custom', message: 'Choose each person once.' });

    const offered = new Set<string>();
    const listings = new Set<string>();

    for (const transfer of draft.transfers) {
      if (
        !participants.has(transfer.ownerId) ||
        !participants.has(transfer.recipientId)
      )
        context.addIssue({
          code: 'custom',
          message: 'Every giver and recipient must be included.',
        });

      if (transfer.ownerId === transfer.recipientId)
        context.addIssue({
          code: 'custom',
          message: 'Choose a different recipient for each item.',
        });

      if (listings.has(transfer.listingId))
        context.addIssue({
          code: 'custom',
          message: 'Choose each item only once.',
        });

      offered.add(transfer.ownerId);
      listings.add(transfer.listingId);
    }

    for (const id of participants)
      if (!offered.has(id))
        context.addIssue({
          code: 'custom',
          message: 'Each person needs at least one offered item.',
        });
  });

export type ProposalDraft = z.infer<typeof proposalDraftSchema>;
export const proposalCreationSchema = proposalDraftSchema.safeExtend({
  operationKey: z.uuid(),
  expiresAt: z.iso.datetime({ offset: true }),
});
export const proposalRevisionSchema = proposalDraftSchema.safeExtend({
  expectedVersion: z.number().int().positive(),
  expiresAt: z.iso.datetime({ offset: true }),
});
export const tradeAcceptanceSchema = z.strictObject({
  expectedVersion: z.number().int().positive(),
  operationKey: z.uuid(),
});
export const tradeTransitionSchema = z.strictObject({
  expectedVersion: z.number().int().positive(),
  expectedStatus: z.enum(['proposed', 'confirmed']).optional(),
});
export type TradeTransition = z.infer<typeof tradeTransitionSchema>;
export const tradeTransitionResultSchema = z.strictObject({
  id: z.uuid(),
  currentVersion: z.number().int().positive(),
  status: z.enum(['declined', 'expired', 'cancelled']),
});

export type TradeAcceptance = z.infer<typeof tradeAcceptanceSchema>;
export const tradeAcceptanceResultSchema = z.strictObject({
  id: z.uuid(),
  acceptedVersion: z.number().int().positive(),
  status: z.enum(['proposed', 'confirmed']),
});

export type ProposalRevision = z.infer<typeof proposalRevisionSchema>;
export const tradeVersionParamsSchema = z.object({
  id: z.uuid(),
  version: z.coerce.number().int().positive(),
});
export type ProposalCreation = z.infer<typeof proposalCreationSchema>;
export const proposalCreationResultSchema = z.object({
  id: z.uuid(),
  currentVersion: z.number().int().positive(),
  status: tradeStatusSchema,
});
export const tradePageQuerySchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  after: z.uuid().optional(),
});
export const tradeIdParamsSchema = z.object({ id: z.uuid() });
export const tradeSummarySchema = z.object({
  id: z.uuid(),
  creatorId: z.uuid(),
  status: tradeStatusSchema,
  currentVersion: z.number().int().positive(),
  expiresAt: z.iso.datetime({ offset: true }),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
  participantCount: z.number().int().min(2),
  itemCount: z.number().int().min(1),
  hasUnavailableItems: z.boolean(),
});
export const tradePageSchema = z.object({
  items: z.array(tradeSummarySchema).max(50),
  nextAfter: z.uuid().nullable(),
});
export const tradeParticipantSchema = z.object({
  userId: z.uuid(),
  displayName: z.string(),
  invitationStatus: tradeInvitationStatusSchema,
  invitedAt: z.iso.datetime({ offset: true }),
  respondedAt: z.iso.datetime({ offset: true }).nullable(),
  acceptedVersion: z.number().int().positive().nullable(),
  acceptedAt: z.iso.datetime({ offset: true }).nullable(),
});
export const tradeItemSchema = z.object({
  id: z.uuid(),
  listingId: z.uuid(),
  ownerId: z.uuid(),
  recipientId: z.uuid(),
  listingRevision: z.number().int().positive(),
  titleSnapshot: z.string().min(1),
  descriptionSnapshot: z.string().min(1),
  conditionSnapshot: listingConditionSchema,
  currentAvailability: listingAvailabilitySchema.nullable(),
});
export const tradeEventSchema = z.object({
  id: z.uuid(),
  version: z.number().int().positive(),
  actorId: z.uuid(),
  eventType: z.enum([
    'proposed',
    'revised',
    'accepted',
    'confirmed',
    'completed',
    'declined',
    'expired',
    'cancelled',
    'disputed',
    'receipt_acknowledged',
    'handover_reported',
  ]),
  createdAt: z.iso.datetime({ offset: true }),
});
export const tradeDetailSchema = tradeSummarySchema.extend({
  participants: z.array(tradeParticipantSchema),
  items: z.array(tradeItemSchema),
  events: z.array(tradeEventSchema),
  groupConversationId: z.uuid().nullable().default(null),
});

export const tradeVersionSchema = z.object({
  tradeId: z.uuid(),
  version: z.number().int().positive(),
  participantIds: z.array(z.uuid()).min(2),
  expiresAt: z.iso.datetime({ offset: true }),
  createdBy: z.uuid(),
  createdAt: z.iso.datetime({ offset: true }),
  items: z.array(tradeItemSchema),
});

// Chat consent is independent of version-specific trade acceptance.
export const groupMembershipResponseSchema = z.strictObject({});
export const groupMembershipParamsSchema = z.strictObject({ id: z.uuid() });
export const groupMembershipStatusSchema = z.enum([
  'pending',
  'accepted',
  'declined',
  'left',
]);
export const groupMembershipReceiptSchema = z.object({
  conversationId: z.uuid(),
  status: groupMembershipStatusSchema,
  active: z.boolean(),
});
export type GroupMembershipStatus = z.infer<typeof groupMembershipStatusSchema>;

export const groupInvitationSchema = z.object({
  conversationId: z.uuid(),
  tradeId: z.uuid(),
  status: groupMembershipStatusSchema,
  active: z.boolean(),
  members: z.array(
    z.object({
      userId: z.uuid(),
      displayName: z.string(),
      status: groupMembershipStatusSchema,
      active: z.boolean(),
    }),
  ),
});

// Coffee consent belongs to an explicit pair, independently of trade consent.
export const coffeeSendSchema = z.strictObject({
  inviteeId: z.uuid(),
  operationKey: z.uuid(),
  offerToPay: z.boolean().default(false),
});

export const coffeeResponseSchema = z.strictObject({
  action: z.enum(['accept', 'decline', 'cancel']),
});

export const coffeeEligibilityQuerySchema = z.strictObject({
  inviteeId: z.uuid(),
});

export const coffeeEligibilitySchema = z.strictObject({
  tradeId: z.uuid(),
  inviterId: z.uuid(),
  inviteeId: z.uuid(),
  eligible: z.boolean(),
  sharedInterests: z.array(interestSchema),
});

export const coffeeInvitationSchema = z.strictObject({
  id: z.uuid(),
  tradeId: z.uuid(),
  inviterId: z.uuid(),
  inviteeId: z.uuid(),
  offerToPay: z.boolean(),
  status: z.enum(['pending', 'accepted', 'declined', 'cancelled']),
  createdAt: z.iso.datetime(),
  respondedAt: z.iso.datetime().nullable(),
});

export const coffeeInvitationListSchema = z.array(coffeeInvitationSchema);
export type CoffeeSend = z.infer<typeof coffeeSendSchema>;
export type CoffeeResponse = z.infer<typeof coffeeResponseSchema>;

export const coffeeInvitationParamsSchema = z.strictObject({
  id: z.uuid(),
  invitationId: z.uuid(),
});

// UTC instants are deliberate: callers resolve local DST ambiguity before sending.
export const meetingInstantSchema = z.iso
  .datetime({ precision: 3 })
  .refine(
    (value) =>
      Number.isFinite(Date.parse(value)) &&
      new Date(value).getUTCFullYear() >= 1 &&
      new Date(value).toISOString() === value,
    'Use a valid exact UTC instant with milliseconds.',
  );

export const meetingTimeZoneSchema = z
  .string()
  .min(1)
  .max(100)
  .refine((value) => {
    if (value !== 'UTC' && !value.includes('/')) return false;
    try {
      new Intl.DateTimeFormat('en', { timeZone: value });
      return true;
    } catch {
      return false;
    }
  }, 'Use a valid IANA time zone.');

export const meetingMapLinkSchema = z
  .url()
  .max(2000)
  .refine((value) => {
    return /^https:\/\/[^/@?#]+(?:[/?#]|$)/i.test(value);
  }, 'Use an HTTPS link without credentials.');

const meetingArrangementFields = {
  place: z.string().trim().min(1).max(500).nullable().default(null),
  mapLink: meetingMapLinkSchema.nullable().default(null),
  meetingAt: meetingInstantSchema,
  timeZone: meetingTimeZoneSchema,
};

export const meetingCreateSchema = z
  .strictObject({
    ...meetingArrangementFields,
    operationKey: z.uuid(),
    expectedTradeVersion: z.number().int().positive(),
  })
  .refine(
    (value) => value.place !== null || value.mapLink !== null,
    'Provide a place or map link.',
  );

export const meetingUpdateSchema = meetingCreateSchema.safeExtend({
  expectedRevision: z.number().int().positive(),
});

export const meetingResponseSchema = z.strictObject({
  operationKey: z.uuid(),
  expectedTradeVersion: z.number().int().positive(),
  expectedRevision: z.number().int().positive(),
  expectedResponse: z.enum(['confirmed', 'declined']).nullable(),
  response: z.enum(['confirmed', 'declined']),
});

export const meetupSchema = z.strictObject({
  ...meetingArrangementFields,
  id: z.uuid(),
  tradeId: z.uuid(),
  tradeVersion: z.number().int().positive(),
  revision: z.number().int().positive(),
  responses: z.array(
    z.strictObject({
      userId: z.uuid(),
      response: z.enum(['confirmed', 'declined']).nullable(),
    }),
  ),
});

export type MeetingCreate = z.infer<typeof meetingCreateSchema>;
export type MeetingUpdate = z.infer<typeof meetingUpdateSchema>;
export type MeetingResponse = z.infer<typeof meetingResponseSchema>;
export type Meetup = z.infer<typeof meetupSchema>;

// Verified identity supplies the participant; callers cannot acknowledge for others.
export const tradeReceiptSubmissionSchema = z.strictObject({
  operationKey: z.uuid(),
  expectedVersion: z.number().int().positive(),
});
export const tradeProblemSubmissionSchema = tradeReceiptSubmissionSchema.extend(
  {
    kind: z.enum(['problem', 'partial_handover']),
    reason: z.string().trim().min(1).max(2000),
  },
);
export const tradeOutcomeResultSchema = z.object({
  id: z.uuid(),
  currentVersion: z.number().int().positive(),
  status: z.enum(['confirmed', 'completed', 'disputed']),
});
export type TradeReceiptSubmission = z.infer<
  typeof tradeReceiptSubmissionSchema
>;
export type TradeProblemSubmission = z.infer<
  typeof tradeProblemSubmissionSchema
>;

// Login accepts existing credentials without imposing signup password policy.
export const passwordSignInSchema = z.strictObject({
  email: z.string().trim().pipe(z.email('Enter a valid email address.')),
  password: z.string().min(1, 'Enter your password.'),
});

export type PasswordSignIn = z.infer<typeof passwordSignInSchema>;
