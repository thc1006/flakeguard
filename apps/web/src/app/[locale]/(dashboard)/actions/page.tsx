'use client';

import { MagnifyingGlassIcon, FunnelIcon } from '@heroicons/react/24/outline';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { RecentActions } from '@/components/dashboard/recent-actions';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { LoadingSpinner } from '@/components/ui/loading-spinner';
import { useTasks } from '@/hooks/use-tasks';

const ACTION_TYPES = [
  'quarantine',
  'unquarantine',
  'issue_created',
  'rerun',
] as const;

const ACTION_STATUSES = [
  'pending',
  'running',
  'completed',
  'failed',
] as const;

export default function ActionsPage() {
  const t = useTranslations();
  const [selectedType, setSelectedType] = useState<string>('');
  const [selectedStatus, setSelectedStatus] = useState<string>('');
  const [currentPage, setCurrentPage] = useState(0);
  const limit = 20;

  const { data, isLoading, error } = useTasks({
    limit,
    offset: currentPage * limit,
    type: selectedType || undefined,
    status: selectedStatus || undefined,
  });

  const actions = data?.data || [];
  const totalPages = Math.ceil((data?.total || 0) / limit);
  const hasNextPage = currentPage < totalPages - 1;
  const hasPrevPage = currentPage > 0;

  const handleFilterChange = () => {
    setCurrentPage(0); // Reset to first page when filtering
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-foreground">
          {t('navigation.actions')}
        </h1>
        <p className="text-muted-foreground mt-2">
          View all quarantine actions, issue creation, and test reruns
        </p>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center space-x-4">
            <FunnelIcon className="h-5 w-5 text-muted-foreground" />
            <div className="flex items-center space-x-2">
              <span className="text-sm font-medium">Type:</span>
              <select
                value={selectedType}
                onChange={(e) => {
                  setSelectedType(e.target.value);
                  handleFilterChange();
                }}
                className="px-3 py-1 border border-input rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="">All Types</option>
                {ACTION_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {t(`actions.types.${type}`)}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-center space-x-2">
              <span className="text-sm font-medium">Status:</span>
              <select
                value={selectedStatus}
                onChange={(e) => {
                  setSelectedStatus(e.target.value);
                  handleFilterChange();
                }}
                className="px-3 py-1 border border-input rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="">All Statuses</option>
                {ACTION_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {status.charAt(0).toUpperCase() + status.slice(1)}
                  </option>
                ))}
              </select>
            </div>
            {(selectedType || selectedStatus) && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setSelectedType('');
                  setSelectedStatus('');
                  handleFilterChange();
                }}
              >
                Clear Filters
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Summary Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {ACTION_STATUSES.map((status) => {
          const count = actions.filter(a => a.status.toLowerCase() === status).length;
          return (
            <Card key={status}>
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground capitalize">
                      {status}
                    </p>
                    <p className="text-2xl font-bold">{count}</p>
                  </div>
                  <Badge 
                    variant={status === 'completed' ? 'success' : 
                             status === 'failed' ? 'destructive' : 
                             status === 'running' ? 'warning' : 'secondary'}
                  >
                    {count}
                  </Badge>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Loading State */}
      {isLoading && (
        <div className="space-y-4">
          {[...Array(10)].map((_, i) => (
            <Card key={i} className="animate-pulse">
              <CardContent className="p-4">
                <div className="flex items-center space-x-4">
                  <div className="w-12 h-12 bg-muted rounded-full" />
                  <div className="flex-1 space-y-2">
                    <div className="h-4 bg-muted rounded w-1/2" />
                    <div className="h-3 bg-muted rounded w-1/3" />
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Error State */}
      {error && (
        <Card>
          <CardContent className="text-center py-8">
            <p className="text-destructive mb-4">
              Failed to load actions: {error.message}
            </p>
            <Button
              onClick={() => window.location.reload()}
              variant="outline"
            >
              {t('common.retry')}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Actions List */}
      {!isLoading && !error && (
        <>
          {actions.length > 0 ? (
            <>
              <RecentActions actions={actions} />

              {/* Pagination */}
              {totalPages > 1 && (
                <Card>
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <div className="text-sm text-muted-foreground">
                        Showing {currentPage * limit + 1} to{' '}
                        {Math.min((currentPage + 1) * limit, data?.total || 0)} of{' '}
                        {data?.total || 0} actions
                      </div>
                      <div className="flex items-center space-x-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setCurrentPage(currentPage - 1)}
                          disabled={!hasPrevPage}
                        >
                          Previous
                        </Button>
                        <span className="text-sm text-muted-foreground">
                          Page {currentPage + 1} of {totalPages}
                        </span>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setCurrentPage(currentPage + 1)}
                          disabled={!hasNextPage}
                        >
                          Next
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}
            </>
          ) : (
            <Card>
              <CardContent className="text-center py-12">
                <div className="text-center">
                  <div className="h-24 w-24 bg-muted rounded-full flex items-center justify-center mx-auto mb-4">
                    <span className="text-2xl">⚙️</span>
                  </div>
                  <h3 className="text-lg font-medium mb-2">
                    No actions found
                  </h3>
                  <p className="text-muted-foreground mb-6 max-w-sm mx-auto">
                    {selectedType || selectedStatus
                      ? 'No actions match the selected filters. Try adjusting your filter criteria.'
                      : 'No actions have been performed yet. Actions will appear here when FlakeGuard quarantines tests or creates issues.'}
                  </p>
                  {(selectedType || selectedStatus) && (
                    <Button
                      variant="outline"
                      onClick={() => {
                        setSelectedType('');
                        setSelectedStatus('');
                        handleFilterChange();
                      }}
                    >
                      Clear Filters
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
