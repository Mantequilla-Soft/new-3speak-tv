import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { hiveClient } from '../utils/hiveNode';
import { isLoggedIn, getOperationUser, reblogWithAioha } from '../hive-api/aioha';

// How long the first tap stays "armed" before the button falls back.
const CONFIRM_MS = 4000;

/**
 * State for a Hive Reblog button (the post goes onto the user's own Hive blog).
 * Not the 3Speak "Hype" (utils/reshares.js).
 *
 * Two taps: the first arms the button ("Tap again to reblog"), the second
 * broadcasts. A ButrAuth or @threespeak-delegated session signs without any
 * wallet prompt, so without this a stray tap would put the post on their blog.
 *
 * `canReblog` is false for a logged-out or incubating viewer (no Hive account)
 * and on the viewer's own post, which Hive refuses to reblog.
 *
 * @param {string} author
 * @param {string} permlink  the HIVE permlink
 * @param {{ success: Function, error: Function }} toast  the page's toastIn(...)
 */
export default function useReblog(author, permlink, toast) {
  const { t } = useTranslation();
  const me = isLoggedIn() ? getOperationUser() : null;
  const canReblog = !!(me && author && permlink && me !== author);
  const [reblogged, setReblogged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [armed, setArmed] = useState(false);

  // Another post or account: start over. Adjusted during render (the React-docs
  // pattern for state derived from props) so the old "Reblogged" never paints.
  const key = canReblog ? `${me}|${author}/${permlink}` : '';
  const [shownKey, setShownKey] = useState(key);
  if (key !== shownKey) {
    setShownKey(key);
    setReblogged(false);
    setArmed(false);
  }

  useEffect(() => {
    if (!key) return;
    let live = true;
    hiveClient.call('condenser_api', 'get_reblogged_by', [author, permlink])
      .then((by) => { if (live) setReblogged(Array.isArray(by) && by.includes(me)); })
      .catch((err) => console.warn('Failed to fetch reblogs:', err));
    return () => { live = false; };
  }, [key, me, author, permlink]);

  useEffect(() => {
    if (!armed) return;
    const id = setTimeout(() => setArmed(false), CONFIRM_MS);
    return () => clearTimeout(id);
  }, [armed]);

  // Returns true once the reblog went through, so a caller can close a menu.
  const press = useCallback(async () => {
    if (!canReblog || reblogged || busy) return false;
    if (!armed) { setArmed(true); return false; }
    setArmed(false);
    setBusy(true);
    try {
      const res = await reblogWithAioha(author, permlink);
      if (res && res.success === false) throw new Error(res.error || 'Reblog failed');
      setReblogged(true);
      toast.success(t('common.reblog.success'));
      return true;
    } catch (err) {
      console.error('Reblog failed:', err);
      toast.error(t('common.reblog.failed'));
      return false;
    } finally {
      setBusy(false);
    }
  }, [canReblog, reblogged, busy, armed, author, permlink, toast, t]);

  const label = reblogged
    ? t('common.reblog.reblogged')
    : armed ? t('common.reblog.confirm') : t('common.reblog.reblog');

  return { canReblog, reblogged, busy, armed, press, label };
}
