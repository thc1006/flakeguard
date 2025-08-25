import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

export function useTasks(params?: {
  limit?: number;
  offset?: number;
  type?: string;
  status?: string;
}) {
  return useQuery({
    queryKey: ['tasks', params],
    queryFn: () => api.getTasks(params),
    staleTime: 1000 * 30, // 30 seconds (more frequent updates for tasks)
  });
}

export function useRecentActions(limit: number = 10) {
  return useTasks({
    limit,
    // Could filter by action types when the API supports it
  });
}
