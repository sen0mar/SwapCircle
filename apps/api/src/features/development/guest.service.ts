import { readFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { assertDemoTarget, assertHostedDemoTarget } from './demo-guard.js';

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

const hostedCredentialsSchema = z.object({
  id: z.uuid(),
  email: z
    .email()
    .refine((email) => email === 'swapcircle-demo-prod-guest@example.invalid'),
  password: z.string().min(20),
});

export type GuestConfiguration = {
  environment: string | undefined;
  authUrl: string;
  databaseUrl: string;
  publishableKey: string;
  hostedCredentials?: string | undefined;
};

export class GuestService {
  constructor(
    private readonly config: GuestConfiguration,
    private readonly credentialsPath = demoCredentialsPath,
  ) {
    if (config.hostedCredentials !== undefined) {
      assertHostedDemoTarget(
        config.environment,
        config.authUrl,
        config.databaseUrl,
      );
      hostedCredentialsSchema.parse(JSON.parse(config.hostedCredentials));
    } else {
      assertDemoTarget(config.environment, config.authUrl, config.databaseUrl);
    }
  }

  async signIn(): Promise<{ access_token: string; refresh_token: string }> {
    const hosted = this.config.hostedCredentials !== undefined;
    let account: { id: string; email: string; password: string };
    if (hosted) {
      account = hostedCredentialsSchema.parse(
        JSON.parse(this.config.hostedCredentials!),
      );
    } else {
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
      const guest = credentials.accounts.find(
        (account) => account.key === 'guest',
      );
      if (!guest || ready.guestId !== guest.id) throw new Error('No guest');
      account = guest;
    }

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
      data.user.app_metadata.demo_seed !== 'swapcircle-v1' ||
      (hosted &&
        (data.user.app_metadata.demo_target !== this.config.authUrl ||
          data.user.app_metadata.demo_ready !== true))
    )
      throw new Error('Guest unavailable');

    return {
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
    };
  }
}
