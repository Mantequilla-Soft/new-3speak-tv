import { useTranslation } from 'react-i18next';
import { Button, Icon } from '../v2/ui';
import './StreamStoryPrompt.scss';

/**
 * Studio post tab, before Start Stream (owner 2026-11-13): announce the stream
 * upfront with a 24h story instead of being asked for one after it ended. The
 * story recorder opens in a NEW tab so the studio (and its LiveKit session,
 * camera and shares) stays open here.
 */
export default function StreamStoryPrompt() {
  const { t } = useTranslation();
  return (
    <div className="stream-story-prompt">
      <Icon name="campaign" size={20} className="stream-story-prompt__icon" />
      <p className="stream-story-prompt__text">{t('live.announce.storyPrompt')}</p>
      <Button
        variant="secondary"
        size={36}
        trailing="open_in_new"
        className="stream-story-prompt__btn"
        onClick={() => window.open('/embed-studio?from=story', '_blank', 'noopener')}
      >
        {t('live.announce.storyButton')}
      </Button>
    </div>
  );
}
