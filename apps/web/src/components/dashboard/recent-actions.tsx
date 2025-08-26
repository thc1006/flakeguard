import { ArrowTopRightOnSquareIcon as ExternalLinkIcon } from '@heroicons/react/24/outline';
import { formatDistanceToNow } from 'date-fns';
import Link from 'next/link';
import { useTranslations } from 'next-intl';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Task } from '@/lib/api';


interface RecentActionsProps {
  actions: Task[];
  isLoading?: boolean;
}

function getActionTypeIcon(type: string) {
  switch (type.toLowerCase()) {
    case 'quarantine':
      return '🚫';
    case 'unquarantine':
      return '✅';
    case 'issue_created':
      return '📝';
    case 'rerun':
      return '🔄';
    default:
      return '⚙️';
  }
}

function getStatusBadgeVariant(status: string) {
  switch (status.toLowerCase()) {
    case 'completed':
    case 'success':
      return 'success';
    case 'failed':
    case 'error':
      return 'destructive';
    case 'pending':
    case 'running':
      return 'warning';
    default:
      return 'secondary';
  }
}

export function RecentActions({ actions, isLoading }: RecentActionsProps) {
  const t = useTranslations();

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t('dashboard.recentActions')}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="animate-pulse space-y-3">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="flex items-center space-x-3">
                <div className="w-8 h-8 bg-muted rounded-full" />
                <div className="flex-1 space-y-1">
                  <div className="h-4 bg-muted rounded w-1/2" />
                  <div className="h-3 bg-muted rounded w-1/3" />
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!actions.length) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t('dashboard.recentActions')}</CardTitle>
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
        <CardTitle>{t('dashboard.recentActions')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {actions.slice(0, 10).map((action) => (
          <div key={action.id} className="flex items-start space-x-3 p-3 rounded-lg border border-border">
            <div className="flex-shrink-0 w-8 h-8 bg-primary/10 rounded-full flex items-center justify-center text-sm">
              {getActionTypeIcon(action.type)}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between mb-1">
                <h4 className="text-sm font-medium truncate">
                  {t(`actions.types.${action.type}`) || action.type}
                </h4>
                <Badge variant={getStatusBadgeVariant(action.status)}>
                  {action.status}
                </Badge>
              </div>
              <div className="space-y-1">
                {action.metadata?.testName && (
                  <p className="text-sm text-muted-foreground truncate">
                    Test: {action.metadata.testName}
                  </p>
                )}
                {action.metadata?.repositoryName && (
                  <p className="text-sm text-muted-foreground truncate">
                    Repository: {action.metadata.repositoryName}
                  </p>
                )}
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">
                    {formatDistanceToNow(new Date(action.createdAt), { addSuffix: true })}
                  </span>
                  <div className="flex items-center space-x-1">
                    {action.metadata?.githubUrl && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => window.open(action.metadata.githubUrl, '_blank')}
                      >
                        <ExternalLinkIcon className="h-3 w-3 mr-1" />
                        GitHub
                      </Button>
                    )}
                    {action.metadata?.slackThread && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => window.open(action.metadata.slackThread, '_blank')}
                      >
                        <ExternalLinkIcon className="h-3 w-3 mr-1" />
                        Slack
                      </Button>
                    )}
                  </div>
                </div>
              </div>
              {action.error && (
                <p className="text-xs text-destructive mt-2 p-2 bg-destructive/10 rounded">
                  {action.error}
                </p>
              )}
            </div>
          </div>
        ))}
        {actions.length > 10 && (
          <Button asChild variant="outline" className="w-full mt-4">
            <Link href="/actions">
              {t('actions.viewDetails')} ({actions.length})
            </Link>
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
