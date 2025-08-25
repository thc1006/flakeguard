'use client';

import { UserCircleIcon, ArrowRightOnRectangleIcon } from '@heroicons/react/24/outline';
import Link from 'next/link';
import { useSession, signOut } from 'next-auth/react';
import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';

export function UserButton() {
  const { data: session, status } = useSession();
  const t = useTranslations('common');

  if (status === 'loading') {
    return (
      <Button variant="ghost" size="icon" disabled>
        <UserCircleIcon className="h-5 w-5" />
      </Button>
    );
  }

  if (!session) {
    return (
      <Button asChild variant="default" size="sm">
        <Link href="/auth/signin">{t('signIn')}</Link>
      </Button>
    );
  }

  return (
    <div className="flex items-center space-x-2">
      <div className="hidden md:block text-sm">
        <div className="font-medium text-foreground">{session.user?.name}</div>
        <div className="text-muted-foreground">{session.user?.email}</div>
      </div>
      {session.user?.image && (
        <img
          src={session.user.image}
          alt={session.user.name || 'User'}
          className="h-8 w-8 rounded-full"
        />
      )}
      <Button
        variant="ghost"
        size="icon"
        onClick={() => signOut()}
        title={t('signOut')}
      >
        <ArrowRightOnRectangleIcon className="h-4 w-4" />
      </Button>
    </div>
  );
}
