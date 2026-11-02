import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Flame } from 'lucide-react';
import { useAppStore } from '../../lib/store';
import { recordReshare, getResharesForVideo } from '../../utils/reshares';
import { toastIn } from '../../utils/toast';

const toast = toastIn('Audio');

/**
 * "Hype" for a 3Speak audio: the same 3Speak reshare the watch page records
 * (utils/reshares.js, keyed by the Hive post), not a Hive reblog. Hypes lift a
 * track in the audio Popular list and sort (checker routes/audio.js hypeStages).
 * Not on your own track: those are left out of the count anyway.
 *
 * @param {string} author     the track's owner
 * @param {string} permlink   the Hive post permlink
 * @param {number} size       icon size
 */
export default function AudioHypeButton({ author, permlink, size = 16 }) {
  const { t } = useTranslation();
  const user = useAppStore((s) => s.user);
  const incubationHandle = useAppStore((s) => s.incubationHandle);
  const authenticated = useAppStore((s) => s.authenticated);
  const me = user || incubationHandle;
  // What the server said for this track and listener; a stale answer for the
  // previous track is ignored (`key`), so nothing has to be reset in an effect.
  const key = `${author}/${permlink}|${me || ''}`;
  const [known, setKnown] = useState({ key: null, count: 0, hyped: false });
  const [busy, setBusy] = useState(false);
  const count = known.key === key ? known.count : 0;
  const hyped = known.key === key && known.hyped;

  useEffect(() => {
    if (!author || !permlink) return undefined;
    let live = true;
    getResharesForVideo(author, permlink).then(({ reshares, count: n }) => {
      if (live) setKnown({ key, count: n, hyped: !!me && reshares.some((r) => r.username === me) });
    });
    return () => { live = false; };
  }, [key, author, permlink, me]);

  if (!author || !permlink || me === author) return null;

  const hype = async () => {
    if (!authenticated || !me) { toast.error(t('common.hype.loginRequired')); return; }
    if (hyped || busy) return;
    setBusy(true);
    const res = await recordReshare(me, author, permlink);
    setBusy(false);
    if (res) {
      setKnown((k) => ({ key, count: (k.key === key ? k.count : 0) + 1, hyped: true }));
      toast.success(t('common.hype.success'));
    } else {
      toast.error(t('common.hype.failed'));
    }
  };

  return (
    <button
      type="button"
      className={`audio-np-playlist-btn audio-np-hype-btn${hyped ? ' active' : ''}`}
      onClick={hype}
      disabled={busy}
      title={!authenticated ? t('common.hype.loginRequired') : hyped ? t('common.hype.hyped') : t('common.hype.title')}
      aria-pressed={hyped}
    >
      <Flame size={size} />
      {count > 0 && <span className="audio-np-hype-count">{count}</span>}
    </button>
  );
}
