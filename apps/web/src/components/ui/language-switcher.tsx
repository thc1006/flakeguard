'use client';

import { useLocale } from 'next-intl';
import { useRouter, usePathname } from 'next/navigation';
import { Button } from './button';
import { LanguageIcon } from '@heroicons/react/24/outline';

const locales = [
  { code: 'en', name: 'English' },
  { code: 'zh-TW', name: '中文（繁體）' },
];

export function LanguageSwitcher() {
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();

  const handleLocaleChange = (newLocale: string) => {
    if (newLocale === locale) return;
    
    // Remove the current locale from pathname if it exists
    const pathnameWithoutLocale = pathname.startsWith(`/${locale}`)
      ? pathname.slice(locale.length + 1)
      : pathname;
    
    // Add the new locale prefix
    const newPath = newLocale === 'en' 
      ? pathnameWithoutLocale || '/'
      : `/${newLocale}${pathnameWithoutLocale}`;
    
    router.push(newPath);
  };

  const currentLocale = locales.find(l => l.code === locale);
  const otherLocale = locales.find(l => l.code !== locale);

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => otherLocale && handleLocaleChange(otherLocale.code)}
      className="flex items-center space-x-1"
    >
      <LanguageIcon className="h-4 w-4" />
      <span className="hidden sm:inline">{currentLocale?.name}</span>
    </Button>
  );
}
