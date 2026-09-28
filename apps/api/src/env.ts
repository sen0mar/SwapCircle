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
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  DATABASE_URL: z.string().min(1),
  WRITE_ALLOWANCE: z.coerce.number().int().min(1).max(100000).default(120),
  WRITE_WINDOW_SECONDS: z.coerce
    .number()
    .int()
    .min(1)
    .max(604800)
    .default(3600),
  WRITE_BURST_MAX: z.coerce.number().int().min(1).max(100000).default(60),
  WRITE_BURST_WINDOW_MS: z.coerce
    .number()
    .int()
    .min(1000)
    .max(3600000)
    .default(60000),
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
    limits: {
      allowance: result.data.WRITE_ALLOWANCE,
      windowSeconds: result.data.WRITE_WINDOW_SECONDS,
      burstMax: result.data.WRITE_BURST_MAX,
      burstWindowMs: result.data.WRITE_BURST_WINDOW_MS,
    },
    port: result.data.PORT,
    allowedOrigins: result.data.CORS_ORIGINS,
    supabaseUrl: result.data.SUPABASE_URL,
    supabasePublishableKey: result.data.SUPABASE_PUBLISHABLE_KEY,
    supabaseServiceRoleKey: result.data.SUPABASE_SERVICE_ROLE_KEY,
    databaseUrl: result.data.DATABASE_URL,
  };
}
