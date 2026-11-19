import { Fragment } from 'react';
import { useTranslation } from 'react-i18next';
import DialogShell from '../modal/DialogShell';
import { PLAYER_SHORTCUTS } from '../../lib/playerKeys';
import './KeyboardShortcuts.scss';

/**
 * The "?" sheet on the watch page: every player key, as key caps beside what it
 * does. A DialogShell, so it has the shared ModalHeader, closes on Escape and
 * opens from the bottom on a phone. `wide` lists the theater key (T), which only
 * does something where the page has room for it.
 */
export default function KeyboardShortcuts({ open, onClose, wide = true }) {
  const { t } = useTranslation();
  if (!open) return null;
  const keyName = (k) => (k === 'Space' ? t('playerKeys.keySpace') : k === 'Shift' ? t('playerKeys.keyShift') : k);
  return (
    <DialogShell open onClose={onClose} title={t('playerKeys.title')} sub={t('playerKeys.sub')} width={480} className="kbs">
      <dl className="kbs__list">
        {PLAYER_SHORTCUTS.filter((s) => wide || !s.wideOnly).map((s) => (
          <div className="kbs__row" key={s.label}>
            <dt className="kbs__keys">
              {s.keys.map((k, i) => (
                <Fragment key={`${k}-${i}`}>
                  {i > 0 && <span className="kbs__sep" aria-hidden="true">{s.combo ? '+' : ''}</span>}
                  {k === '…' ? <span className="kbs__sep">…</span> : <kbd className="kbs__kbd">{keyName(k)}</kbd>}
                </Fragment>
              ))}
            </dt>
            <dd className="kbs__what">{t(s.label)}</dd>
          </div>
        ))}
      </dl>
    </DialogShell>
  );
}
