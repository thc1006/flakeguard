'use client';

import { useQueryClient } from '@tanstack/react-query';
import { Button } from './button';
import { ArrowPathIcon } from '@heroicons/react/24/outline';
import { useState } from 'react';

export function RefreshButton() {
  const queryClient = useQueryClient();
  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await queryClient.invalidateQueries();
    } finally {
      setTimeout(() => setIsRefreshing(false), 500); // Show animation for at least 500ms
    }
  };

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={handleRefresh}
      disabled={isRefreshing}
    >
      <ArrowPathIcon 
        className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} 
      />
      <span className="sr-only">Refresh data</span>
    </Button>
  );
}
