import { useEffect, useState } from 'react';
import { FaRocket } from 'react-icons/fa';
import { fetchIncubationProgress, onIncubationProgress } from '../../lib/incubation';
import TrackChooser from './TrackChooser';
import { useTranslation } from 'react-i18next';

/**
 * "What brings you to 3Speak?" on the profile, for someone who has not picked
 * a path yet (they chose "Decide later" on the welcome screen).
 *
 * In the main column rather than the sidebar: three tiles do not fit there.
 * Once they pick, the progress announcement makes this disappear and the goal
 * list appear in the sidebar.
 */
export const TRACK_QUESTION_ID = 'inc-track-question';

export default function TrackQuestion() {
  const { t } = useTranslation();
  const [needsTrack, setNeedsTrack] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = () => fetchIncubationProgress()
      .then((p) => { if (alive) setNeedsTrack(!!p?.needsTrack); })
      .catch(() => { /* the page still works without it */ });
    load();
    const off = onIncubationProgress(load);
    return () => { alive = false; off(); };
  }, []);

  if (!needsTrack) return null;

  return (
    <section className="inc-panel inc-track-question" id={TRACK_QUESTION_ID}>
      <h2><FaRocket size={14} aria-hidden="true" /> {t('incubation.trackQuestion.title')}</h2>
      <p className="inc-track-intro">
        {t('incubation.trackQuestion.intro')}
      </p>
      <TrackChooser />
    </section>
  );
}
