import { useQuery } from '@tanstack/react-query';

import { api, Repository } from '@/lib/api';

export function useRepositories(params?: {
  limit?: number;
  offset?: number;
  search?: string;
}) {
  return useQuery({
    queryKey: ['repositories', params],
    queryFn: () => api.getRepositories(params),
    staleTime: 1000 * 60 * 5, // 5 minutes
  });
}

export function useRepository(id: string) {
  return useQuery({
    queryKey: ['repository', id],
    queryFn: () => api.getRepository(id),
    enabled: !!id,
    staleTime: 1000 * 60 * 2, // 2 minutes
  });
}
