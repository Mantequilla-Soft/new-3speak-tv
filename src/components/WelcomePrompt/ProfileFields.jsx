import { useCallback, useRef, useState } from 'react';
import { useTranslation, Trans } from 'react-i18next';
import { toastIn } from '../../utils/toast';
import { Camera, MapPin, Loader2 } from 'lucide-react';
import { saveProfileToHive } from '../../utils/profileMeta';
import { uploadThumbnail } from '../../utils/uploadThumbnail';
import { setAvatarOverride, clearAvatarOverride, useAvatarUrl } from '../../utils/avatarCache';
import defaultCover from '../../assets/image/default-cover.svg';

// Every toast from this module is headed "Profile"; the message becomes the
// line under it. See utils/toast.js.
const toast = toastIn('Profile');

// The profile picture / display name / bio / location block, shared by the
// new-user welcome flow and the "Edit" button on your own profile page.

export const NAME_MAX = 30;
export const ABOUT_MAX = 160;
export const LOCATION_MAX = 30;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
// `website` rides along even where no field shows it: saving REPLACES the stored
// profile, so a field the form does not carry is a field every save would erase.
const EMPTY = { name: '', about: '', location: '', profile_image: '', cover_image: '', website: '' };
const FIELDS = ['name', 'about', 'location', 'profile_image', 'cover_image'];

/**
 * Form state + upload + save for the profile block. `seed` fills it from an
 * already-fetched profile; `save` resolves true on success.
 *
 * `onSave` replaces the Hive broadcast with somewhere else to put it. It exists
 * for users who have no Hive account yet: the form, the upload and the copy are
 * the same for them, only the destination differs, and a second editor would be
 * a second place for these fields to drift.
 */
export function useProfileEditor(username, { onSave = null } = {}) {
  const { t } = useTranslation();
  const [form, setForm] = useState(EMPTY);
  // Kept beside the form rather than inside it: interests are a list on the
  // same metadata document, not a profile text field, and saveProfileToHive
  // treats them separately.
  const [interests, setInterests] = useState([]);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  const seed = useCallback((profile) => {
    setForm({
      name: profile?.name || '',
      about: profile?.about || '',
      location: profile?.location || '',
      profile_image: profile?.profile_image || '',
      cover_image: profile?.cover_image || '',
      website: profile?.website || '',
    });
  }, []);

  const toggleInterest = useCallback((id) => {
    setInterests((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  }, []);

  const setField = useCallback(
    (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value })),
    [],
  );

  // `field` is 'profile_image' or 'cover_image' — same upload path, different slot.
  const pickImage = useCallback((field = 'profile_image') => async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast.error(t('app.profileFields.chooseImage'));
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      toast.error(t('app.profileFields.imageTooLarge'));
      return;
    }
    setUploading(true);
    try {
      // preferStatic: delegated logins (ButrAuth, HiveSigner) can't sign the
      // hive.blog challenge client-side, so skip that fallback.
      const url = await uploadThumbnail(file, username, { preferStatic: true });
      setForm((f) => ({ ...f, [field]: url }));
    } catch (err) {
      toast.error(err?.message || t('app.profileFields.uploadFailed'));
    } finally {
      setUploading(false);
    }
  }, [username, t]);

  const hasAnything = FIELDS.some((k) => String(form[k] || '').trim());

  const save = useCallback(async (successMessage = null) => {
    if (!onSave && !username) return false;
    setSaving(true);
    try {
      if (onSave) {
        await onSave(form);
      } else {
        // One broadcast for both: interests live in the same metadata document.
        await saveProfileToHive(username, form, { interests });
        // Render the picture we just uploaded straight away: the hive avatar
        // proxy would keep serving the old one for a while. Only for the Hive
        // path — the override is keyed by account name, and a handle is not one.
        if (form.profile_image) setAvatarOverride(username, form.profile_image);
        else clearAvatarOverride(username);
      }
      toast.success(successMessage ?? t('app.profileFields.saved'));
      return true;
    } catch (e) {
      toast.error(e?.message || t('app.profileFields.saveFailed'));
      return false;
    } finally {
      setSaving(false);
    }
  }, [username, form, interests, onSave, t]);

  return {
    form, seed, setForm, setField, pickImage, uploading, saving, hasAnything, save,
    interests, setInterests, toggleInterest,
  };
}

