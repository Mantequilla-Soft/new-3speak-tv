import { useRef, useState } from 'react'
import { Icon } from '../v2/Icon'
import { Button, Dialog, IconButton, Segmented } from '../v2/ui'
import { toastIn } from '../../utils/toast';
import { useChat } from '../../context/ChatContext'
import { useOpenChat } from '../../hooks/useOpenChat'
import { EMBED_SIZES, buildEmbedHtml } from '../../utils/embedCode'
import './shareChooser.scss'
import { useTranslation } from 'react-i18next'

// Every toast from this module is headed "Chat"; the message becomes the
// line under it. See utils/toast.js.
const toast = toastIn('Chat');

// One action row of the menu (39d share): icon well, title, one muted line,
// and a chevron when it opens another view.
function Opt({ icon, title, sub, onClick, linkSub, more }) {
  return (
    <button type="button" className="share-chooser-opt" onClick={onClick}>
      <span className="share-chooser-opt-icon" aria-hidden="true"><Icon name={icon} size={20} /></span>
      <span className="share-chooser-opt-body">
        <span className="share-chooser-opt-title">{title}</span>
        <span className={`share-chooser-opt-sub${linkSub ? ' share-chooser-opt-link' : ''}`}>{sub}</span>
      </span>
      {more && <Icon name="chevron_right" size={20} className="share-chooser-opt-more" />}
    </button>
  )
}

/**
 * A small chooser shown when sharing a video/short: send it inside 3Speak Chat,
 * put it on another website (embed code), or fall back to the regular share
 * (native share sheet / copy link).
 *
 * Props:
 *  - open: boolean
 *  - url: the shareable URL
 *  - title: optional title (prepended to the chat message)
 *  - embed: optional { author, permlink } — the HIVE pair of a PUBLISHED video.
 *           Present ⇒ the embed option is offered. Omit it for anything that
 *           can't be played on someone else's page (a scheduled post, a live
 *           stream with no VOD asset yet).
 *  - hivePost: optional { author, permlink }. Present ⇒ "For Hive post" is offered:
 *           it copies https://3speak.tv/watch?v=author/permlink, the one link
 *           form Hive frontends turn into a player, from the watch page AND
 *           from shorts (whose own share link is /shorts?v=…). Always the public
 *           origin, so a copy made on preview still works in a post.
 *  - onClose: () => void
 *  - onGeneralShare: () => void  — the page's existing share handler
 */
export default function ShareChooserModal({ open, url, title, embed, hivePost, onClose, onGeneralShare }) {
  const { t } = useTranslation()
  const openChat = useOpenChat()
  const { setShareDraft, backToList } = useChat()
  // 'menu' | 'embed'. The component stays mounted between opens (the parent just
  // flips `open`), so the view is reset explicitly rather than on mount.
  const [view, setView] = useState('menu')
  const [size, setSize] = useState('responsive')
  const codeRef = useRef(null)

  // Re-opening always lands on the menu. Adjusted during render (the React-docs
  // pattern for state derived from a prop) rather than in an effect, which would
  // paint the previous view for a frame first.
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) setView('menu')
  }

  if (!open) return null

  const canEmbed = !!(embed?.author && embed?.permlink)
  const embedCode = canEmbed ? buildEmbedHtml(embed.author, embed.permlink, { size, title }) : ''
  const hivePostUrl = hivePost?.author && hivePost?.permlink
    ? `https://3speak.tv/watch?v=${hivePost.author}/${hivePost.permlink}`
    : ''

  const sendInChat = () => {
    // Just the link — the chat renders a rich card (title/author/thumb) from it.
    setShareDraft(url)
    // Back to the list so the user picks a target; an already-open thread would
    // never see the draft (it prefills on open only).
    backToList()
    onClose?.()
    openChat()
  }

  const generalShare = () => {
    onClose?.()
    onGeneralShare?.()
  }

  const copyHivePostLink = async () => {
    try {
      await navigator.clipboard.writeText(hivePostUrl)
      toast.success(t('chat.share.hivePostCopied'))
      onClose?.()
    } catch {
      // Clipboard denied (or an older browser): the prompt shows the link
      // pre-selected so it can still be copied by hand.
      window.prompt(t('chat.share.forHivePost'), hivePostUrl)
    }
  }

  const copyEmbed = async () => {
    try {
      await navigator.clipboard.writeText(embedCode)
      toast.success(t('chat.share.embedCopied'))
    } catch {
      // Clipboard denied (or an older browser): select it so the user can copy
      // by hand rather than being told nothing happened.
      codeRef.current?.focus()
      codeRef.current?.select()
      toast.info(t('chat.share.pressToCopy'))
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      width={440}
      className="share-chooser"
      title={view === 'embed' ? t('chat.share.embedTitle') : t('common.actions.share')}
      closeLabel={t('common.actions.close')}
      leading={view === 'embed' && (
        <IconButton
          className="share-chooser-back"
          icon="arrow_back"
          size={32}
          variant="ghost"
          round
          onClick={() => setView('menu')}
          label={t('common.actions.back')}
        />
      )}
    >
      {view === 'embed' ? (
        <div className="share-embed">
          <p className="share-embed-hint">{t('chat.share.embedHint')}</p>
          <Segmented
            className="share-embed-sizes"
            label={t('chat.share.embedSize')}
            scroll
            value={size}
            onChange={setSize}
            options={EMBED_SIZES.map((s) => ({ value: s.id, label: s.labelKey ? t(s.labelKey) : s.label }))}
          />
          <textarea
            ref={codeRef}
            className="share-embed-code v2-input is-area"
            readOnly
            rows={6}
            spellCheck={false}
            value={embedCode}
            onFocus={(e) => e.target.select()}
            aria-label={t('chat.share.embedCode')}
          />
          <Button variant="primary" size={48} block icon="content_copy" className="share-embed-copy" onClick={copyEmbed}>
            {t('chat.share.copyEmbed')}
          </Button>
          <p className="share-embed-sub">
            {size === 'responsive' ? t('chat.share.responsiveSub') : t('chat.share.fixedSub')}
          </p>
        </div>
      ) : (
        <div className="share-chooser-list">
          <Opt icon="forum" title={t('chat.share.sendInChat')} sub={t('chat.share.sendInChatSub')} onClick={sendInChat} />
          {canEmbed && (
            <Opt icon="code" title={t('chat.share.embedOnWebsite')} sub={t('chat.share.embedOnWebsiteSub')} onClick={() => setView('embed')} more />
          )}
          {hivePostUrl && (
            <Opt icon="article" title={t('chat.share.forHivePost')} sub={hivePostUrl.replace('https://', '')} onClick={copyHivePostLink} linkSub />
          )}
          <Opt icon="ios_share" title={t('chat.share.generalShare')} sub={t('chat.share.generalShareSub')} onClick={generalShare} />
        </div>
      )}
    </Dialog>
  )
}
