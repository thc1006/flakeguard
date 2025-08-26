'use client';

import { MagnifyingGlassIcon, PlusIcon } from '@heroicons/react/24/outline';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { RepositoryHealthCard } from '@/components/dashboard/repository-health-card';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useRepositories } from '@/hooks/use-repositories';

export default function RepositoriesPage() {
  const t = useTranslations();
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(0);
  const limit = 12;

  const { data, isLoading, error } = useRepositories({
    limit,
    offset: currentPage * limit,
    search: searchQuery || undefined,
  });

  const repositories = data?.data || [];
  const totalPages = Math.ceil((data?.total || 0) / limit);
  const hasNextPage = currentPage < totalPages - 1;
  const hasPrevPage = currentPage > 0;

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setCurrentPage(0); // Reset to first page when searching
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-foreground">
            {t('navigation.repositories')}
          </h1>
          <p className="text-muted-foreground mt-2">
            Monitor repository health and manage flaky test detection
          </p>
        </div>
        <Button>
          <PlusIcon className="h-4 w-4 mr-2" />
          Add Repository
        </Button>
      </div>

      {/* Search and Filters */}
      <Card>
        <CardContent className="p-4">
          <form onSubmit={handleSearch} className="flex items-center space-x-4">
            <div className="flex-1 relative">
              <MagnifyingGlassIcon className="h-5 w-5 absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                placeholder={t('common.search')}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-input rounded-md bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent"
              />
            </div>
            <Button type="submit" variant="secondary">
              {t('common.search')}
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Loading State */}
      {isLoading && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(limit)].map((_, i) => (
            <Card key={i} className="animate-pulse">
              <div className="p-6">
                <div className="space-y-3">
                  <div className="h-6 bg-muted rounded w-2/3" />
                  <div className="h-4 bg-muted rounded w-full" />
                  <div className="h-4 bg-muted rounded w-1/2" />
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Error State */}
      {error && (
        <Card>
          <CardContent className="text-center py-8">
            <p className="text-destructive mb-4">
              Failed to load repositories: {error.message}
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

      {/* Repositories Grid */}
      {!isLoading && !error && (
        <>
          {repositories.length > 0 ? (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {repositories.map((repo) => (
                  <RepositoryHealthCard key={repo.id} repository={repo} />
                ))}
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <Card>
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <div className="text-sm text-muted-foreground">
                        Showing {currentPage * limit + 1} to{' '}
                        {Math.min((currentPage + 1) * limit, data?.total || 0)} of{' '}
                        {data?.total || 0} repositories
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
                    <PlusIcon className="h-12 w-12 text-muted-foreground" />
                  </div>
                  <h3 className="text-lg font-medium mb-2">
                    {searchQuery ? 'No repositories found' : 'No repositories yet'}
                  </h3>
                  <p className="text-muted-foreground mb-6 max-w-sm mx-auto">
                    {searchQuery
                      ? `No repositories match "${searchQuery}". Try a different search term.`
                      : 'Get started by connecting your first repository to monitor flaky tests.'}
                  </p>
                  {!searchQuery && (
                    <Button>
                      <PlusIcon className="h-4 w-4 mr-2" />
                      Add Your First Repository
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