export default function ProfileFields({ username, form, setField, pickImage, uploading, saving }) {
  const { t } = useTranslation();
  const fileRef = useRef(null);
  const coverRef = useRef(null);
  // useAvatarUrl answers a null account with the 3Speak mark, so someone with
  // no Hive account gets a sane picture here without a special case.
  const currentAvatar = useAvatarUrl(username, null);
  const avatar = form.profile_image || currentAvatar;
  const cover = form.cover_image || defaultCover;

  return (
    <>
      {/* Banner first: it's the biggest thing on a profile, so it reads as the
          headline choice rather than an afterthought below the text fields. */}
      <div className="welcome-cover-row">
        <button
          type="button"
          className="welcome-cover"
          onClick={() => coverRef.current && coverRef.current.click()}
          disabled={uploading || saving}
          aria-label={t('app.profileFields.uploadBanner')}
          style={{ backgroundImage: `url(${cover})` }}
        >
          <span className="welcome-cover-action">
            {uploading ? <Loader2 size={15} className="welcome-spin" /> : <Camera size={15} />}
            {form.cover_image ? t('app.profileFields.changeBanner') : t('app.profileFields.addBanner')}
          </span>
        </button>
        <span className="welcome-cover-hint">
          <Trans i18nKey="app.profileFields.bannerHint" components={{ b: <strong /> }} />
        </span>
        <input
          ref={coverRef}
          type="file"
          accept="image/*"
          onChange={pickImage('cover_image')}
          style={{ display: 'none' }}
        />
      </div>

      <div className="welcome-avatar-row">
        <button
          type="button"
          className="welcome-avatar"
          onClick={() => fileRef.current && fileRef.current.click()}
          disabled={uploading || saving}
          aria-label={t('app.profileFields.uploadPicture')}
        >
          <img src={avatar} alt="" onError={(e) => { e.target.style.visibility = 'hidden'; }} />
          <span className="welcome-avatar-badge">
            {uploading ? <Loader2 size={15} className="welcome-spin" /> : <Camera size={15} />}
          </span>
        </button>
        <div className="welcome-avatar-text">
          <strong>{t('app.profileFields.pictureLabel')}</strong>
          <span>
            {uploading
              ? t('app.welcome.uploading')
              : t('app.profileFields.pictureHint')}
          </span>
        </div>
        <input ref={fileRef} type="file" accept="image/*" onChange={pickImage('profile_image')} style={{ display: 'none' }} />
      </div>

      <label className="welcome-field">
        <span className="welcome-label">{t('app.profileFields.displayName')}</span>
        <input
          type="text"
          value={form.name}
          onChange={setField('name')}
          maxLength={NAME_MAX}
          // A warm-up user has no Hive name yet, so there is no @name to show.
          placeholder={username ? t('app.profileFields.namePlaceholderUser', { username }) : t('app.profileFields.namePlaceholder')}
          disabled={saving}
        />
      </label>

      <label className="welcome-field">
        <span className="welcome-label">
          {t('app.profileFields.shortBio')}
          <em>{form.about.length}/{ABOUT_MAX}</em>
        </span>
        <textarea
          rows={3}
          value={form.about}
          onChange={setField('about')}
          maxLength={ABOUT_MAX}
          placeholder={t('app.profileFields.bioPlaceholder')}
          disabled={saving}
        />
      </label>

      <label className="welcome-field">
        <span className="welcome-label">{t('app.profileFields.location')} <em>{t('app.profileFields.optional')}</em></span>
        <div className="welcome-input-icon">
          <MapPin size={15} />
          <input
            type="text"
            value={form.location}
            onChange={setField('location')}
            maxLength={LOCATION_MAX}
            placeholder={t('app.profileFields.locationPlaceholder')}
            disabled={saving}
          />
        </div>
      </label>
    </>
  );
}
