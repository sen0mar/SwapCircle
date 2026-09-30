import { lazy, Suspense } from 'react';
import { Route, Routes } from 'react-router-dom';
import { SignInPage } from './features/auth/SignInPage';
import { AuthCallbackPage } from './features/auth/AuthCallbackPage';
import { RequireAuth } from './features/auth/RequireAuth';
import { AccountPage } from './features/account/AccountPage';
import { ProfilePage } from './features/account/ProfilePage';
import { SettingsPage } from './features/account/SettingsPage';
import { MemberPage } from './features/account/MemberPage';
import { Home } from './features/home/Home';
import { ListingPage } from './features/browse/ListingPage';
import { BrowsePage } from './features/browse/BrowsePage';
import { ListingEditorPage } from './features/listings/ListingEditorPage';
import { MyShelfPage } from './features/listings/MyShelfPage';
import { InboxPage } from './features/inbox/InboxPage';
import { NotificationPage } from './features/notifications/NotificationPage';
import { MySwapsPage } from './features/trades/MySwapsPage';
import { TradeDetailPage } from './features/trades/TradeDetailPage';
import { NotFoundPage } from './pages/NotFoundPage';

const ApiStatus = import.meta.env.DEV
  ? lazy(() => import('./features/development/ApiStatus'))
  : null;

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/sign-in" element={<SignInPage />} />
      <Route path="/auth/callback" element={<AuthCallbackPage />} />
      <Route element={<RequireAuth />}>
        <Route path="/notifications/:id" element={<NotificationPage />} />
        <Route path="/inbox" element={<InboxPage />} />
        <Route path="/swaps" element={<MySwapsPage />} />
        <Route path="/swaps/:id" element={<TradeDetailPage />} />
        <Route path="/inbox/:id" element={<InboxPage />} />
        <Route path="/account" element={<AccountPage />} />
        <Route path="/account/profile" element={<ProfilePage />} />
        <Route path="/account/settings" element={<SettingsPage />} />
        <Route path="/shelf" element={<MyShelfPage />} />
        <Route path="/listings/new" element={<ListingEditorPage />} />
        <Route path="/listings/:id/edit" element={<ListingEditorPage />} />
      </Route>
      {ApiStatus && (
        <Route
          path="/dev/api-status"
          element={
            <Suspense fallback={<p role="status">Loading API status…</p>}>
              <ApiStatus />
            </Suspense>
          }
        />
      )}
      <Route path="/" element={<Home />} />
      <Route path="/browse" element={<BrowsePage />} />
      <Route path="/listings/:id" element={<ListingPage />} />
      <Route path="/members/:id" element={<MemberPage />} />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
