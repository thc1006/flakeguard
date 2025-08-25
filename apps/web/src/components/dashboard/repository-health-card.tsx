import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Repository } from '@/lib/api';
import { formatDistanceToNow } from 'date-fns';
import { clsx } from 'clsx';

interface RepositoryHealthCardProps {
  repository: Repository;
}

function getHealthBadgeVariant(status?: string) {
  switch (status) {
    case 'excellent':
      return 'success';
    case 'good':
      return 'default';
    case 'warning':
      return 'warning';
    case 'critical':
      return 'destructive';
    default:
      return 'secondary';
  }
}

function getHealthColorClass(status?: string) {
  switch (status) {
    case 'excellent':
      return 'health-excellent';
    case 'good':
      return 'health-good';
    case 'warning':
      return 'health-warning';
    case 'critical':
      return 'health-critical';
    default:
      return 'border-muted';
  }
}

export function RepositoryHealthCard({ repository }: RepositoryHealthCardProps) {
  const t = useTranslations();
  const { health, metrics } = repository;

  const healthStatus = health?.status || 'unknown';
  const lastUpdated = health?.lastUpdated || repository.updatedAt;
  
  return (
    <Card className={clsx('transition-colors hover:shadow-md', getHealthColorClass(healthStatus))}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg font-semibold truncate">
            <Link 
              href={`/repositories/${repository.id}`}
              className="hover:underline"
            >
              {repository.name}
            </Link>
          </CardTitle>
          {health?.status && (
            <Badge variant={getHealthBadgeVariant(health.status)}>
              {t(`repository.health.${health.status}`)}
            </Badge>
          )}
        </div>
        {repository.description && (
          <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
            {repository.description}
          </p>
        )}
      </CardHeader>
      <CardContent className="pt-0">
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <span className="text-muted-foreground">
              {t('repository.metrics.testCount')}:
            </span>
            <div className="font-medium">{metrics?.totalTests || 0}</div>
          </div>
          <div>
            <span className="text-muted-foreground">
              {t('repository.metrics.flakyTests')}:
            </span>
            <div className="font-medium text-orange-600">
              {metrics?.flakyTests || 0}
            </div>
          </div>
          {metrics?.flakinessScore !== undefined && (
            <div className="col-span-2">
              <span className="text-muted-foreground">
                {t('repository.metrics.flakinessScore')}:
              </span>
              <div className="font-medium">
                {(metrics.flakinessScore * 100).toFixed(1)}%
              </div>
            </div>
          )}
          <div className="col-span-2 text-xs text-muted-foreground">
            {t('repository.metrics.lastUpdated')}: {' '}
            {formatDistanceToNow(new Date(lastUpdated), { addSuffix: true })}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
