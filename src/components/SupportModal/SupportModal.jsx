import { useTranslation } from 'react-i18next';
import { useSupportBlock } from '../../lib/supportBlockStore';
import { Dialog } from '../v2/ui';
import { Icon } from '../v2/Icon';
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

  // Design 44a (banned, upload disabled with a team note) on the v2 Dialog:
  // the reason in an accent icon well, the team's note quoted under it, and
  // the two places to talk to the team.
  return (
    <Dialog
      open
      onClose={hide}
      title={t(copy.titleKey)}
      closeLabel={t('common.actions.close')}
      width={440}
      className="support-modal"
      footer={(
        <div className="support-modal-actions">
          <a className="v2-btn v2-btn--secondary h44 is-next support-modal-btn" href={DISCORD_URL} target="_blank" rel="noopener noreferrer">
            <Icon name="forum" size={18} /><span className="v2-btn__label">Discord</span><Icon name="open_in_new" size={16} />
          </a>
          <a className="v2-btn v2-btn--secondary h44 is-next support-modal-btn" href={TELEGRAM_URL} target="_blank" rel="noopener noreferrer">
            <Icon name="send" size={18} /><span className="v2-btn__label">Telegram</span><Icon name="open_in_new" size={16} />
          </a>
        </div>
      )}
    >
      <div className="support-modal-lead">
        <span className="support-modal-icon" aria-hidden="true">
          <Icon name={block.reason === 'upload' ? 'file_upload_off' : 'block'} size={24} />
        </span>
        <p className="support-modal-body">{t(copy.bodyKey)}</p>
      </div>
      {block.note && (
        <div className="support-modal-note">
          <BlockNote note={block.note} />
        </div>
      )}
    </Dialog>
  );
}
