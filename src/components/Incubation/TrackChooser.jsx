import { useState } from 'react';
import { setIncubationTrack } from '../../lib/incubation';
import { openTracks } from './tracks';
import { ChoiceCard } from '../v2/ui';
import { useTranslation } from 'react-i18next';
import './TrackChooser.scss';

/**
 * "What brings you to 3Speak?" The answer decides which goals someone works
 * through before the team reviews them for a Hive account (server/warmup.cjs):
 * a viewer is asked to watch and join in, a creator to publish, an advertiser
 * to set up their brand's profile.
 *
 * Shown on the welcome screen, and on the profile for anyone who has not
 * answered yet. The profile offers no way to change the answer afterwards.
 */
export default function TrackChooser({ current = null, onChosen }) {
  const { t } = useTranslation();
  const [saving, setSaving] = useState(null);
  const [error, setError] = useState('');

  async function choose(id) {
    if (saving) return;
    if (id === current) { onChosen?.(id); return; }
    setSaving(id);
    setError('');
    try {
      await setIncubationTrack(id);
      onChosen?.(id);
    } catch {
      setError(t('incubation.trackChooser.saveFailed'));
    } finally {
      setSaving(null);
    }
  }

  return (
    <div className="track-chooser">
      <div className="track-chooser-options v2-choices" role="radiogroup" aria-label={t('incubation.trackQuestion.title')}>
        {openTracks(current).map(({ id, icon, titleKey, bodyKey }) => (
          <ChoiceCard
            key={id}
            selected={current === id}
            icon={saving === id ? 'progress_activity' : icon}
            title={t(titleKey)}
            sub={saving === id ? t('incubation.trackChooser.saving') : t(bodyKey)}
            onClick={() => choose(id)}
            disabled={!!saving}
            className={`track-option${current === id ? ' is-current' : ''}${saving === id ? ' is-saving' : ''}`}
          />
        ))}
      </div>
      {error && <p className="track-chooser-error" role="alert">{error}</p>}
    </div>
  );
}
