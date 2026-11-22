/**
 * A quote card from one transcript line (lib/quoteCard.js): the card as it will
 * look, the line (shortened or fixed if the transcript got a word wrong), an
 * optional comment, then Post as snap or Download. The snap links to the moment
 * and names the video as its source, so it shows in the video's
 * "Made from this" row (lib/derived.js).
 */
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Dialog, Field } from '../v2/ui';
import { useAppStore } from '../../lib/store';
import { publishSnap } from '../../lib/snaps';
import { registerDerivedLater } from '../../lib/derived';
import { uploadThumbnail } from '../../utils/uploadThumbnail';
import { toastIn } from '../../utils/toast';
import {
  CARD_SIZE, MAX_QUOTE, cleanQuote, drawQuoteCard, quoteBody, quoteMetadata, stamp,
} from '../../lib/quoteCard';
import markUrl from '../../assets/image/3S_mark.svg';
import './QuoteCardModal.scss';

const toast = toastIn('Video');

function loadMark() {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = markUrl;
  });
}

const canvasBlob = (canvas) => new Promise((resolve, reject) => {
  canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('no image'))), 'image/png');
});

export default function QuoteCardModal({ open, onClose, author, permlink, title, cue }) {
  const { t } = useTranslation();
  const user = useAppStore((s) => s.user);
  const canvasRef = useRef(null);
  const markRef = useRef(null);
  const [quote, setQuote] = useState('');
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(null); // 'post' | 'download'

  useEffect(() => {
    if (!open) return;
    setQuote(cleanQuote(cue?.text));
    setComment('');
  }, [open, cue]);

  // Redraw the card whenever the line changes (the mark loads once).
  useEffect(() => {
    if (!open) return undefined;
    let alive = true;
    (async () => {
      if (markRef.current === null) markRef.current = (await loadMark()) || false;
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext?.('2d');
      if (!alive || !ctx) return;
      const font = (typeof getComputedStyle === 'function' && getComputedStyle(document.body).fontFamily) || 'Roboto, Arial, sans-serif';
      drawQuoteCard(ctx, { quote: cleanQuote(quote) || '…', author, title, start: cue?.start, mark: markRef.current || null, font });
    })();
    return () => { alive = false; };
  }, [open, quote, author, title, cue]);

  const line = cleanQuote(quote);

  const post = async () => {
    if (!line || !user) return;
    setBusy('post');
    try {
      const blob = await canvasBlob(canvasRef.current);
      const imageUrl = await uploadThumbnail(new File([blob], 'quote.png', { type: 'image/png' }), user);
      if (!imageUrl) throw new Error('upload');
      const snap = await publishSnap({
        user,
        body: quoteBody({ quote: line, author, permlink, title, start: cue?.start, imageUrl, comment }),
        tags: ['quote'],
        meta: quoteMetadata({ author, permlink, start: cue?.start, end: cue?.end, imageUrl }),
      });
      registerDerivedLater(snap.author, snap.permlink);
      toast.success(t('quoteCard.posted'));
      onClose?.();
    } catch {
      toast.error(t('quoteCard.postFailed'));
    } finally { setBusy(null); }
  };

  const download = async () => {
    setBusy('download');
    try {
      const blob = await canvasBlob(canvasRef.current);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `3speak-quote-${permlink}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch {
      toast.error(t('quoteCard.downloadFailed'));
    } finally { setBusy(null); }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('quoteCard.title')}
      sub={Number.isFinite(cue?.start) ? t('quoteCard.sub', { time: stamp(cue.start) }) : null}
      width={520}
      className="quote-card-modal"
      dismissible={!busy}
      footer={(
        <div className="quote-card-modal__actions">
          <Button variant="secondary" size={40} icon="download" onClick={download} disabled={!!busy || !line} loading={busy === 'download'}>
            {t('quoteCard.download')}
          </Button>
          <Button variant="primary" size={40} icon="send" onClick={post} disabled={!!busy || !line || !user} loading={busy === 'post'}>
            {t('quoteCard.post')}
          </Button>
        </div>
      )}
    >
      <canvas ref={canvasRef} width={CARD_SIZE} height={CARD_SIZE} className="quote-card-modal__preview" aria-label={t('quoteCard.previewLabel')} role="img" />
      <Field
        as="textarea"
        label={t('quoteCard.lineLabel')}
        hint={t('quoteCard.lineHint', { max: MAX_QUOTE })}
        value={quote}
        maxLength={MAX_QUOTE + 40}
        rows={3}
        onChange={(e) => setQuote(e.target.value)}
      />
      <Field
        as="textarea"
        label={t('quoteCard.commentLabel')}
        optional
        optionalLabel={t('quoteCard.optional')}
        value={comment}
        maxLength={500}
        rows={2}
        onChange={(e) => setComment(e.target.value)}
      />
    </Dialog>
  );
}
