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
      !['/', '/browse', '/account'].includes(url.pathname)
    )
      return '/account';
    return url.pathname + url.search + url.hash;
  } catch {
    return '/account';
  }
}
