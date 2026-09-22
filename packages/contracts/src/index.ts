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
  });

export const currentProfileSchema = publicProfileSchema.extend({
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
});

export type ProfileUpdate = z.infer<typeof profileUpdateSchema>;
export type PublicProfile = z.infer<typeof publicProfileSchema>;
export type CurrentProfile = z.infer<typeof currentProfileSchema>;
