import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog, Button, Field, Segmented } from '../v2/ui';
import HiveAvatar from '../HiveAvatar/HiveAvatar';
import { getHiveClient } from '../../utils/hiveNode';
import { isAccountValid } from '../../hive-api/api';
import { COLLAB_SPLITS, COLLAB_SPLIT_DEFAULT } from '../../lib/collabs';
import './CollabModal.scss';

const NAME_RE = /^[a-z][a-z0-9.-]{2,15}$/;

/**
 * "Add a collaborator" on the upload's details step (lib/collabs.js): a Hive
 * account (typed, with suggestions from Hive's account list) and their share of
 * what the creator keeps after the other beneficiaries, 50 % by default. The
 * collaborator gets an invite to accept; until then the post shows only the
 * creator. Saves `{ account, split }` through `onSave`, or null with Remove.
 *
 * `creatorPercent` is the creator's own share right now (100 minus the
 * beneficiaries in the list), for the preview line.
 */
export default function CollabModal({ open, onClose, value, onSave, user, creatorPercent = 100 }) {
  const { t } = useTranslation();
  const [account, setAccount] = useState(value?.account || '');
  const [split, setSplit] = useState(value?.split || COLLAB_SPLIT_DEFAULT);
  const [suggestions, setSuggestions] = useState([]);
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(false);
  // The account picked from the suggestions (or the one being edited): shown
  // as its avatar and name in place of the field, with no more suggestions.
  const [picked, setPicked] = useState(value?.account || '');

  useEffect(() => {
    if (!open) return;
    setAccount(value?.account || '');
    setPicked(value?.account || '');
    setSplit(value?.split || COLLAB_SPLIT_DEFAULT);
    setError('');
  }, [open, value]);

  const name = account.trim().toLowerCase().replace(/^@/, '');
  const chosen = !!picked && picked === name;

  // Suggestions from Hive's account list as the name is typed.
  useEffect(() => {
    if (!open || name.length < 2 || chosen) { setSuggestions([]); return undefined; }
    let alive = true;
    const timer = setTimeout(async () => {
      try {
        const list = await getHiveClient().call('condenser_api', 'lookup_accounts', [name, 6]);
        if (alive) setSuggestions((Array.isArray(list) ? list : []).filter((a) => a !== user && a !== name));
      } catch {
        if (alive) setSuggestions([]);
      }
    }, 250);
    return () => { alive = false; clearTimeout(timer); };
  }, [name, open, user, chosen]);

  const share = Math.round(creatorPercent * split) / 100;

  const save = async () => {
    if (!NAME_RE.test(name)) { setError(t('social.collab.errors.invalid')); return; }
    if (name === user) { setError(t('social.collab.errors.self')); return; }
    setChecking(true);
    const exists = await isAccountValid(name);
    setChecking(false);
    if (!exists) { setError(t('social.collab.errors.notFound', { user: name })); return; }
    onSave({ account: name, split });
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('social.collab.modalTitle')}
      sub={t('social.collab.modalSub')}
      tone="cyan"
      closeLabel={t('common.actions.close')}
      footer={(
        <div className="collab-modal__foot">
          {value?.account && (
            <Button variant="secondary" size={48} onClick={() => { onSave(null); onClose(); }}>
              {t('social.collab.remove')}
            </Button>
          )}
          <Button variant="inverse" size={48} trailing="check" onClick={save} loading={checking} disabled={!name || checking}>
            {t('social.collab.save')}
          </Button>
        </div>
      )}
    >
      <div className="collab-modal">
        {chosen ? (
          <div className="collab-modal__chosen">
            <span className="v2-eyebrow">{t('social.collab.accountLabel')}</span>
            <div className="collab-modal__chosen-row">
              <HiveAvatar username={name} size="small" alt="" badgeSize={0} />
              <b>@{name}</b>
              <Button variant="ghost" size={32} icon="edit" onClick={() => setPicked('')}>{t('common.actions.edit')}</Button>
            </div>
            {error && <p className="collab-modal__error" role="alert">{error}</p>}
          </div>
        ) : (
        <Field
          label={t('social.collab.accountLabel')}
          placeholder={t('social.collab.accountPlaceholder')}
          value={account}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          error={error || undefined}
          onChange={(e) => { setAccount(e.target.value); setError(''); }}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); save(); } }}
        />
        )}
        {!chosen && suggestions.length > 0 && (
          <ul className="collab-modal__suggest" aria-label={t('social.collab.suggestions')}>
            {suggestions.map((s) => (
              <li key={s}>
                <button type="button" onClick={() => { setAccount(s); setPicked(s); setSuggestions([]); setError(''); }}>
                  <HiveAvatar username={s} size="small" alt="" badgeSize={0} />
                  <span>@{s}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="collab-modal__split">
          <span className="v2-eyebrow">{t('social.collab.splitLabel')}</span>
          <Segmented
            label={t('social.collab.splitLabel')}
            value={split}
            onChange={setSplit}
            options={COLLAB_SPLITS.map((p) => ({ value: p, label: `${p}%` }))}
          />
          <p className="collab-modal__note">
            {t('social.collab.splitPreview', { user: name || t('social.collab.someone'), share, mine: Math.round((creatorPercent - share) * 100) / 100 })}
          </p>
        </div>
        <p className="collab-modal__note">{t('social.collab.inviteNote')}</p>
      </div>
    </Dialog>
  );
}
