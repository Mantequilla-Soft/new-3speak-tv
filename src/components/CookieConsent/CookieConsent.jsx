/**
 * Cookie / storage consent banner.
 *
 * Written to be honest rather than to farm clicks. The copy is driven by
 * ENABLE_THIRDPARTY_ADS so it cannot claim one thing while the site does another:
 * with the flag off there genuinely is no advertising and the banner says so; with
 * it on the claim disappears and advertising becomes its own opt-in, defaulted off.
 * That coupling is the point. A hand-edited banner is a banner that goes stale the
 * first time someone ships a tag in a hurry.
 *
 * Every optional category is off until chosen, and refusing is exactly as easy as
 * accepting (same size, same weight, all solid fills). A pre-selected, prettier
 * Accept next to a buried Decline is precisely the dark pattern regulators go after.
 *
 * Not shown at all once answered. The answer itself is the one thing we must store
 * to honour it — that storage is consent-exempt, and necessarily so: you cannot
 * remember "no" without writing down "no".
 */
import { useEffect, useState } from 'react';
import { useTranslation, Trans } from 'react-i18next';
import { hasDecided, setConsent } from '../../lib/consent';
import { notifyAdConsentChanged, subscribeToCmp } from '../../lib/thirdPartyAds';
import { ENABLE_THIRDPARTY_ADS } from '../../utils/config';
import './CookieConsent.scss';

export default function CookieConsent() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [details, setDetails] = useState(false);
  // Both start off. Nothing optional is ever pre-ticked.
  const [functionalOn, setFunctionalOn] = useState(false);
  const [advertisingOn, setAdvertisingOn] = useState(false);

  useEffect(() => {
    // If a TCF CMP is on the page, start listening now: its answer feeds the same
    // gate the banner does, and the ad loader stays shut until it arrives.
    subscribeToCmp();
    // Defer a tick so it doesn't fight the first paint.
    const timer = setTimeout(() => setOpen(!hasDecided()), 600);
    return () => clearTimeout(timer);
  }, []);

  if (!open) return null;

  const decide = ({ functional, advertising }) => {
    setConsent({ functional, advertising });
    notifyAdConsentChanged();
    setOpen(false);
  };

  return (
    <div className="cookie-consent" role="dialog" aria-live="polite" aria-label={t('consent.ariaLabel')}>
      <div className="cookie-consent-inner">
        <div className="cookie-consent-text">
          <h4>{t('consent.title')}</h4>

          {ENABLE_THIRDPARTY_ADS ? (
            <>
              <p>{t('consent.withAds.intro')}</p>
              <p>
                <Trans i18nKey="consent.withAds.advertising" components={{ b: <strong /> }} />
              </p>
            </>
          ) : (
            <>
              <p>
                <Trans i18nKey="consent.noAds.intro" components={{ b: <strong /> }} />
              </p>
              <p>
                <Trans i18nKey="consent.noAds.optional" components={{ b: <strong /> }} />
              </p>
            </>
          )}

          {details && (
            <div className="cookie-consent-details">
              <div className="cookie-consent-cat">
                <span className="cookie-consent-cat-title">{t('consent.details.essentialTitle')}</span>
                <ul>
                  <li>{t('consent.details.essential.login')}</li>
                  <li>{t('consent.details.essential.settings')}</li>
                  <li>{t('consent.details.essential.uploads')}</li>
                  <li>{t('consent.details.essential.offline')}</li>
                  <li>{t('consent.details.essential.answer')}</li>
                </ul>
              </div>
              <div className="cookie-consent-cat">
                <span className="cookie-consent-cat-title">{t('consent.details.optionalTitle')}</span>
                <ul>
                  <li>{t('consent.details.optional.playback')}</li>
                  {ENABLE_THIRDPARTY_ADS && (
                    <li>{t('consent.details.optional.advertising')}</li>
                  )}
                </ul>
              </div>
              <p className="cookie-consent-note">
                {ENABLE_THIRDPARTY_ADS
                  ? t('consent.details.noteWithAds')
                  : t('consent.details.noteNoAds')}
              </p>
            </div>
          )}

          {/* Granular toggles only exist once there is more than one optional thing to
              weigh. With ads off the single choice is carried by the buttons alone,
              exactly as before. */}
          {ENABLE_THIRDPARTY_ADS && (
            <div className="cookie-consent-toggles">
              <label className="cookie-consent-toggle">
                <input
                  type="checkbox"
                  checked={functionalOn}
                  onChange={(e) => setFunctionalOn(e.target.checked)}
                />
                <span>
                  <strong>{t('consent.toggles.resumeTitle')}</strong>
                  {t('consent.toggles.resumeDesc')}
                </span>
              </label>
              <label className="cookie-consent-toggle">
                <input
                  type="checkbox"
                  checked={advertisingOn}
                  onChange={(e) => setAdvertisingOn(e.target.checked)}
                />
                <span>
                  <strong>{t('consent.toggles.advertisingTitle')}</strong>
                  {t('consent.toggles.advertisingDesc')}
                </span>
              </label>
            </div>
          )}

          <button
            type="button"
            className="cookie-consent-link"
            onClick={() => setDetails((d) => !d)}
          >
            {details ? t('consent.hideDetails') : t('consent.whatIsStored')}
          </button>
        </div>

        <div className={`cookie-consent-actions${ENABLE_THIRDPARTY_ADS ? ' three-up' : ''}`}>
          <button
            type="button"
            className="cookie-consent-btn secondary"
            onClick={() => decide({ functional: false, advertising: false })}
          >
            {t('consent.essentialOnly')}
          </button>
          {ENABLE_THIRDPARTY_ADS && (
            <button
              type="button"
              className="cookie-consent-btn secondary"
              onClick={() => decide({ functional: functionalOn, advertising: advertisingOn })}
            >
              {t('consent.saveChoices')}
            </button>
          )}
          <button
            type="button"
            className="cookie-consent-btn primary"
            onClick={() => decide({ functional: true, advertising: ENABLE_THIRDPARTY_ADS })}
          >
            {ENABLE_THIRDPARTY_ADS ? t('consent.acceptAll') : t('common.actions.accept')}
          </button>
        </div>
      </div>
    </div>
  );
}
