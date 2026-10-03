import { FaDiscord } from 'react-icons/fa';
import { SiTelegram } from 'react-icons/si';
import { MdClose } from 'react-icons/md';
import { useTranslation } from 'react-i18next';
import { useSupportBlock } from '../../lib/supportBlockStore';
import './SupportModal.scss';

// Discord / Telegram — same links as the profile sidebar's support-wrap.
const DISCORD_URL = 'https://discord.com/invite/NSFS2VGj83';
const TELEGRAM_URL = 'https://t.me/threespeak';

const COPY = {
  banned: {
    titleKey: 'app.supportBlock.banned.title',
    bodyKey: 'app.supportBlock.banned.body',
  },
  upload: {
    titleKey: 'app.supportBlock.upload.title',
    bodyKey: 'app.supportBlock.upload.body',
  },
};

export default function SupportModal() {
  const { t } = useTranslation();
  const block = useSupportBlock((s) => s.block);
  const hide = useSupportBlock((s) => s.hideSupportBlock);
  if (!block) return null;

  const copy = COPY[block.reason] || COPY.banned;

  return (
    <div className="support-modal-overlay" onClick={hide}>
      <div className="support-modal" onClick={(e) => e.stopPropagation()}>
        <button className="support-modal-close" onClick={hide} aria-label={t('common.actions.close')}><MdClose size={20} /></button>
        <h3 className="support-modal-title">{t(copy.titleKey)}</h3>
        <p className="support-modal-body">{t(copy.bodyKey)}</p>
        <div className="support-modal-actions">
          <a className="support-modal-btn discord" href={DISCORD_URL} target="_blank" rel="noopener noreferrer">
            <FaDiscord size={20} /> <span>Discord</span>
          </a>
          <a className="support-modal-btn telegram" href={TELEGRAM_URL} target="_blank" rel="noopener noreferrer">
            <SiTelegram size={20} /> <span>Telegram</span>
          </a>
        </div>
      </div>
    </div>
  );
}
