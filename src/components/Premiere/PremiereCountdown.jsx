import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button, StatusPill } from '../v2/ui';
import { Icon } from '../v2/Icon';
import AccountImg from '../HiveAvatar/AccountImg';
import { profilePath } from '../../utils/urls';
import { toastIn } from '../../utils/toast';
import { usePremiereReminder } from './usePremiereReminders';
import './Premiere.scss';

const toast = toastIn('Video');

/** { days, hours, minutes, seconds } until `ms` milliseconds from now. */
export function splitCountdown(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return { days: Math.floor(s / 86400), hours: Math.floor((s % 86400) / 3600), minutes: Math.floor((s % 3600) / 60), seconds: s % 60 };
}

/**
 * The watch address of a premiere before it starts (design: the watch page's
 * player frame, flat card under it): the thumbnail with the countdown over it,
 * the title, the creator, the start in the viewer's own time, how many are
 * waiting and "Notify me". At zero it says it is starting; the page takes over.
 */
export default function PremiereCountdown({ premiere, serverNow, starting = false }) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [now, setNow] = useState(serverNow);
  useEffect(() => {
    const id = setInterval(() => setNow(serverNow()), 1000);
    return () => clearInterval(id);
  }, [serverNow]);
  const { user, reminded, toggle, busy } = usePremiereReminder(premiere.owner, premiere.permlink);

  const start = Date.parse(premiere.startAt);
  const left = start - now;
  const { days, hours, minutes, seconds } = splitCountdown(left);
  const pad = (n) => String(n).padStart(2, '0');
  const isStarting = starting || left <= 0;
  const when = new Date(start).toLocaleString(i18n.language, { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });

  const onNotify = async () => {
    if (!user) { navigate('/login'); return; }
    try {
      await toggle();
      toast.success(reminded ? t('premieres.reminderOff') : t('premieres.reminderOn', { title: premiere.title }));
    } catch {
      toast.error(t('premieres.reminderFailed'));
    }
  };

  return (
    <div className="premiere-page">
      <div className="premiere-stage">
        {premiere.thumbnail && <img className="premiere-stage__img" src={premiere.thumbnail} alt="" />}
        <div className="premiere-stage__over" role="timer" aria-live="off" aria-label={t('premieres.startsAt', { when })}>
          <StatusPill tone="media" icon="theaters">{t('premieres.badge')}</StatusPill>
          {isStarting ? (
            <b className="premiere-stage__starting"><Icon name="progress_activity" size={24} className="v2-spin" />{t('premieres.starting')}</b>
          ) : (
            <>
              <span className="premiere-stage__label">{t('premieres.startsIn')}</span>
              <b className="premiere-stage__clock num">
                {`${days > 0 ? `${t('premieres.days', { count: days })} ` : ''}${pad(hours)}:${pad(minutes)}:${pad(seconds)}`}
              </b>
            </>
          )}
        </div>
      </div>
      <div className="v2-card premiere-info">
        <div className="premiere-info__text">
          <h1 className="premiere-info__title">{premiere.title || premiere.permlink}</h1>
          <Link to={profilePath(premiere.owner)} className="premiere-info__by">
            <AccountImg account={premiere.owner} alt="" className="premiere-info__avatar" />
            <span>@{premiere.owner}</span>
          </Link>
          <p className="premiere-info__when">
            <Icon name="event" size={18} /> {t('premieres.startsAt', { when })}
            {premiere.reminders > 0 && <> · {t('premieres.waiting', { count: premiere.reminders })}</>}
          </p>
          <p className="premiere-info__note">{t('premieres.note')}</p>
        </div>
        {!isStarting && (
          <Button
            variant={reminded ? 'secondary' : 'primary'}
            size={44}
            icon={reminded ? 'notifications_active' : 'notifications'}
            onClick={onNotify}
            loading={busy}
            aria-pressed={!!user && reminded}
            className="premiere-info__notify"
          >
            {!user ? t('premieres.signInToNotify') : reminded ? t('premieres.notifying') : t('premieres.notifyMe')}
          </Button>
        )}
      </div>
    </div>
  );
}
