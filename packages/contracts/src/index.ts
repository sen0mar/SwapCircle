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
