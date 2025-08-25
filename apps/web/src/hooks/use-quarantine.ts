import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

export function useQuarantinePlan(repositoryId: string, params?: {
  lookbackDays?: number;
  includeAnnotations?: boolean;
}) {
  return useQuery({
    queryKey: ['quarantine-plan', repositoryId, params],
    queryFn: () => api.getQuarantinePlan(repositoryId, params),
    enabled: !!repositoryId,
    staleTime: 1000 * 60 * 2, // 2 minutes
  });
}
