'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { clsx } from 'clsx';
import { 
  HomeIcon, 
  FolderIcon, 
  BeakerIcon, 
  ClockIcon, 
  Cog6ToothIcon 
} from '@heroicons/react/24/outline';

const navigationItems = [
  { key: 'dashboard', href: '/dashboard', icon: HomeIcon },
  { key: 'repositories', href: '/repositories', icon: FolderIcon },
  { key: 'tests', href: '/tests', icon: BeakerIcon },
  { key: 'actions', href: '/actions', icon: ClockIcon },
  { key: 'settings', href: '/settings', icon: Cog6ToothIcon },
] as const;

interface NavigationProps {
  className?: string;
}

export function Navigation({ className }: NavigationProps) {
  const pathname = usePathname();
  const t = useTranslations('navigation');

  return (
    <nav className={clsx('space-y-1', className)}>
      {navigationItems.map((item) => {
        const isActive = pathname.includes(item.href);
        const Icon = item.icon;

        return (
          <Link
            key={item.key}
            href={item.href}
            className={clsx(
              'flex items-center px-3 py-2 text-sm font-medium rounded-md transition-colors',
              isActive
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:text-foreground hover:bg-accent'
            )}
          >
            <Icon className="mr-3 h-5 w-5 flex-shrink-0" />
            {t(item.key)}
          </Link>
        );
      })}
    </nav>
  );
}
