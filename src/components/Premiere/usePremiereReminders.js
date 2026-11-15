import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAppStore } from '../../lib/store';
import { fetchMyPremiereReminders, setPremiereReminder } from '../../lib/premieres';

export const REMINDERS_KEY = (user) => ['premiere-reminders', user];

/**
 * The signed-in viewer's premiere reminders, shared by every "Notify me" button
 * and the in-app banner (PremiereReminders). One query per account.
 */
export function useMyPremiereReminders({ refetchInterval = false } = {}) {
  const authenticated = useAppStore((s) => s.authenticated);
  const user = useAppStore((s) => s.user);
  const q = useQuery({
    queryKey: REMINDERS_KEY(user),
    enabled: !!authenticated && !!user,
    staleTime: 60 * 1000,
    retry: 1,
    refetchInterval,
    queryFn: () => fetchMyPremiereReminders(user),
  });
  return { user: authenticated ? user : null, reminders: q.data?.reminders || [], due: q.data?.due || [], refetch: q.refetch };
}

/** Has the viewer asked to be told about owner/permlink, and a toggle for it. */
export function usePremiereReminder(owner, permlink) {
  const { user, reminders } = useMyPremiereReminders();
  const queryClient = useQueryClient();
  const reminded = reminders.some((p) => p.owner === owner && p.permlink === permlink);
  const m = useMutation({
    mutationFn: (on) => setPremiereReminder(user, owner, permlink, on),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: REMINDERS_KEY(user) });
      queryClient.invalidateQueries({ queryKey: ['premiere', owner, permlink] });
    },
  });
  return { user, reminded, toggle: () => m.mutateAsync(!reminded), busy: m.isPending };
}
