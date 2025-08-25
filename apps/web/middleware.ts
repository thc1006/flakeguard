import createMiddleware from 'next-intl/middleware';

export default createMiddleware({
  // A list of all locales that are supported
  locales: ['en', 'zh-TW'],

  // Used when no locale matches
  defaultLocale: 'en',

  // Always show the locale prefix
  localePrefix: 'as-needed'
});

export const config = {
  // Match only internationalized pathnames
  matcher: ['/', '/(zh-TW|en)/:path*']
};
