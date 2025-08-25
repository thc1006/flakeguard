import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages } from 'next-intl/server';
import { Providers } from '@/components/providers';
import '../globals.css';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'FlakeGuard Dashboard',
  description: 'Production-grade flaky test detection and management platform',
  keywords: ['testing', 'flaky tests', 'CI/CD', 'quality assurance', 'automation'],
  authors: [{ name: 'FlakeGuard Team' }],
  openGraph: {
    title: 'FlakeGuard Dashboard',
    description: 'Monitor and manage flaky test detection across your repositories',
    type: 'website',
  },
};

interface RootLayoutProps {
  children: React.ReactNode;
  params: { locale: string };
}

export default async function RootLayout({
  children,
  params: { locale },
}: RootLayoutProps) {
  // Providing all messages to the client side is the easiest way to get started
  const messages = await getMessages();

  return (
    <html lang={locale} suppressHydrationWarning>
      <body className={inter.className}>
        <NextIntlClientProvider messages={messages}>
          <Providers>{children}</Providers>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
