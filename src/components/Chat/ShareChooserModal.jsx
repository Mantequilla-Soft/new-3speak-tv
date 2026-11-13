import { useEffect, useRef, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { Icon } from '../v2/Icon'
import { Button, Segmented } from '../v2/ui'
import { cx } from '../v2/helpers'
import DialogShell, { SheetContext } from '../modal/DialogShell'
import usePostThumb from '../modal/usePostThumb'
import useReblog from '../../hooks/useReblog'
import { getFollowers } from '../../hive-api/api'
import { isLoggedIn, getOperationUser } from '../../hive-api/aioha'
import { toastIn } from '../../utils/toast';
import { useChat } from '../../context/ChatContext'
import { useOpenChat } from '../../hooks/useOpenChat'
import { EMBED_SIZES, buildEmbedHtml } from '../../utils/embedCode'
import './shareChooser.scss'
import { useTranslation } from 'react-i18next'

// Every toast from this module is headed "Chat"; the message becomes the
// line under it. See utils/toast.js.
const toast = toastIn('Chat');

const clock = (sec) => {
  const n = Math.floor(sec || 0)
  const h = Math.floor(n / 3600), m = Math.floor((n % 3600) / 60), s = n % 60
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`
}

// A big Hive tile (07b): icon on top, a 16/900 title and one line at the bottom.
function HiveTile({ icon, title, sub, tone, onClick, disabled, pressed, className }) {
  return (
    <button type="button" className={cx('share-hive', tone && `is-${tone}`, className)} onClick={onClick} disabled={disabled} aria-pressed={pressed}>
      <Icon name={icon} size={28} />
      <span className="share-hive__text">
        <b>{title}</b>
        {sub && <span>{sub}</span>}
      </span>
    </button>
  )
}

// A small app tile (07b): icon over an 11px label.
function AppTile({ icon, label, onClick, className }) {
  return (
    <button type="button" className={cx('share-app', className)} onClick={onClick}>
      <Icon name={icon} size={24} />
      <span>{label}</span>
    </button>
  )
}

/**
 * The share sheet (07b, 07g): Hive first (Reblog, the link for a Hive post),
 * then apps (3Speak Chat, Telegram, X, the device's own share), the link with
 * its QR code and an optional start time, and Copy link pinned at the bottom.
 * The embed code sits behind the Embed tab, and Clip behind its own tab when
 * the page can clip.
 *
 * Props:
 *  - open: boolean
 *  - url: the shareable URL
 *  - title: optional title (prepended to the chat message)
 *  - embed: optional { author, permlink } — the HIVE pair of a PUBLISHED video.
 *           Present ⇒ the Embed tab and Reblog are offered. Omit it for anything
 *           that can't be played on someone else's page (a scheduled post, a live
 *           stream with no VOD asset yet).
 *  - hivePost: optional { author, permlink }. Present ⇒ "For Hive post" is offered:
 *           it copies https://3speak.tv/watch?v=author/permlink, the one link
 *           form Hive frontends turn into a player, from the watch page AND
 *           from shorts (whose own share link is /shorts?v=…). Always the public
 *           origin, so a copy made on preview still works in a post.
 *  - startAt: optional seconds into the video; offers "Start at m:ss" on the link
 *  - onClip: optional () => void, the page's clip mode; adds the Clip tab
 *  - onClose: () => void
 *  - onGeneralShare: () => void  — the page's existing share handler
 */
export default function ShareChooserModal({ open, url, title, embed, hivePost, startAt, onClip, onClose, onGeneralShare }) {
  const { t } = useTranslation()
  const openChat = useOpenChat()
  const { setShareDraft, backToList } = useChat()
  // 'share' | 'embed' | 'clip'. The component stays mounted between opens (the
  // parent just flips `open`), so the view is reset explicitly rather than on mount.
  const [view, setView] = useState('share')
  const [size, setSize] = useState('responsive')
  const [withStart, setWithStart] = useState(true)
  const [followers, setFollowers] = useState(null)
  const codeRef = useRef(null)

  // Re-opening always lands on the Share tab. Adjusted during render (the
  // React-docs pattern for state derived from a prop) rather than in an effect,
  // which would paint the previous view for a frame first.
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) { setView('share'); setWithStart(true) }
  }

  const reblog = useReblog(embed?.author, embed?.permlink, toast)
  const ctxPost = embed || hivePost
  const post = usePostThumb(ctxPost?.author, ctxPost?.permlink, open)
  const me = isLoggedIn() ? getOperationUser() : null
  useEffect(() => {
    if (!open || !me || !reblog.canReblog) return undefined
    let live = true
    getFollowers(me).then((r) => { if (live && r) setFollowers(Number(r.follower_count) || 0) })
    return () => { live = false }
  }, [open, me, reblog.canReblog])

  if (!open) return null

  const canEmbed = !!(embed?.author && embed?.permlink)
  const embedCode = canEmbed ? buildEmbedHtml(embed.author, embed.permlink, { size, title }) : ''
  const hivePostUrl = hivePost?.author && hivePost?.permlink
    ? `https://3speak.tv/watch?v=${hivePost.author}/${hivePost.permlink}`
    : ''
  const start = Math.floor(Number(startAt) || 0)
  const shareUrl = start > 0 && withStart ? `${url}${url.includes('?') ? '&' : '?'}t=${start}` : url
  const shownUrl = shareUrl.replace(/^https?:\/\//, '')

  const sendInChat = () => {
    // Just the link — the chat renders a rich card (title/author/thumb) from it.
    setShareDraft(shareUrl)
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

  // Telegram and X take the link in their own share URL; nothing is posted
  // until the user sends it there.
  const openApp = (app) => {
    const u = encodeURIComponent(shareUrl)
    const text = encodeURIComponent(title || '')
    const href = app === 'telegram'
      ? `https://t.me/share/url?url=${u}&text=${text}`
      : `https://x.com/intent/post?url=${u}&text=${text}`
    window.open(href, '_blank', 'noopener,noreferrer')
  }

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl)
      toast.success(t('watch.share.linkCopied'))
      onClose?.()
    } catch {
      window.prompt(t('common.actions.copyLink'), shareUrl)
    }
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

  const tabs = [
    { value: 'share', label: t('common.actions.share') },
    canEmbed && { value: 'embed', label: t('chat.share.embed') },
    onClip && { value: 'clip', label: t('watch.clip.clip') },
  ].filter(Boolean)

  const footer = view === 'embed' ? (
    <Button variant="primary" size={48} block trailing="content_copy" className="dlg-main share-embed-copy" onClick={copyEmbed}>
      {t('chat.share.copyEmbed')}
    </Button>
  ) : view === 'clip' ? (
    <Button variant="primary" size={48} block trailing="content_cut" className="dlg-main" onClick={() => { onClose?.(); onClip?.() }}>
      {t('watch.clip.clipVideo')}
    </Button>
  ) : (
    <Button variant="primary" size={48} block trailing="content_copy" className="dlg-main share-copy-link" onClick={copyLink}>
      {t('common.actions.copyLink')}
    </Button>
  )

  return (
    <DialogShell
      open={open}
      onClose={onClose}
      side
      tone="cyan"
      width={430}
      zIndex={1300}
      className="share-chooser"
      bodyClassName="share-sheet"
      title={t('common.actions.share')}
      footer={footer}
    >
      {(title || post.thumbnail) && (
        <SheetContext className="share-ctx" thumb={post.thumbnail} title={title} meta={ctxPost?.author ? `@${ctxPost.author}` : undefined} />
      )}
      {tabs.length > 1 && (
        <Segmented className="share-tabs" size={36} label={t('common.actions.share')} value={view} onChange={setView} options={tabs} />
      )}

      {view === 'embed' && (
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
          <p className="share-embed-sub">
            {size === 'responsive' ? t('chat.share.responsiveSub') : t('chat.share.fixedSub')}
          </p>
        </div>
      )}

      {view === 'clip' && (
        <p className="share-embed-hint">{t('watch.clip.startHint')}</p>
      )}

      {view === 'share' && (
        <>
          {(reblog.canReblog || hivePostUrl) && (
            <div className={cx('share-hive-row', !(reblog.canReblog && hivePostUrl) && 'is-single')}>
              {reblog.canReblog && (
                <HiveTile
                  icon="repeat"
                  tone="cyan"
                  className="share-reblog"
                  title={reblog.label}
                  sub={reblog.reblogged ? null : followers != null ? t('chat.share.toFollowers', { count: followers, n: followers.toLocaleString() }) : t('common.reblog.title')}
                  pressed={reblog.reblogged || reblog.armed}
                  disabled={reblog.busy || reblog.reblogged}
                  onClick={() => reblog.press()}
                />
              )}
              {hivePostUrl && (
                <HiveTile icon="article" className="share-hivepost" title={t('chat.share.forHivePost')} sub={t('chat.share.forHivePostSub')} onClick={copyHivePostLink} />
              )}
            </div>
          )}
          <div className="share-apps">
            <AppTile icon="forum" label={t('chat.share.chat')} onClick={sendInChat} className="share-app--chat" />
            <AppTile icon="send" label="Telegram" onClick={() => openApp('telegram')} />
            <AppTile icon="alternate_email" label="X" onClick={() => openApp('x')} />
            <AppTile icon="more_horiz" label={t('chat.share.more')} onClick={generalShare} className="share-app--more" />
          </div>
          <div className="share-link">
            <span className="share-link__qr" aria-hidden="true">
              <QRCodeSVG value={shareUrl} size={60} bgColor="white" fgColor="black" level="L" />
            </span>
            <span className="share-link__body">
              <span className="share-link__url" title={shareUrl}>{shownUrl}</span>
              {start > 0 && (
                <label className="share-link__start">
                  <input type="checkbox" checked={withStart} onChange={(e) => setWithStart(e.target.checked)} />
                  <span className="share-link__box" aria-hidden="true"><Icon name="check" size={14} /></span>
                  {t('chat.share.startAt')} <b className="num">{clock(start)}</b>
                </label>
              )}
            </span>
          </div>
        </>
      )}
    </DialogShell>
  )
}
