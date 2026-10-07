// Only implemented destinations are accepted; never forward an external URL.
export function safeDestination(value: string | null): string {
  if (
    !value ||
    !value.startsWith('/') ||
    value.startsWith('//') ||
    /[\\\s]/.test(value)
  )
    return '/account';

  try {
    const url = new URL(value, 'https://swapcircle.invalid');

    if (
      url.origin !== 'https://swapcircle.invalid' ||
      (![
        '/',
        '/browse',
        '/inbox',
        '/shelf',
        '/swaps',
        '/listings/new',
        '/account',
        '/account/profile',
        '/account/settings',
      ].includes(url.pathname) &&
        !/^\/(members|inbox|notifications|swaps)\/[0-9a-f-]{36}$/i.test(
          url.pathname,
        ) &&
        !/^\/listings\/[0-9a-f-]{36}(?:\/edit)?$/i.test(url.pathname))
    )
      return '/account';

    return url.pathname + url.search + url.hash;
  } catch {
    return '/account';
  }
}
