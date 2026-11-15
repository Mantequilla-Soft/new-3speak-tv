import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import DialogShell from '../modal/DialogShell';
import { Banner, Button, Chip, SettingRow, Toggle } from '../v2/ui';
import { STREAM_RATES, STREAM_CAPS } from '../../lib/boosts';
import { formatNumber } from '../../i18n';

/**
 * Stream sats while I listen (lib/boosts.js, hooks/useSatStream.js): on/off, sats
 * per minute, a monthly limit, and what was sent so far. Opened from the audio
 * player's Stream tile, which only shows with a browser Lightning wallet.
 * `stream` is useSatStream()'s result; nothing is saved until Save.
 */
export default function StreamSatsModal({ stream, to, onClose }) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(stream.settings);
  const n = (v) => formatNumber(v || 0);
  const save = () => { stream.setSettings(draft); onClose(); };

  return (
    <DialogShell
      open
      onClose={onClose}
      title={t('boosts.stream.title')}
      width={440}
      zIndex={9999}
      className="stream-sats"
      footer={<Button variant="primary" size={48} block onClick={save} trailing="bolt">{t('boosts.stream.save')}</Button>}
    >
      <p className="v2-meta">{t('boosts.stream.intro')}</p>
      <SettingRow
        title={t('boosts.stream.toggle')}
        sub={draft.enabled ? t('boosts.stream.on', { sats: n(draft.satsPerMinute), to }) : t('boosts.stream.off')}
        control={<Toggle checked={draft.enabled} onChange={(on) => setDraft({ ...draft, enabled: on })} label={t('boosts.stream.toggle')} />}
      />
      <div className="v2-field">
        <span className="v2-eyebrow">{t('boosts.stream.rate')}</span>
        <div className="v2-chips">
          {STREAM_RATES.map((r) => (
            <Chip key={r} selected={draft.satsPerMinute === r} onClick={() => setDraft({ ...draft, satsPerMinute: r })}>{n(r)}</Chip>
          ))}
        </div>
      </div>
      <div className="v2-field">
        <span className="v2-eyebrow">{t('boosts.stream.cap')}</span>
        <div className="v2-chips">
          {STREAM_CAPS.map((c) => (
            <Chip key={c} selected={draft.monthlyCap === c} onClick={() => setDraft({ ...draft, monthlyCap: c })}>{n(c)}</Chip>
          ))}
        </div>
      </div>
      <p className="v2-meta-sm num">{t('boosts.stream.spent', { spent: n(stream.spent), cap: n(draft.monthlyCap) })}</p>
      {stream.sessionSats > 0 && <p className="v2-meta-sm num">{t('boosts.stream.session', { sats: n(stream.sessionSats) })}</p>}
      {stream.status === 'capped' && <Banner tone="warn">{t('boosts.stream.capped')}</Banner>}
      {stream.status === 'stopped' && <Banner tone="warn">{t('boosts.stream.stopped')}</Banner>}
      <Banner tone="info" icon="bolt">{t('boosts.stream.budget')}</Banner>
    </DialogShell>
  );
}
