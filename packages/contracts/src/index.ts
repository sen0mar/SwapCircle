import { z } from 'zod';

export const livenessSchema = z.object({ status: z.literal('ok') });

export type Liveness = z.infer<typeof livenessSchema>;

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
  displayName: z.string().trim().min(1).max(80),
  biography: z.string().trim().max(1000),
  approximateLocation: z.string().trim().max(120),
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
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().min(1).max(5000),
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
});
export const tradeEventSchema = z.object({
  id: z.uuid(),
  version: z.number().int().positive(),
  actorId: z.uuid(),
  eventType: z.enum([
    'proposed',
    'revised',
    'confirmed',
    'completed',
    'declined',
    'expired',
    'cancelled',
    'disputed',
  ]),
  createdAt: z.iso.datetime({ offset: true }),
});
export const tradeDetailSchema = tradeSummarySchema.extend({
  participants: z.array(tradeParticipantSchema),
  items: z.array(tradeItemSchema),
  events: z.array(tradeEventSchema),
});
