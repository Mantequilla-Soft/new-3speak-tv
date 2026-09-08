import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ArrowLeft, Code2, Copy, MessageCircle, Share2, X } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { toastIn } from '../../utils/toast';
import { useChat } from '../../context/ChatContext'
import { EMBED_SIZES, buildEmbedHtml } from '../../utils/embedCode'
import './shareChooser.scss'

// Every toast from this module is headed "Chat"; the message becomes the
// line under it. See utils/toast.js.
const toast = toastIn('Chat');

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
 *  - onClose: () => void
 *  - onGeneralShare: () => void  — the page's existing share handler
 */
export default function ShareChooserModal({ open, url, title, embed, onClose, onGeneralShare }) {
  const navigate = useNavigate()
  const { setShareDraft } = useChat()
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

  const sendInChat = () => {
    // Just the link — the chat renders a rich card (title/author/thumb) from it.
    setShareDraft(url)
    onClose?.()
    navigate('/chat')
  }

  const generalShare = () => {
    onClose?.()
    onGeneralShare?.()
  }

  const copyEmbed = async () => {
    try {
      await navigator.clipboard.writeText(embedCode)
      toast.success('Embed code copied')
    } catch {
      // Clipboard denied (or an older browser): select it so the user can copy
      // by hand rather than being told nothing happened.
      codeRef.current?.focus()
      codeRef.current?.select()
      toast.info('Press Ctrl/Cmd + C to copy the selected code')
    }
  }

  return createPortal(
    <div className="share-chooser-overlay" onClick={onClose}>
      <div className="share-chooser" role="dialog" aria-label="Share" onClick={(e) => e.stopPropagation()}>
        {view === 'embed' && (
          <button className="share-chooser-back" onClick={() => setView('menu')} aria-label="Back">
            <ArrowLeft size={18} />
          </button>
        )}
        <button className="share-chooser-close" onClick={onClose} aria-label="Close">
          <X size={18} />
        </button>

        {view === 'embed' ? (
          <>
            <h3 className="share-chooser-title">Embed this video</h3>
            <p className="share-embed-hint">Paste this into any website or blog post.</p>
            <div className="share-embed-sizes" role="group" aria-label="Embed size">
              {EMBED_SIZES.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className={`share-embed-size${size === s.id ? ' active' : ''}`}
                  aria-pressed={size === s.id}
                  onClick={() => setSize(s.id)}
                >
                  {s.label}
                </button>
              ))}
            </div>
            <textarea
              ref={codeRef}
              className="share-embed-code"
              readOnly
              rows={6}
              spellCheck={false}
              value={embedCode}
              onFocus={(e) => e.target.select()}
              aria-label="Embed code"
            />
            <button className="share-chooser-opt share-embed-copy" onClick={copyEmbed}>
              <Copy size={20} />
              <span>
                <span className="share-chooser-opt-title">Copy embed code</span>
                <span className="share-chooser-opt-sub">
                  {size === 'responsive' ? 'Scales to fit the page it sits on' : 'Fixed size iframe'}
                </span>
              </span>
            </button>
          </>
        ) : (
          <>
            <h3 className="share-chooser-title">Share</h3>
            <button className="share-chooser-opt" onClick={sendInChat}>
              <MessageCircle size={20} />
              <span>
                <span className="share-chooser-opt-title">Send in 3Speak Chat</span>
                <span className="share-chooser-opt-sub">Message it to someone on 3Speak</span>
              </span>
            </button>
            {canEmbed && (
              <button className="share-chooser-opt" onClick={() => setView('embed')}>
                <Code2 size={20} />
                <span>
                  <span className="share-chooser-opt-title">Embed on a website</span>
                  <span className="share-chooser-opt-sub">Copy the HTML for your own site or blog</span>
                </span>
              </button>
            )}
            <button className="share-chooser-opt" onClick={generalShare}>
              <Share2 size={20} />
              <span>
                <span className="share-chooser-opt-title">Share / copy link</span>
                <span className="share-chooser-opt-sub">Other apps, or copy the link</span>
              </span>
            </button>
          </>
        )}
      </div>
    </div>,
    document.body
  )
}
