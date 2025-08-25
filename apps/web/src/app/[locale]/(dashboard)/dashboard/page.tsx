'use client';

import { useTranslations } from 'next-intl';
import { useRepositories } from '@/hooks/use-repositories';
import { useRecentActions } from '@/hooks/use-tasks';
import { useQuarantinePlan } from '@/hooks/use-quarantine';
import { RepositoryHealthCard } from '@/components/dashboard/repository-health-card';
import { FlakyTestsTable } from '@/components/dashboard/flaky-tests-table';
import { RecentActions } from '@/components/dashboard/recent-actions';
import { LoadingSpinner } from '@/components/ui/loading-spinner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PlusIcon } from '@heroicons/react/24/outline';
import Link from 'next/link';

export default function DashboardPage() {
  const t = useTranslations();
  const { data: repositoriesData, isLoading: repositoriesLoading } = useRepositories({ limit: 6 });
  const { data: actionsData, isLoading: actionsLoading } = useRecentActions(10);
  
  // Get flaky tests from the first repository for demo purposes
  const firstRepositoryId = repositoriesData?.data?.[0]?.id;
  const { data: quarantineData, isLoading: quarantineLoading } = useQuarantinePlan(
    firstRepositoryId || '',
    { lookbackDays: 7, includeAnnotations: true }
  );

  const flakyTests = quarantineData?.data?.candidates || [];
  const repositories = repositoriesData?.data || [];
  const actions = actionsData?.data || [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-foreground">{t('dashboard.title')}</h1>
          <p className="text-muted-foreground mt-2">{t('dashboard.subtitle')}</p>
        </div>
        <Button asChild>
          <Link href="/repositories">
            <PlusIcon className="h-4 w-4 mr-2" />
            View All Repositories
          </Link>
        </Button>
      </div>

      {/* Repository Health Overview */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold">{t('dashboard.repositoryHealth')}</h2>
          <Button asChild variant="outline" size="sm">
            <Link href="/repositories">
              View All
            </Link>
          </Button>
        </div>
        
        {repositoriesLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[...Array(6)].map((_, i) => (
              <Card key={i} className="animate-pulse">
                <CardHeader>
                  <div className="h-6 bg-muted rounded w-2/3" />
                  <div className="h-4 bg-muted rounded w-full" />
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    <div className="h-4 bg-muted rounded w-1/2" />
                    <div className="h-4 bg-muted rounded w-1/3" />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : repositories.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {repositories.map((repo) => (
              <RepositoryHealthCard key={repo.id} repository={repo} />
            ))}
          </div>
        ) : (
          <Card>
            <CardContent className="text-center py-8">
              <p className="text-muted-foreground mb-4">
                No repositories found. Connect your repositories to get started.
              </p>
              <Button asChild>
                <Link href="/repositories">
                  Add Repository
                </Link>
              </Button>
            </CardContent>
          </Card>
        )}
      </section>

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Flaky Tests - Takes up 2 columns */}
        <div className="lg:col-span-2">
          <FlakyTestsTable
            tests={flakyTests}
            repositoryId={firstRepositoryId || ''}
            isLoading={quarantineLoading}
          />
        </div>

        {/* Recent Actions - Takes up 1 column */}
        <div className="lg:col-span-1">
          <RecentActions actions={actions} isLoading={actionsLoading} />
        </div>
      </div>

      {/* Additional Stats Section */}
      <section>
        <h2 className="text-xl font-semibold mb-4">System Overview</h2>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Total Repositories
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {repositoriesData?.total || 0}
              </div>
            </CardContent>
          </Card>
          
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Flaky Tests Detected
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-orange-600">
                {flakyTests.length}
              </div>
            </CardContent>
          </Card>
          
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Actions This Week
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {actions.length}
              </div>
            </CardContent>
          </Card>
          
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Critical Issues
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-red-600">
                {repositories.filter(r => r.health?.status === 'critical').length}
              </div>
            </CardContent>
          </Card>
        </div>
      </section>
    </div>
  );
}
