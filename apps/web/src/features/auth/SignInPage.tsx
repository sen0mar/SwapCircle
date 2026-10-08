import { lazy, Suspense, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  passwordSignInSchema,
  type PasswordSignIn,
} from '@swapcircle/contracts';
import { Input } from '../../components/ui/input';
import { FormFeedback } from '../../components/ui/form-feedback';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { Button } from '../../components/ui/button';
import { useAuth } from './AuthProvider';
import { safeDestination } from './safe-destination';
import { useGoogleSignIn } from './useGoogleSignIn';

const GuestSignIn = lazy(() => import('./GuestSignIn'));

export function SignInPage() {
  const { client, session, loading, error: restorationError } = useAuth();
  const [params] = useSearchParams();
  const destination = safeDestination(params.get('next'));
  const { configured, error, pending, signIn } = useGoogleSignIn(destination);

  const [passwordError, setPasswordError] = useState<string | null>(null);
  const passwordRequest = useRef(false);
  const {
    register,
    handleSubmit,
    resetField,
    formState: { errors, isSubmitting },
  } = useForm<PasswordSignIn>({
    resolver: zodResolver(passwordSignInSchema),
    defaultValues: { email: '', password: '' },
  });
  const [guestPending, setGuestPending] = useState(false);
  const busy = pending || isSubmitting || guestPending;

  async function signInWithPassword(values: PasswordSignIn) {
    if (!client || pending || guestPending || passwordRequest.current) return;

    passwordRequest.current = true;
    setPasswordError(null);

    try {
      const { error } = await client.auth.signInWithPassword(values);

      if (error) throw error;
      // AuthProvider owns the SDK event/session; its Navigate preserves safe next.
    } catch {
      setPasswordError(
        'Sign-in failed. Check your email and password or try again later.',
      );
    } finally {
      resetField('password');
      passwordRequest.current = false;
    }
  }

  if (loading) return <p role="status">Restoring your session…</p>;

  if (session) return <Navigate to={destination} replace />;

  return (
    <section
      className="panel route-panel auth-panel"
      aria-labelledby="sign-in-title"
    >
      <h1 id="sign-in-title">Sign in to SwapCircle</h1>
      <p>Use your Google account or your email and password to sign in.</p>
      {(error || restorationError) && (
        <p role="alert">{error || restorationError}</p>
      )}
      {!configured && (
        <p role="status">Sign-in is not configured in this environment yet.</p>
      )}
      <form
        className="auth-form"
        noValidate
        onSubmit={handleSubmit(signInWithPassword)}
        aria-busy={isSubmitting}
      >
        <div className="profile-field">
          <label htmlFor="sign-in-email">Email</label>
          <Input
            id="sign-in-email"
            type="email"
            autoComplete="username"
            required
            disabled={!configured || busy}
            aria-invalid={!!errors.email}
            aria-describedby={errors.email ? 'sign-in-email-error' : undefined}
            {...register('email')}
          />
          {errors.email && (
            <FormFeedback id="sign-in-email-error" tone="error">
              {errors.email.message}
            </FormFeedback>
          )}
        </div>
        <div className="profile-field">
          <label htmlFor="sign-in-password">Password</label>
          <Input
            id="sign-in-password"
            type="password"
            autoComplete="current-password"
            required
            disabled={!configured || busy}
            aria-invalid={!!errors.password}
            aria-describedby={
              errors.password ? 'sign-in-password-error' : undefined
            }
            {...register('password')}
          />
          {errors.password && (
            <FormFeedback id="sign-in-password-error" tone="error">
              {errors.password.message}
            </FormFeedback>
          )}
        </div>
        {passwordError && (
          <FormFeedback id="password-sign-in-error" tone="error">
            {passwordError}
          </FormFeedback>
        )}
        <Button type="submit" variant="primary" disabled={!configured || busy}>
          {isSubmitting ? 'Signing in…' : 'Sign in with email'}
        </Button>
      </form>
      <p>Or continue with Google</p>
      <Button
        variant="primary"
        disabled={!configured || busy}
        onClick={() => void signIn()}
      >
        {pending ? 'Opening Google…' : 'Continue with Google'}
      </Button>
      <Suspense fallback={null}>
        <GuestSignIn
          disabled={!configured || busy}
          onPending={setGuestPending}
        />
      </Suspense>
      <Link to="/">Back to Home</Link>
    </section>
  );
}
