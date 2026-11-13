import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { fetchProfile } from '../../utils/profileMeta';
import { reconcileAvatarOverride } from '../../utils/avatarCache';
import ProfileFields, { useProfileEditor } from './ProfileFields';
import { Button, Dialog } from '../v2/ui';
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
  fineprint = null,
}) {
  const { t } = useTranslation();
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

  if (!open) return null;

  const submit = async () => {
    const ok = await save(t('app.profileEdit.updated'));
    if (ok) {
      if (onSaved) onSaved(form);
      if (onClose) onClose();
    }
  };

  // The shared v2 dialog: Escape, the X and a click outside all close it,
  // except while a save is on its way.
  return (
    <Dialog
      open
      onClose={onClose}
      dismissible={!saving && !!onClose}
      title={t('app.profileEdit.title')}
      sub={t('app.profileEdit.subtitle')}
      closeLabel={t('common.actions.close')}
      width={560}
      className="welcome-modal profile-edit-modal"
      footer={(
        <>
          <Button variant="secondary" className="welcome-skip" onClick={() => onClose && onClose()} disabled={saving}>
            {t('common.actions.cancel')}
          </Button>
          <Button
            variant="primary"
            className="welcome-primary"
            onClick={submit}
            disabled={saving || uploading || loading}
            loading={saving}
          >
            {saving ? t('common.actions.saving') : t('app.profileEdit.saveChanges')}
          </Button>
        </>
      )}
    >
      {loading ? (
        <p className="welcome-loading">{t('app.profileEdit.loading')}</p>
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

      <p className="welcome-fineprint">{fineprint ?? t('app.profileEdit.fineprint')}</p>
    </Dialog>
  );
}
