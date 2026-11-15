import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../../lib/store';
import { useNotifyLevels, useSetNotifyLevel, levelOf, LEVELS } from '../../lib/notifyLevels';
import { Dialog, ChoiceCard, DockTile } from '../v2/ui';
import { Icon } from '../v2/Icon';
import { toastIn } from '../../utils/toast';
import './NotifyLevelButton.scss';

const toast = toastIn('Notifications');

const ICON = { all: 'notifications_active', highlights: 'notifications', off: 'notifications_off' };

/**
 * The bell next to Follow: All / Highlights / Off for one followed creator
 * (lib/notifyLevels.js). `variant` 'tile' is the channel header's action tile,
 * 'compact' the small square next to the Follow pill of an AuthorBadge. Only for
 * a signed-in viewer who follows the creator; the parent decides "follows".
 */
export default function NotifyLevelButton({ creator, variant = 'tile' }) {
  const { t } = useTranslation();
  const user = useAppStore((s) => s.user);
  const authenticated = useAppStore((s) => s.authenticated);
  const name = String(creator || '').toLowerCase();
  const levels = useNotifyLevels(authenticated ? user : null);
  const setLevel = useSetNotifyLevel(user);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!authenticated || !user || !name || name === user) return null;

  const level = levelOf(levels, name);
  const label = t('social.levels.button');
  const title = t('social.levels.buttonTitle', { user: name, level: t(`social.levels.${level}.title`) });

  const choose = async (next) => {
    if (next === level) { setOpen(false); return; }
    setBusy(true);
    try {
      await setLevel(name, next);
      toast.success(t(`social.levels.${next}.saved`, { user: name }));
      setOpen(false);
    } catch {
      toast.error(t('social.levels.saveFailed'));
    } finally {
      setBusy(false);
    }
  };

  const trigger = variant === 'compact' ? (
    <button
      type="button"
      className="follow-btn notify-level-btn"
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen(true); }}
      aria-label={title}
      title={title}
    >
      <Icon name={ICON[level]} size={16} fill={level === 'all'} />
    </button>
  ) : (
    // A ProfileTile (Userprofilepage/ProfileActions.jsx) drawn directly: importing
    // that module would pull Card3 into every AuthorBadge.
    <DockTile className="ph-tile ph-tile--notify" icon={<Icon name={ICON[level]} size={24} />} label={label} aria-label={title} title={title} onClick={() => setOpen(true)} />
  );

  return (
    <>
      {trigger}
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={t('social.levels.title', { user: name })}
        sub={t('social.levels.sub')}
        tone="cyan"
        closeLabel={t('common.actions.close')}
        width={420}
      >
        <div className="notify-level-choices" role="radiogroup" aria-label={t('social.levels.title', { user: name })}>
          {LEVELS.map((l) => (
            <ChoiceCard
              key={l}
              tone="cyan"
              selected={l === level}
              disabled={busy}
              icon={ICON[l]}
              title={t(`social.levels.${l}.title`)}
              sub={t(`social.levels.${l}.desc`)}
              onClick={() => choose(l)}
            />
          ))}
        </div>
      </Dialog>
    </>
  );
}
