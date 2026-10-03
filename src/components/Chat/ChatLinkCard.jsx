import { useState, useEffect, Suspense } from 'react'
import { useNavigate } from 'react-router-dom'
import { Play, Loader2 } from 'lucide-react'
import { fetchLinkMeta, formatDuration, timeAgo } from './chatLinks'
import { useTranslation } from 'react-i18next'
import lazyRoute from '../../utils/lazyRoute'

// The watch-page player (SDK, controls, ads). Only fetched once somebody presses
// play on a video in chat.
const InlineVideoPlayer = lazyRoute(
  () => import('../playVideo/InlineVideoPlayer'),
  './components/playVideo/InlineVideoPlayer'
)

const avatarSmall = (name) => `/img/u/${name}/avatar/small`

/** Rich preview card for a 3Speak/Hive link (post, comment, profile, community). */
export default function ChatLinkCard({ link }) {
  const { t } = useTranslation()
  const [meta, setMeta] = useState(null)
  const [failed, setFailed] = useState(false)
  const [playing, setPlaying] = useState(false)
  const navigate = useNavigate()

  useEffect(() => {
    let cancelled = false
    setMeta(null)
    setFailed(false)
    fetchLinkMeta(link).then((m) => {
      if (cancelled) return
      if (m) setMeta(m)
      else setFailed(true)
    })
    return () => { cancelled = true }
  }, [link.kind, link.author, link.permlink, link.community])

  if (failed) return null
  if (!meta) return <div className="chat-linkcard chat-linkcard-loading">{t('chat.linkCard.loadingPreview')}</div>

  const open = () => {
    if (meta.kind === 'profile') navigate(`/p/${meta.author}`)
    else if (meta.kind === 'community') navigate(`/community/${meta.name}`)
    else if (meta.kind === 'post' && meta.isVideo) navigate(`/watch?v=${meta.author}/${meta.permlink}`)
    else navigate(`/post/${meta.author}/${meta.permlink}`)
  }
  const keyOpen = (e) => { if (e.key === 'Enter') open() }
  const cardProps = { role: 'button', tabIndex: 0, onClick: open, onKeyDown: keyOpen }

  // Profile / community share the same avatar + body layout.
  if (meta.kind === 'profile' || meta.kind === 'community') {
    const title = meta.kind === 'profile' ? meta.displayName : meta.title
    const sub = meta.kind === 'profile'
      ? `@${meta.author}`
      : (meta.subscribers
        ? t('chat.linkCard.communityWithSubscribers', { count: meta.subscribers, formatted: meta.subscribers.toLocaleString() })
        : t('chat.linkCard.community'))
    return (
      <div className="chat-linkcard chat-linkcard-account" {...cardProps}>
        <img className="chat-linkcard-account-avatar" src={meta.avatar} alt=""
          onError={(e) => { e.currentTarget.style.visibility = 'hidden' }} />
        <div className="chat-linkcard-body">
          <div className="chat-linkcard-title">{title}</div>
          <div className="chat-linkcard-meta"><span>{sub}</span></div>
          {meta.about && <div className="chat-linkcard-about">{meta.about}</div>}
        </div>
      </div>
    )
  }

  if (meta.kind === 'comment') {
    return (
      <div className="chat-linkcard chat-linkcard-comment" {...cardProps}>
        <div className="chat-linkcard-body">
          <div className="chat-linkcard-meta">
            <img className="chat-linkcard-avatar" src={avatarSmall(meta.author)} alt="" />
            <span className="chat-linkcard-author">@{meta.author}</span>
            {meta.created && <><span className="chat-linkcard-dot">·</span><span>{timeAgo(meta.created)}</span></>}
          </div>
          <div className="chat-linkcard-excerpt">{meta.excerpt || t('chat.linkCard.commentFallback')}</div>
        </div>
      </div>
    )
  }

  // Post (default)
  const dur = formatDuration(meta.duration)

  // A playable video: big thumbnail on top that turns into the player on press,
  // title and author below (which still open the watch page).
  if (meta.isVideo && meta.playable) {
    const watchUrl = `/watch?v=${meta.author}/${meta.permlink}`
    return (
      <div className="chat-linkcard chat-linkcard-video">
        {playing ? (
          <Suspense fallback={<div className="chat-linkcard-playerwait"><Loader2 size={24} className="chat-spin" /></div>}>
            <InlineVideoPlayer
              author={meta.author}
              permlink={meta.permlink}
              poster={meta.thumbnail}
              onOpenWatch={() => navigate(watchUrl)}
            />
          </Suspense>
        ) : (
          <button
            type="button"
            className="chat-linkcard-thumb chat-linkcard-thumb--play"
            onClick={(e) => { e.stopPropagation(); setPlaying(true) }}
            aria-label={t('chat.linkCard.play', { title: meta.title })}
          >
            {meta.thumbnail && (
              <img src={meta.thumbnail} alt="" loading="lazy"
                onError={(e) => { e.currentTarget.style.visibility = 'hidden' }} />
            )}
            <span className="chat-linkcard-play"><Play size={22} fill="#fff" /></span>
            {dur && <span className="chat-linkcard-dur">{dur}</span>}
          </button>
        )}
        <div className="chat-linkcard-body" {...cardProps}>
          <div className="chat-linkcard-title">{meta.title}</div>
          <div className="chat-linkcard-meta">
            <img className="chat-linkcard-avatar" src={avatarSmall(meta.author)} alt="" />
            <span className="chat-linkcard-author">@{meta.author}</span>
            {meta.created && <><span className="chat-linkcard-dot">·</span><span>{timeAgo(meta.created)}</span></>}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="chat-linkcard" {...cardProps}>
      {meta.thumbnail && (
        <div className="chat-linkcard-thumb">
          <img src={meta.thumbnail} alt="" loading="lazy"
            onError={(e) => { e.currentTarget.parentElement.style.display = 'none' }} />
          {meta.isVideo && <span className="chat-linkcard-play"><Play size={22} fill="#fff" /></span>}
          {dur && <span className="chat-linkcard-dur">{dur}</span>}
        </div>
      )}
      <div className="chat-linkcard-body">
        <div className="chat-linkcard-title">{meta.title}</div>
        <div className="chat-linkcard-meta">
          <img className="chat-linkcard-avatar" src={avatarSmall(meta.author)} alt="" />
          <span className="chat-linkcard-author">@{meta.author}</span>
          {meta.created && <><span className="chat-linkcard-dot">·</span><span>{timeAgo(meta.created)}</span></>}
        </div>
      </div>
    </div>
  )
}
