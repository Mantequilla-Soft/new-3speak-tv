import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { useTranslation } from 'react-i18next';
import { toastIn } from '../../utils/toast';
import './GuestListEditor.scss';

// Every toast from this module is headed "Gated video"; the message becomes the
// line under it. See utils/toast.js.
const toast = toastIn('Gated video');

const HIVE_USER_RE = /^[a-z][a-z0-9.-]{2,15}$/;

/**
 * 🔐 Manage who may watch a supporters-only video without 3Speak Pro.
 *
 * Rendered only for the creator of a gated video. Everything here is a
 * convenience wrapper around one authenticated endpoint: the API re-checks
 * ownership server-side on every call, so hiding or faking this UI grants
 * nobody anything.
 *
 * The list lives on our servers, never in the Hive post, so the names are not
 * published on-chain. The copy says so, because a creator inviting people to a
 * private video deserves to know where that list ends up.
 */
export default function GuestListEditor({ permlink }) {
  const { t } = useTranslation();
  const [guests, setGuests] = useState([]);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [registered, setRegistered] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    axios
      .get(`/api/gated/${encodeURIComponent(permlink)}/allowlist`, { withCredentials: true })
      .then(({ data }) => {
        if (cancelled) return;
        setGuests(data?.allowlist || []);
        setRegistered(data?.registered !== false);
      })
      .catch(() => {
        // Not fatal: the editor still works, it just starts from an unknown
        // state, and saving replaces the list wholesale anyway.
        if (!cancelled) toast.error(t('engagement.guestList.loadFailed'));
      })
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [permlink, t]);

  const save = async (next) => {
    setSaving(true);
    try {
      const { data } = await axios.patch(
        `/api/gated/${encodeURIComponent(permlink)}/allowlist`,
        { allowlist: next },
        { withCredentials: true },
      );
      setGuests(data?.allowlist ?? next);
      toast.success(next.length ? t('engagement.guestList.saved', { count: next.length }) : t('engagement.guestList.cleared'));
    } catch (err) {
      // Show the server's reason: it knows things the client does not, like the
      // video not being registered with the gate yet.
      toast.error(err?.response?.data?.error || t('engagement.guestList.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const addNames = () => {
    const names = draft
      .split(/[\s,]+/)
      .map((n) => n.trim().toLowerCase().replace(/^@/, ''))
      .filter(Boolean);
    const valid = names.filter((n) => HIVE_USER_RE.test(n));
    const rejected = names.filter((n) => !valid.includes(n));
    if (rejected.length) toast.error(t('engagement.guestList.invalidAccounts', { names: rejected.join(', ') }));
    if (!valid.length) return;

    const next = [...new Set([...guests, ...valid])];
    setDraft('');
    save(next);
  };

  const remove = (name) => save(guests.filter((n) => n !== name));

  return (
    <div className="guest-list-editor">
      <div className="guest-list-editor__head">
        <span className="guest-list-editor__title">{t('engagement.guestList.title')}</span>
        <span className="guest-list-editor__hint">
          {t('engagement.guestList.hint')}
        </span>
      </div>

      {!registered && (
        <p className="guest-list-editor__warn">
          {t('engagement.guestList.notRegistered')}
        </p>
      )}

      <div className="guest-list-editor__row">
        <input
          type="text"
          value={draft}
          placeholder={t('engagement.guestList.placeholder')}
          disabled={loading || saving}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addNames(); } }}
        />
        <button type="button" onClick={addNames} disabled={loading || saving || !draft.trim()}>
          {saving ? t('common.actions.saving') : t('common.actions.add')}
        </button>
      </div>

      {loading ? (
        <p className="guest-list-editor__empty">{t('common.status.loading')}</p>
      ) : guests.length === 0 ? (
        <p className="guest-list-editor__empty">{t('engagement.guestList.empty')}</p>
      ) : (
        <div className="guest-list-editor__chips">
          {guests.map((name) => (
            <span className="guest-list-editor__chip" key={name}>
              @{name}
              <button type="button" aria-label={t('engagement.guestList.removeAria', { name })} disabled={saving} onClick={() => remove(name)}>×</button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
