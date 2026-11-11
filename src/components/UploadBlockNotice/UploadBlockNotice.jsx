import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button, Icon } from '../v2/ui';
import { useAppStore } from '../../lib/store';
import { useSupportBlock } from '../../lib/supportBlockStore';
import { creatorKey, isUploadBlocked, useCreatorSettings } from '../../utils/creatorSettings';
import BlockNote from './BlockNote';
import './UploadBlockNotice.scss';

// Same links as the support popup and the profile sidebar.
const DISCORD_URL = 'https://discord.com/invite/NSFS2VGj83';
const TELEGRAM_URL = 'https://t.me/threespeak';

// Pages nothing may cover: /advertise is for people from outside 3Speak and
// /egress-stream is recorded (same list as the announcement popup).
const SILENT_ROUTES = ['/advertise', '/egress-stream'];
const isSilentRoute = (pathname) => {
  const p = String(pathname || '').toLowerCase();
  return SILENT_ROUTES.some((r) => p === r || p.startsWith(`${r}/`));
};
const isAutomated = () =>
  typeof navigator !== 'undefined' &&
  (navigator.webdriver || /bot|crawl|spider|headless|lighthouse/i.test(navigator.userAgent || ''));

// Which block the person has already seen the popup for, per account key.
// A new block (new date or note) shows the popup again.
const SEEN_KEY = '3speak_upload_block_seen';
function readSeen(key) {
  try { return JSON.parse(localStorage.getItem(SEEN_KEY) || '{}')[key] ?? null; } catch { return null; }
}
function markSeen(key, id) {
  try {
    const all = JSON.parse(localStorage.getItem(SEEN_KEY) || '{}');
    all[key] = id;
    localStorage.setItem(SEEN_KEY, JSON.stringify(all));
  } catch { /* storage blocked: the popup may show again, the banner stays either way */ }
}

/**
 * What a creator blocked from uploading sees (admin panel: "Block uploads").
 * - Once per block: the support popup, quoting the admin's note.
 * - While the block lasts: this banner at the top of every page, with the note
 *   and the Discord / Telegram contact links.
 * Shown to a blocked warm-up user (`~handle` row) always, and to a blocked Hive
 * account only when the admin left a note: older Hive blocks carry none and keep
 * the click-time popup only.
 */
export default function UploadBlockNotice({ hidden = false }) {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const authenticated = useAppStore((s) => s.authenticated);
  const hiveUser = useAppStore((s) => s.user);
  const incubationHandle = useAppStore((s) => s.incubationHandle);
  const changelogPending = useAppStore((s) => !!s.appUpdatedFrom);

  const key = authenticated ? creatorKey(hiveUser, incubationHandle) : null;
  const settings = useCreatorSettings(key);
  const note = typeof settings?.uploadBlockedReason === 'string' ? settings.uploadBlockedReason.trim() : '';
  const isWarmup = !!key && key.startsWith('~');
  const active = isUploadBlocked(settings) && (isWarmup || !!note) && !isSilentRoute(pathname) && !isAutomated();
  const blockId = active ? String(settings.uploadBlockedAt || note || 'blocked') : null;

  useEffect(() => {
    if (!blockId || changelogPending) return;
    if (readSeen(key) === blockId) return;
    const support = useSupportBlock.getState();
    if (support.block) return; // another support popup is open; try again on the next page load
    support.showSupportBlock('upload', {
      ...(note ? { note } : {}),
      onClose: () => markSeen(key, blockId),
    });
  }, [key, blockId, note, changelogPending]);

  if (!active || hidden) return null;

  return (
    <section className="upload-block-notice" role="status">
      <div className="ubn-head">
        <span className="ubn-icon"><Icon name="upload_off" size={28} /></span>
        <div className="ubn-head__text">
          <h2 className="ubn-title">{t('app.supportBlock.upload.title')}</h2>
          <p className="ubn-body">{t('app.uploadBlock.bannerBody')}</p>
        </div>
      </div>
      {note && (
        <div className="ubn-note">
          <BlockNote note={note} />
        </div>
      )}
      <div className="ubn-actions">
        <Button as="a" variant="secondary" size={44} icon="forum" trailing="open_in_new" className="ubn-btn is-next" href={DISCORD_URL} target="_blank" rel="noopener noreferrer">
          Discord
        </Button>
        <Button as="a" variant="secondary" size={44} icon="send" trailing="open_in_new" className="ubn-btn is-next" href={TELEGRAM_URL} target="_blank" rel="noopener noreferrer">
          Telegram
        </Button>
      </div>
    </section>
  );
}
