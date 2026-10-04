export function DemoDataNotice() {
  return (
    <div className="demo-data-notice">
      <p>
        Google and Supabase handle sign-in. Supabase stores your identity and
        email; your browser stores a session. Profile details and listings you
        publish are public; the app limits messages and meeting plans to
        participants.
      </p>
      <p>
        Use fictional details. Demo data may change or be removed; completed
        swap history is currently retained. Signing out does not delete accounts
        or saved content. Account deletion, report review and dispute resolution
        are unavailable.
      </p>
    </div>
  );
}

export function DemoNotice() {
  return (
    <aside className="panel demo-notice" aria-label="Portfolio demo">
      <strong>Portfolio demo · testing only</strong>
      <p>
        Explore with synthetic items, messages and swaps. Do not arrange real
        exchanges or meetups. Free hosting may take time to wake up.
      </p>
      <details>
        <summary>Sign-in and demo data</summary>
        <DemoDataNotice />
      </details>
    </aside>
  );
}
