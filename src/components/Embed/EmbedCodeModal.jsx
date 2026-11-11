import { useRef, useState, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import DialogShell from '../modal/DialogShell'
import { Button } from '../v2/ui'
import { Icon } from '../v2/Icon'
import { cx } from '../v2/helpers'
import { toastIn } from '../../utils/toast'
import {
  AUDIO_EMBED_SIZES, PLAYLIST_EMBED_SIZES, buildAudioEmbedHtml, buildPlaylistEmbedHtml, buildPodcastEmbedHtml,
} from '../../utils/embedCode'
import './EmbedCodeModal.scss'

const toast = toastIn('Audio')

/*
 * "Embed on a website" for an audio or a playlist. Opened from anywhere with
 * openEmbedCode({ kind, id, title }); rendered once, by <EmbedCodeHost /> in
 * App. Living outside the share menus matters: those close on any click
 * outside them, which would take a dialog they owned down with them.
 *
 *  - kind 'audio':    id = the audio's own permlink (embed-audio `permlink`)
 *  - kind 'playlist': id = the 3speak.tv playlist id; the embed plays its audio tracks
 *  - kind 'podcast':  id = an outside show's id (the checker's); the embed plays its episodes
 */
let current = null
const listeners = new Set()
const emit = () => listeners.forEach((fn) => fn())
const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn) }
const snapshot = () => current

export function openEmbedCode(target) {
  current = target?.id ? { ...target, key: Date.now() } : null
  emit()
}

function closeEmbedCode() {
  current = null
  emit()
}

export default function EmbedCodeHost() {
  const target = useSyncExternalStore(subscribe, snapshot, snapshot)
  if (!target) return null
  // Keyed per open, so the size choice starts fresh every time.
  return <EmbedCodeModal key={target.key} target={target} onClose={closeEmbedCode} />
}

function EmbedCodeModal({ target, onClose }) {
  const { t } = useTranslation()
  const isList = target.kind === 'playlist' || target.kind === 'podcast'
  const sizes = isList ? PLAYLIST_EMBED_SIZES : AUDIO_EMBED_SIZES
  const [size, setSize] = useState(sizes[0].id)
  const codeRef = useRef(null)
  const spec = sizes.find((s) => s.id === size) || sizes[0]
  const build = { playlist: buildPlaylistEmbedHtml, podcast: buildPodcastEmbedHtml }[target.kind] || buildAudioEmbedHtml
  const code = build(target.id, { size, title: target.title })
  const heading = { playlist: 'misc.embed.playlistTitle', podcast: 'misc.embed.podcastTitle' }[target.kind] || 'misc.embed.audioTitle'
  const hint = { playlist: 'misc.embed.playlistHint', podcast: 'misc.embed.podcastHint' }[target.kind] || 'chat.share.embedHint'

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code)
      toast.success(t('chat.share.embedCopied'))
    } catch {
      // Clipboard denied: select the code so it can be copied by hand.
      codeRef.current?.focus()
      codeRef.current?.select()
      toast.info(t('chat.share.pressToCopy'))
    }
  }

  // Design 44c: hint, the sizes on a 28px segmented track, a strip that sketches
  // the player at that size, its size line, the snippet in a mono well, and one
  // primary Copy button.
  return (
    <DialogShell
      onClose={onClose}
      title={t(heading)}
      width={480}
      zIndex={1300}
      className="embed-code-dialog"
      footer={(
        <Button variant="primary" icon="content_copy" onClick={copy}>{t('chat.share.copyEmbed')}</Button>
      )}
    >
      <p className="embed-code-hint">{t(hint)}</p>
      <div className="v2-seg is-block embed-code-sizes" role="group" aria-label={t('chat.share.embedSize')}>
        {sizes.map((s) => (
          <button
            key={s.id}
            type="button"
            className={cx('v2-seg__opt', 'h28', size === s.id && 'is-on')}
            aria-pressed={size === s.id}
            onClick={() => setSize(s.id)}
          >
            {s.labelKey ? t(s.labelKey) : s.label}
          </button>
        ))}
      </div>
      {/* A sketch of the embedded player (cover, play, progress), not the live
          embed: "minimal" drops the cover, "with title" adds the title line. */}
      <div className={cx('embed-code-strip', `is-${size}`)} aria-hidden="true">
        {size !== 'minimal' && <span className="embed-code-strip__art" />}
        <Icon name="play_circle" size={20} />
        <span className="embed-code-strip__main">
          {size === 'full' && target.title && <span className="embed-code-strip__title">{target.title}</span>}
          <span className="embed-code-strip__bar" />
        </span>
      </div>
      <p className="embed-code-size">{t('misc.embed.heightSub', { height: spec.height })}</p>
      <textarea
        ref={codeRef}
        className="embed-code-text"
        readOnly
        rows={5}
        spellCheck={false}
        value={code}
        onFocus={(e) => e.target.select()}
        aria-label={t('chat.share.embedCode')}
      />
    </DialogShell>
  )
}
