import { useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { Copy } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import ModalHeader from '../ModalHeader/ModalHeader'
import { toastIn } from '../../utils/toast'
import {
  AUDIO_EMBED_SIZES, PLAYLIST_EMBED_SIZES, buildAudioEmbedHtml, buildPlaylistEmbedHtml,
} from '../../utils/embedCode'
import '../Chat/shareChooser.scss'

const toast = toastIn('Audio')

/*
 * "Embed on a website" for an audio or a playlist. Opened from anywhere with
 * openEmbedCode({ kind, id, title }); rendered once, by <EmbedCodeHost /> in
 * App. Living outside the share menus matters: those close on any click
 * outside them, which would take a dialog they owned down with them.
 *
 *  - kind 'audio':    id = the audio's own permlink (embed-audio `permlink`)
 *  - kind 'playlist': id = the 3speak.tv playlist id; the embed plays its audio tracks
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
  const isPlaylist = target.kind === 'playlist'
  const sizes = isPlaylist ? PLAYLIST_EMBED_SIZES : AUDIO_EMBED_SIZES
  const [size, setSize] = useState(sizes[0].id)
  const codeRef = useRef(null)
  const spec = sizes.find((s) => s.id === size) || sizes[0]
  const code = isPlaylist
    ? buildPlaylistEmbedHtml(target.id, { size, title: target.title })
    : buildAudioEmbedHtml(target.id, { size, title: target.title })

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

  return createPortal(
    <div className="share-chooser-overlay" onClick={onClose}>
      <div
        className="share-chooser"
        role="dialog"
        aria-label={isPlaylist ? t('misc.embed.playlistTitle') : t('misc.embed.audioTitle')}
        onClick={(e) => e.stopPropagation()}
      >
        <ModalHeader
          className="share-chooser-header"
          title={isPlaylist ? t('misc.embed.playlistTitle') : t('misc.embed.audioTitle')}
          onClose={onClose}
        />
        <p className="share-embed-hint">
          {isPlaylist ? t('misc.embed.playlistHint') : t('chat.share.embedHint')}
        </p>
        <div className="share-embed-sizes" role="group" aria-label={t('chat.share.embedSize')}>
          {sizes.map((s) => (
            <button
              key={s.id}
              type="button"
              className={`share-embed-size${size === s.id ? ' active' : ''}`}
              aria-pressed={size === s.id}
              onClick={() => setSize(s.id)}
            >
              {s.labelKey ? t(s.labelKey) : s.label}
            </button>
          ))}
        </div>
        <textarea
          ref={codeRef}
          className="share-embed-code"
          readOnly
          rows={5}
          spellCheck={false}
          value={code}
          onFocus={(e) => e.target.select()}
          aria-label={t('chat.share.embedCode')}
        />
        <button type="button" className="share-chooser-opt share-embed-copy" onClick={copy}>
          <Copy size={20} />
          <span>
            <span className="share-chooser-opt-title">{t('chat.share.copyEmbed')}</span>
            <span className="share-chooser-opt-sub">{t('misc.embed.heightSub', { height: spec.height })}</span>
          </span>
        </button>
      </div>
    </div>,
    document.body
  )
}
