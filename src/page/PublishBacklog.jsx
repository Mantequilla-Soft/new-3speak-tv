import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '../lib/store';
import BackfillTable from '../components/Incubation/BackfillTable';
import useTitleMeta from '../hooks/useTitleMeta';

/**
 * Where a graduated user publishes what they made before they had a Hive
 * account. The table does the work; this page only guards who reaches it.
 */
export default function PublishBacklog() {
  const user = useAppStore((s) => s.user);
  const incubationHandle = useAppStore((s) => s.incubationHandle);
  const authenticated = useAppStore((s) => s.authenticated);
  const navigate = useNavigate();

  useTitleMeta('Publish your earlier posts');

  useEffect(() => {
    // Only for someone who HAS a Hive account: the whole page is about
    // publishing as that account. Still incubating means there is nothing to
    // publish as yet, and signed out means there is nothing to publish.
    if (!authenticated) { navigate('/'); return; }
    if (!user && incubationHandle) navigate('/');
  }, [authenticated, user, incubationHandle, navigate]);

  if (!authenticated || !user) return null;
  return <BackfillTable />;
}
