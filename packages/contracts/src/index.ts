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
