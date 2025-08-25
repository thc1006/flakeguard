import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { QuarantineCandidate } from '@/lib/api';
import { ExternalLinkIcon } from '@heroicons/react/24/outline';

interface FlakyTestsTableProps {
  tests: QuarantineCandidate[];
  repositoryId: string;
  isLoading?: boolean;
}

function getActionBadgeVariant(action: string) {
  switch (action) {
    case 'quarantine':
      return 'destructive';
    case 'warn':
      return 'warning';
    default:
      return 'secondary';
  }
}

export function FlakyTestsTable({ tests, repositoryId, isLoading }: FlakyTestsTableProps) {
  const t = useTranslations();

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t('dashboard.topFlakyTests')}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="animate-pulse space-y-3">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="h-12 bg-muted rounded" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!tests.length) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t('dashboard.topFlakyTests')}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-center py-8">
            {t('common.noData')}
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('dashboard.topFlakyTests')}</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-hidden">
          <table className="w-full">
            <thead className="bg-muted/50">
              <tr className="text-left text-sm">
                <th className="px-6 py-3 font-medium">Test Name</th>
                <th className="px-6 py-3 font-medium">Flake Score</th>
                <th className="px-6 py-3 font-medium">Recommendation</th>
                <th className="px-6 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {tests.slice(0, 10).map((test, index) => (
                <tr key={`${test.testFullName}-${index}`} className="hover:bg-muted/30">
                  <td className="px-6 py-4">
                    <div>
                      <div className="font-medium text-sm truncate max-w-xs" title={test.testName}>
                        {test.testName}
                      </div>
                      <div className="text-xs text-muted-foreground truncate max-w-xs" title={test.testFullName}>
                        {test.testFullName}
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="text-sm">
                      <div className="font-medium">
                        {(test.flakeScore.score * 100).toFixed(1)}%
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Confidence: {(test.flakeScore.confidence * 100).toFixed(0)}%
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="space-y-1">
                      <Badge variant={getActionBadgeVariant(test.flakeScore.recommendation.action)}>
                        {t(`actions.types.${test.flakeScore.recommendation.action}`)}
                      </Badge>
                      <div className="text-xs text-muted-foreground max-w-xs">
                        {test.flakeScore.recommendation.reason}
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center space-x-2">
                      <Button
                        asChild
                        variant="ghost"
                        size="sm"
                      >
                        <Link href={`/repositories/${repositoryId}/tests/${encodeURIComponent(test.testFullName)}`}>
                          {t('test.actions.viewHistory')}
                        </Link>
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => {
                          // TODO: Implement GitHub integration for test details
                          window.open(`https://github.com/search?q=${encodeURIComponent(test.testName)}&type=code`, '_blank');
                        }}
                      >
                        <ExternalLinkIcon className="h-4 w-4" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {tests.length > 10 && (
          <div className="p-4 border-t">
            <Button asChild variant="outline" className="w-full">
              <Link href={`/repositories/${repositoryId}/tests`}>
                View All Tests ({tests.length})
              </Link>
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
