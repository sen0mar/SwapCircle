import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';

const claimsSchema = z.object({
  sub: z.uuid(),
  iss: z.string(),
  aud: z.union([z.string(), z.array(z.string())]),
  exp: z.number().int(),
  role: z.literal('authenticated'),
});

export type VerifyToken = (token: string) => Promise<string | null>;

export function createTokenVerifier(
  url: string,
  publishableKey: string,
): VerifyToken {
  const client = createClient(url, publishableKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });

  return async (token) => {
    try {
      const { data, error } = await client.auth.getClaims(token);

      if (error) return null;

      const parsed = claimsSchema.safeParse(data?.claims);

      if (!parsed.success) return null;

      const { sub, iss, aud, exp } = parsed.data;

      if (
        iss !== `${url}/auth/v1` ||
        exp <= Date.now() / 1000 ||
        !(Array.isArray(aud)
          ? aud.includes('authenticated')
          : aud === 'authenticated')
      )
        return null;

      return sub;
    } catch {
      return null;
    }
  };
}
