import { z } from 'zod';

const origin = z
  .string()
  .url()
  .refine((value) => {
    const url = URL.parse(value);
    return (
      url !== null &&
      ['http:', 'https:'].includes(url.protocol) &&
      url.origin === value
    );
  });
const environmentSchema = z.object({
  SUPABASE_URL: origin,
  SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  CORS_ORIGINS: z
    .string()
    .transform((value) => value.split(',').map((item) => item.trim()))
    .pipe(z.array(origin).min(1)),
});
export function readEnvironment(
  environment: Record<string, string | undefined>,
) {
  const result = environmentSchema.safeParse(environment);
  if (!result.success) {
    const fields = [
      ...new Set(result.error.issues.map((issue) => issue.path[0])),
    ];
    throw new Error(`Invalid server configuration: ${fields.join(', ')}`);
  }
  return {
    port: result.data.PORT,
    allowedOrigins: result.data.CORS_ORIGINS,
    supabaseUrl: result.data.SUPABASE_URL,
    supabasePublishableKey: result.data.SUPABASE_PUBLISHABLE_KEY,
  };
}
