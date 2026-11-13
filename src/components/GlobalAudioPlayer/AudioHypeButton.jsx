import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from '../v2/Icon';
import { cx } from '../v2/helpers';
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
 * Three looks (design 27b, hype states): `tile` a dock tile under the player
 * (Hype on surface-2, Hyped on an accent tint, the count beside the label),
 * `icon` a square icon button for the bar (the flame in accent), and `row`
 * a menu row.
 *
 * @param {string} author     the track's owner
 * @param {string} permlink   the Hive post permlink
 * @param {'tile'|'icon'|'row'} variant
 * @param {number} size       button height for the icon look (40 or 48)
 */
export default function AudioHypeButton({ author, permlink, variant = 'tile', size = 40, className }) {
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

  const title = !authenticated ? t('common.hype.loginRequired') : hyped ? t('common.hype.hyped') : t('common.hype.title');
  const label = hyped ? t('common.hype.hyped') : t('common.hype.hype');

  if (variant === 'icon') {
    return (
      <button
        type="button"
        className={cx('v2-iconbtn v2-btn--secondary gap-hype-icon', `h${size}`, hyped && 'is-on', className)}
        onClick={hype}
        disabled={busy}
        title={title}
        aria-label={count > 0 ? t('common.hype.withCount', { count }) : label}
        aria-pressed={hyped}
      >
        <Icon name="local_fire_department" size={size >= 48 ? 24 : 20} fill />
      </button>
    );
  }

  return (
    <button
      type="button"
      className={cx(variant === 'row' ? 'v2-menu__row' : 'v2-dock gap-tile', 'audio-np-hype-btn', hyped && 'is-on is-accent', className)}
      onClick={hype}
      disabled={busy}
      title={title}
      aria-pressed={hyped}
    >
      <Icon name="local_fire_department" size={variant === 'row' ? 18 : 24} fill={hyped} />
      <span>{label}{count > 0 && <span className="audio-np-hype-count num"> · {count}</span>}</span>
    </button>
  );
}
