'use client';

import { Bars3Icon } from '@heroicons/react/24/outline';
import { useTranslations } from 'next-intl';

import { UserButton } from '@/components/auth/user-button';
import { LanguageSwitcher } from '@/components/ui/language-switcher';
import { RefreshButton } from '@/components/ui/refresh-button';
import { ThemeToggle } from '@/components/ui/theme-toggle';

interface HeaderProps {
  onMenuClick?: () => void;
  title?: string;
}

export function Header({ onMenuClick, title }: HeaderProps) {
  const t = useTranslations('dashboard');

  return (
    <header className="bg-card border-b border-border">
      <div className="px-4 sm:px-6 lg:px-8">
        <div className="flex h-16 justify-between items-center">
          <div className="flex items-center">
            <button
              type="button"
              className="lg:hidden -ml-0.5 -mt-0.5 h-12 w-12 inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground focus:outline-none focus:ring-2 focus:ring-inset focus:ring-primary"
              onClick={onMenuClick}
            >
              <span className="sr-only">Open sidebar</span>
              <Bars3Icon className="h-6 w-6" />
            </button>
            <div className="lg:ml-0 ml-4">
              <h1 className="text-2xl font-bold text-foreground">
                {title || t('title')}
              </h1>
            </div>
          </div>
          <div className="flex items-center space-x-4">
            <RefreshButton />
            <LanguageSwitcher />
            <ThemeToggle />
            <UserButton />
          </div>
        </div>
      </div>
    </header>
  );
}
