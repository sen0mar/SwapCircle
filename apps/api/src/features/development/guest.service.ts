import { readFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { assertDemoTarget } from './demo-guard.js';

const credentialsSchema = z.object({
  version: z.literal(1),
  authUrl: z.literal('http://127.0.0.1:55431'),
  accounts: z.array(
    z.object({
      key: z.string(),
      id: z.uuid(),
      email: z.email(),
      password: z.string().min(20),
    }),
  ),
});

export const demoCredentialsPath = new URL(
  '../../../../../packages/database/.demo.local/credentials.json',
  import.meta.url,
);

export type GuestConfiguration = {
  environment: string | undefined;
  authUrl: string;
  databaseUrl: string;
  publishableKey: string;
};

export class GuestService {
  constructor(
    private readonly config: GuestConfiguration,
    private readonly credentialsPath = demoCredentialsPath,
  ) {
    assertDemoTarget(config.environment, config.authUrl, config.databaseUrl);
  }

  async signIn(): Promise<{ access_token: string; refresh_token: string }> {
    const ready = z
      .object({ version: z.literal(1), guestId: z.uuid() })
      .parse(
        JSON.parse(
          await readFile(new URL('ready.json', this.credentialsPath), 'utf8'),
        ),
      );
    const credentials = credentialsSchema.parse(
      JSON.parse(await readFile(this.credentialsPath, 'utf8')),
    );
    const account = credentials.accounts.find(
      (account) => account.key === 'guest',
    );
    if (!account || ready.guestId !== account.id) throw new Error('No guest');

    const client = createClient(
      this.config.authUrl,
      this.config.publishableKey,
      {
        auth: { persistSession: false, autoRefreshToken: false },
      },
    );
    const { data, error } = await client.auth.signInWithPassword({
      email: account.email,
      password: account.password,
    });
    if (
      error ||
      !data.session ||
      data.user.id !== account.id ||
      data.user.app_metadata.demo_seed !== 'swapcircle-v1'
    )
      throw new Error('Guest unavailable');

    return {
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
    };
  }
}
