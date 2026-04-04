import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSession } from 'next-auth/react';
import type { Notification, NotificationPreference } from '@/types/notifications';

export function useNotifications(limit = 20) {
  const { data: session } = useSession();
  return useQuery<{ data: Notification[]; unreadCount: number }>({
    queryKey: ['notifications', session?.user?.id, limit],
    queryFn: async () => {
      const res = await fetch(`/api/notifications?limit=${limit}`);
      if (!res.ok) throw new Error('Failed to fetch notifications');
      return res.json();
    },
    enabled: !!session?.user?.id,
    staleTime: 15_000,
    refetchInterval: 30_000,
  });
}

export function useMarkNotificationsRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (ids?: string[]) => {
      const res = await fetch('/api/notifications', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(ids ? { ids } : {}),
      });
      if (!res.ok) throw new Error('Failed to mark read');
      return res.json();
    },
    onMutate: async (ids) => {
      // Cancel outgoing refetches so they don't overwrite our optimistic update
      await queryClient.cancelQueries({ queryKey: ['notifications'] });

      // Snapshot current data
      const queries = queryClient.getQueriesData<{ data: Notification[]; unreadCount: number }>({ queryKey: ['notifications'] });

      // Optimistically update all matching queries
      for (const [key, current] of queries) {
        if (!current) continue;
        const updated = current.data.map((n) =>
          ids ? (ids.includes(n.id) ? { ...n, read: true } : n) : { ...n, read: true }
        );
        const unread = updated.filter((n) => !n.read).length;
        queryClient.setQueryData(key, { data: updated, unreadCount: unread });
      }

      return { queries };
    },
    onError: (_err, _ids, context) => {
      // Rollback on error
      if (context?.queries) {
        for (const [key, data] of context.queries) {
          queryClient.setQueryData(key, data);
        }
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });
}

export function useClearNotifications() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/notifications', { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to clear');
      return res.json();
    },
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: ['notifications'] });
      const queries = queryClient.getQueriesData<{ data: Notification[]; unreadCount: number }>({ queryKey: ['notifications'] });
      for (const [key] of queries) {
        queryClient.setQueryData(key, { data: [], unreadCount: 0 });
      }
      return { queries };
    },
    onError: (_err, _vars, context) => {
      if (context?.queries) {
        for (const [key, data] of context.queries) {
          queryClient.setQueryData(key, data);
        }
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });
}

export function useNotificationPreferences() {
  const { data: session } = useSession();
  return useQuery<{ data: NotificationPreference[] }>({
    queryKey: ['notification-preferences', session?.user?.id],
    queryFn: async () => {
      const res = await fetch('/api/notifications/preferences');
      if (!res.ok) throw new Error('Failed to fetch preferences');
      return res.json();
    },
    enabled: !!session?.user?.id,
    staleTime: 0,
  });
}

export function useUpdateNotificationPreference() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (params: {
      event_type: string;
      in_app_enabled: boolean;
      email_enabled: boolean;
      slack_enabled: boolean;
    }) => {
      const res = await fetch('/api/notifications/preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      });
      if (!res.ok) throw new Error('Failed to update preference');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notification-preferences'] });
    },
  });
}
