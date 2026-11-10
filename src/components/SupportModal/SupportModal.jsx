import { FaDiscord } from 'react-icons/fa';
import { SiTelegram } from 'react-icons/si';
import { useTranslation } from 'react-i18next';
import { useSupportBlock } from '../../lib/supportBlockStore';
import ModalHeader from '../ModalHeader/ModalHeader';
import BlockNote from '../UploadBlockNotice/BlockNote';
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
  const hideBlock = useSupportBlock((s) => s.hideSupportBlock);
  if (!block) return null;

  const copy = COPY[block.reason] || COPY.banned;
  const hide = () => {
    try { block.onClose?.(); } catch { /* ignore */ }
    hideBlock();
  };

  return (
    <div className="support-modal-overlay" onClick={hide}>
      <div className="support-modal" onClick={(e) => e.stopPropagation()}>
        <ModalHeader title={t(copy.titleKey)} onClose={hide} />
        <p className="support-modal-body">{t(copy.bodyKey)}</p>
        {block.note && (
          <div className="support-modal-note">
            <BlockNote note={block.note} />
          </div>
        )}
        <div className="support-modal-actions">
          <a className="support-modal-btn" href={DISCORD_URL} target="_blank" rel="noopener noreferrer">
            <FaDiscord size={20} /> <span>Discord</span>
          </a>
          <a className="support-modal-btn" href={TELEGRAM_URL} target="_blank" rel="noopener noreferrer">
            <SiTelegram size={20} /> <span>Telegram</span>
          </a>
        </div>
      </div>
    </div>
  );
}
