import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { fetchProfile } from '../../utils/profileMeta';
import { reconcileAvatarOverride } from '../../utils/avatarCache';
import ProfileFields, { useProfileEditor } from './ProfileFields';
import './WelcomePrompt.scss';

/**
 * "Edit" on your own profile page: the same picture / name / bio / location
 * form the welcome flow uses, on its own. Controlled by the caller.
 *
 * `onSaved` fires after a successful broadcast so the page can refresh whatever
 * it renders from the profile.
 */
export default function ProfileEditModal({
  open, username, onClose, onSaved,
  // Where the profile comes from and goes to. Both default to Hive; an
  // incubating user has no Hive account, so they pass their own pair and get
  // the same form rather than a second one built to drift from this.
  loadProfile = null,
  onSave = null,
  fineprint = 'Saved to your Hive account, so every Hive app shows the same profile.',
}) {
  const { form, seed, setField, pickImage, uploading, saving, save } = useProfileEditor(username, { onSave });
  const [loading, setLoading] = useState(false);

  // Load the current profile every time it opens, so the form always reflects
  // what is on chain right now rather than a stale copy from a previous open.
  useEffect(() => {
    if (!open) return undefined;
    if (!loadProfile && !username) return undefined;
    let alive = true;
    setLoading(true);
    (async () => {
      const profile = loadProfile ? await loadProfile() : await fetchProfile(username);
      if (!alive) return;
      if (profile) {
        // Only meaningful for the Hive path: the override is keyed by account
        // name, and there is no account here otherwise.
        if (!loadProfile) reconcileAvatarOverride(username, profile.profile_image);
        seed(profile);
      }
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [open, username, seed, loadProfile]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape' && !saving) onClose && onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, saving, onClose]);

  if (!open) return null;

  const submit = async () => {
    const ok = await save('Profile updated');
    if (ok) {
      if (onSaved) onSaved(form);
      if (onClose) onClose();
    }
  };

  return createPortal(
    <div
      className="welcome-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Edit your profile"
      onClick={() => { if (!saving && onClose) onClose(); }}
    >
      <div className="welcome-modal" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          className="welcome-close"
          onClick={() => onClose && onClose()}
          disabled={saving}
          aria-label="Close"
        >
          <X size={18} />
        </button>

        <div className="welcome-head">
          <h2>Edit your profile</h2>
          <p>
            Your picture, name and bio show on your profile and next to everything you post.
          </p>
        </div>

        {loading ? (
          <p className="welcome-loading">Loading your profile…</p>
        ) : (
          <ProfileFields
            username={username}
            form={form}
            setField={setField}
            pickImage={pickImage}
            uploading={uploading}
            saving={saving}
          />
        )}

        <p className="welcome-fineprint">{fineprint}</p>

        <div className="welcome-actions">
          <button type="button" className="welcome-skip" onClick={() => onClose && onClose()} disabled={saving}>
            Cancel
          </button>
          <button
            type="button"
            className="welcome-primary"
            onClick={submit}
            disabled={saving || uploading || loading}
          >
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
