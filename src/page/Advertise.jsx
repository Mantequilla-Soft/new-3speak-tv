import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation, Trans } from 'react-i18next';
import { MdCampaign, MdInfoOutline, MdCheckCircle, MdSchedule, MdCancel } from 'react-icons/md';
import { FaRocket, FaLayerGroup, FaUsers, FaVideo, FaTv } from 'react-icons/fa';
import { toastIn } from '../utils/toast';
import { useAppStore } from '../lib/store';
import { transferWithAioha, getOperationUser } from '../hive-api/aioha';
import { adsEnabledFor, tickerEnabledFor, ENABLE_BUTRAUTH } from '../utils/config';
import SEOHead from '../components/SEOHead';
import NotFound from './NotFound';
import AdOverlay from '../components/ads/AdOverlay';
import TickerCrawl from '../components/ads/TickerCrawl';
import FundsNotice from '../components/ads/FundsNotice';
import { fetchBalances } from '../hive-api/api';
import {
  AD_CATEGORIES,
  fetchInventory,
  submitApplication,
  fetchApplication,
  fetchMyApplications,
  rememberReference,
  rememberedReferences,
  rememberWizard,
  readWizard,
  clearWizard,
  discardProduct,
  uploadCreative,
  uploadImageAsset,
  uploadLogo,
  saveBranding,
  SLOGAN_MAX,
  fetchCreatives,
  saveTickerCreative,
  fetchPricing,
  createCampaign,
  fetchCampaigns,
  fetchSlots,
  claimCampaign,
  attachCreative,
  BLOCKED_REASON,
  readVideoDuration,
  formatCount,
  slotLabel,
  countryName,
} from '../lib/advertiseData';
import { InventoryPanel, RateCard } from '../components/ads/AdMarketPanels';
import {
  SHOW_MARKETS,
  SITE_ONLY_SURFACES,
  EXAMPLE_SECONDS,
  EXAMPLE_DAYS,
  flightPrice,
  hivePayable,
  hiveEquivalent,
  youSupply,
  bannerAdvice,
  savingAt,
  groupByFormat,
  tickerMinSeconds,
} from '../lib/adMarket';
import './Advertise.scss';

// Every toast from this module is headed "Advertising"; the message becomes the
// line under it. See utils/toast.js.
const toast = toastIn('Advertising');

// The inventory forecast only moves every few hours, so a long stale time keeps
// the page instant on revisit without ever showing a number the backend disowns.
const INVENTORY_STALE_MS = 10 * 60 * 1000;

/** The enrollment steps, in the order they have to happen. */
const WIZARD_STEPS = ['ads.wizardSteps.product', 'ads.wizardSteps.ad', 'ads.wizardSteps.book']; // i18n keys

/* Booking, for a product that already exists. Same three things the enrollment
   wizard ends on, minus registering the product itself. */
const BOOK_STEPS = ['ads.bookSteps.ad', 'ads.bookSteps.booking', 'ads.bookSteps.pay']; // i18n keys

const EMPTY_FORM = {
  projectName: '',
  website: '',
  contact: '',
  category: '',
  budgetHbd: '',
  markets: [],
  creativeConcept: '',
  // "Have us make the video for you", asked here rather than only at booking —
  // most applicants have no spot yet, and that changes what we are approving.
  wantProduction: false,
  productionBrief: '',
};

/**
 * Pick what you are buying, before anything else on the form.
 *
 * The three products differ in price, in maximum length, in what you have to supply
 * and in whether a position is even a thing you choose — so the type has to be
 * settled first and the rest of the form follows from it. Showing every field for
 * every format and letting the server refuse the wrong combinations was the version
 * this replaces.
 *
 * Rendered from whatever the rate card returns rather than a list held here, so a
 * format added on the server appears without a frontend change.
 */
function FormatPicker({ formats, value, onChange }) {
  const { t } = useTranslation();
  if (!formats?.length) return null;
  return (
    <fieldset className="mkt-group mkt-formats">
      <legend>{t('ads.form.whatBuying')}</legend>
      <div className="mkt-format-list" role="radiogroup" aria-label={t('ads.form.adType')}>
        {formats.map((f) => {
          const on = f.key === value;
          return (
            <button
              type="button"
              key={f.key}
              role="radio"
              aria-checked={on}
              className={`mkt-format${on ? ' is-on' : ''}`}
              onClick={() => onChange(f.key)}
            >
              <span className="mkt-format-head">
                <span className="mkt-format-name">{f.label}</span>
                <span className="mkt-format-rate">
                  {f.ratePerSecondDayHbd} HBD
                  <span className="mkt-format-rate-unit">{t('ads.rateCard.perSecDay')}</span>
                </span>
              </span>
              <span className="mkt-format-blurb">{f.blurb}</span>
              <span className="mkt-format-meta">
                {youSupply(f)}
                {t('ads.form.upToSeconds', { seconds: f.maxSeconds })}
                {/* Said at the point of CHOOSING, not only in the rate card below it.
                    Reach is part of what separates these formats, and a difference an
                    advertiser only meets after picking is one they meet too late. */}
                {SITE_ONLY_SURFACES.has(f.surface) ? t('ads.form.siteOnlySuffix') : null}
                {f.rateIsCustom ? t('ads.form.agreedRateSuffix') : null}
              </span>
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

/**
 * The same total expressed in HIVE, or null when we cannot say.
 *
 * Shown ONLY on totals, never on the per-second rate: the rate card is denominated
 * in HBD, and a second price on every line would read as two rate cards. A total is
 * the number an advertiser actually has to send, so that is where naming the other
 * asset earns its place.
 *
 * `hbdPerHive` is the on-chain median, the same figure the claim uses to value an
 * incoming HIVE transfer, so what is quoted here is what would actually be credited.
 * It moves, hence "about".
 */
/**
 * A seconds field read back in minutes.
 *
 * Video length is entered in seconds because that is what the server filters on, but
 * nobody thinks about a ten minute video as 600. Shown alongside rather than replacing
 * the input: converting the field itself would make "601" impossible to type.
 */
function inMinutes(raw, t) {
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return null;
  const mins = Math.floor(n / 60);
  const secs = n % 60;
  if (!mins) return t('ads.units.sec', { secs });
  return secs ? t('ads.units.minSec', { mins, secs }) : t('ads.units.min', { mins });
}

/**
 * The HIVE to actually SEND for an HBD price.
 *
 * Rounds UP, unlike hiveEquivalent() which rounds to the nearest and is for display.
 * The server credits a HIVE payment at `amount * hbdPerHive` using the rate at CLAIM
 * time, so an amount converted at the rate we quoted and rounded down can land a
 * thousandth short and leave the flight unpaid for no reason anyone can see.
 */
/**
 * Copy one value to the clipboard.
 *
 * The memo is the field that has to be exact: an account or an amount that is wrong
 * gets noticed, a mistyped memo produces a payment nobody can match to a booking and a
 * support conversation to untangle it.
 *
 * Falls back silently. The clipboard API needs a secure context and can be refused
 * outright, and the value is on screen either way, so a refusal is not worth an error.
 */
function CopyButton({ value }) {
  const { t } = useTranslation();
  const [done, setDone] = useState(false);
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <button
      type="button"
      className={`mkt-copy${done ? ' done' : ''}`}
      title={t('ads.pay.copyMemo')}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(String(value));
          setDone(true);
          clearTimeout(timer.current);
          timer.current = setTimeout(() => setDone(false), 1500);
        } catch {
          // Nothing to say: the memo is right there to select.
        }
      }}
    >
      {done ? t('common.actions.copied') : t('common.actions.copy')}
    </button>
  );
}

function StatusBadge({ status }) {
  const { t } = useTranslation();
  const map = {
    pending: { Icon: MdSchedule, label: t('ads.status.underReview') },
    approved: { Icon: MdCheckCircle, label: t('ads.status.approved') },
    rejected: { Icon: MdCancel, label: t('ads.status.notAccepted') },
  };
  const { Icon, label } = map[status] || map.pending;
  return (
    <span className={`mkt-status mkt-status-${status}`}>
      <Icon aria-hidden="true" /> {label}
    </span>
  );
}

/**
 * Book a flight, pay for it, and see what ran.
 *
 * Payment is a plain Hive transfer with a memo — no wallet integration, no
 * redirect, nothing to break. The advertiser sends it from wherever they keep their
 * HBD and presses check; the server reads the payment account's own history and
 * matches the memo, so nothing about the money is taken on trust from this page.
 */
// A shorts spot and a video roll are both VIDEO ads — they differ in shape and in
// where they run, not in what the advertiser uploads. Every "is this a video?" branch
// has to agree, or the shorts flow silently offers an image picker.
const isVideoAd = (t) => t === 'video' || t === 'shorts' || t === 'upload';

/* Which product an ad TYPE books. Module-level so the wizard and a product's own
   "Book a spot" agree on it. */
const AD_TYPE_FORMAT = { video: 'video_roll', banner: 'video_banner', shorts: 'shorts_roll', ticker: 'video_ticker', upload: 'upload_gate' };
// Types that run a video spot, and so carry the label overlay and the "we make it" offer.
const isSpotType = (t) => t === 'video' || t === 'shorts' || t === 'upload';

/**
 * What "Your ad" still needs before the booking makes sense, as an i18n key, or null when
 * it is complete. Read from the creatives on record, so a rejected one does not count,
 * and for a video spot "have us make it" with a usable brief counts as the video.
 */
function adStepMissing(type, creatives, production) {
  const live = (creatives || []).filter((c) => c.status !== 'rejected');
  const has = (...kinds) => live.some((c) => kinds.includes(c.kind || 'video'));
  if (type === 'ticker') return has('text') ? null : 'ads.missing.ticker';
  if (type === 'banner') return has('image', 'video') ? null : 'ads.missing.banner';
  const briefOk = !!production?.wanted && String(production?.brief || '').trim().length >= 20;
  return has('video') || briefOk ? null : 'ads.missing.video';
}

/**
 * "What are you running?" — asked FIRST, because everything after it depends on the
 * answer: a banner has no label overlay and no "we make it" offer, a ticker has no file
 * at all. Showing the video settings to someone booking a banner was the old version.
 *
 * The ticker appears only when the rate card offers it, which it does only for beta
 * testers (the page asks for beta formats only for them).
 */
function AdTypePicker({ value, onChange, pricing }) {
  const { t } = useTranslation();
  const options = [
    {
      id: 'video',
      title: t('ads.adType.video.title'),
      // From the rate card, not typed in: this number moved from 15 to 30 and the two
      // places it had been written by hand did not move with it.
      blurb: pricing?.maxCreativeSeconds
        ? t('ads.adType.video.blurbMax', { seconds: pricing.maxCreativeSeconds })
        : t('ads.adType.video.blurb'),
    },
    { id: 'banner', title: t('ads.adType.banner.title'), blurb: t('ads.adType.banner.blurb') },
    { id: 'shorts', title: t('ads.adType.shorts.title'), blurb: t('ads.adType.shorts.blurb') },
    { id: 'ticker', title: t('ads.adType.ticker.title'), blurb: t('ads.adType.ticker.blurb') },
    { id: 'upload', title: t('ads.adType.upload.title'), blurb: t('ads.adType.upload.blurb') },
  // Only what the rate card offers right now (a beta format only to its testers).
  ].filter((o) => !pricing?.formats?.length || pricing.formats.some((f) => f.key === AD_TYPE_FORMAT[o.id]));
  const name = `mkt-adtype-${useId()}`;
  return (
    <>
      <div className="mkt-field mkt-field-wide mkt-adtype">
        <span className="mkt-label">{t('ads.adType.question')}</span>
        {groupByFormat(options, (o) => AD_TYPE_FORMAT[o.id]).map((g) => (
        <div key={g.id} className="mkt-adtype-group">
        <span className="mkt-adtype-group-title">{t(g.title)}</span>
        <div className="mkt-adtype-row">
          {g.items.map((o) => (
            <label key={o.id} className={`mkt-adtype-opt${value === o.id ? ' selected' : ''}`}>
              <input
                type="radio"
                name={name}
                value={o.id}
                checked={value === o.id}
                onChange={() => onChange(o.id)}
              />
              <span>
                <strong>{o.title}</strong>
                <span className="mkt-hint">{o.blurb}</span>
              </span>
            </label>
          ))}
        </div>
        </div>
        ))}
      </div>
      <p className="mkt-fine">
        {value === 'ticker'
          ? t('ads.adType.hint.ticker')
          : value === 'upload'
            ? t('ads.adType.hint.upload')
          : value === 'banner'
            ? t('ads.adType.hint.banner')
            : (value === 'shorts'
              ? t('ads.adType.hint.shorts')
              : t('ads.adType.hint.video'))}
      </p>
    </>
  );
}

function CampaignPanel({
  reference, pricing, creatives, onNeedCreative, production,
  awaitingApproval = false, lockFormat = null,
  /* Which third of this panel to render. The page shows one at a time so a
     product's page is not one long scroll of form, live flights and finished
     ones. The wizard still asks for 'all', because there it IS the whole step. */
  view = 'all',
  /* Where the booking wizard has got to, when there is one. Step 2 is the form and
     step 3 is paying for what it just created; step 1 is the ad itself, which this
     panel does not own. Null means no wizard, which is the enrollment flow. */
  step = null,
  onBooked,
  // Who the ad is for, for the ticker preview (it shows the avatar and product name).
  account = null,
  productName = null,
}) {
  const { t } = useTranslation();
  const [campaigns, setCampaigns] = useState([]);
  const [days, setDays] = useState(pricing?.minDays || 1);
  // When it should start. Optional: blank means "as soon as it is approved and paid",
  // which is what most people want and what the server already did on its own.
  const [startAt, setStartAt] = useState('');
  // What is being bought. Everything below reads from the chosen format's own
  // record — its rate, its maximum length, whether it has a position at all — so
  // there is no second place where a product's rules are written down.
  const [formatKey, setFormatKey] = useState(null);
  const [slotPct, setSlotPct] = useState(null);
  // Which positions are free for this window. A position is sold exclusively across
  // formats, so the form asks before it offers rather than refusing at submit.
  const [slotState, setSlotState] = useState(null);
  // How long a spot this flight buys. Priced per second, so it is the other half of
  // the total alongside the number of days.
  const [spotSeconds, setSpotSeconds] = useState(null);
  // A position or length picked for one format means nothing for another, so a change
  // of type in "Your ad" starts the booking fresh, as the picker's own onChange does.
  // Reset during render against the last value seen (React's pattern for this), not
  // in an effect, which would paint the stale choice once first.
  const [lockSeen, setLockSeen] = useState(lockFormat);
  if (lockSeen !== lockFormat) {
    setLockSeen(lockFormat);
    setSlotPct(null);
    setSpotSeconds(null);
  }
  // "Make the spot for us" lives up in the spot panel now, where the subject is the
  // video itself — asking "do you have a spot?" underneath Days and Placement put it
  // in the middle of a pricing decision. The fee is still charged HERE, on the
  // flight, so the state is passed down rather than moved.
  const wantProduction = !!production?.wanted;
  const brief = production?.brief || '';
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  // Which creative is PICKED, per flight, before it is committed. Choosing from a
  // dropdown used to attach immediately — a single mis-click bound a creative to a
  // flight with no confirmation and no way back. Picking and saving are two acts.
  const [picked, setPicked] = useState({});
  const [saving, setSaving] = useState(null);
  // The flight this panel just created, so the paying step can show that one alone.
  const [bookedId, setBookedId] = useState(null);

  // Credit carried from earlier flights that under-delivered. Comes back with the
  // campaign list rather than needing its own request, because it is only ever shown
  // next to them.
  const [balanceHbd, setBalanceHbd] = useState(0);

  const refresh = useCallback(() => {
    fetchCampaigns(reference)
      .then((r) => {
        setCampaigns(r.campaigns || []);
        setBalanceHbd(r.balanceHbd || 0);
      })
      .catch(() => { /* an unreadable list is not worth an error banner */ });
  }, [reference]);
  useEffect(() => { refresh(); }, [refresh]);

  /* A spot finishes encoding on its own schedule, and the server only notices on its
   * next sweep. This list was fetched once on mount and never again, so "still
   * encoding" stuck on screen permanently — the upload was done in seconds and the page
   * kept saying otherwise until someone thought to reload.
   *
   * Polls only while something is actually pending and stops the moment nothing is, so
   * an idle advertiser page makes no requests at all. */
  // Only a VIDEO encodes. A still or a ticker never will, and polling for them never stopped.
  const awaitingEncode = creatives.some((c) => (c.kind || 'video') === 'video' && !c.encoded);
  useEffect(() => {
    if (!awaitingEncode) return undefined;
    const timer = setInterval(refresh, 15000);
    return () => clearInterval(timer);
  }, [awaitingEncode, refresh]);

  const formats = pricing?.formats || [];
  // Default to the first format the server offers rather than naming one here: the
  // registry decides what exists and in what order.
  // In the wizard the format was settled in "Your ad": a banner was uploaded, or a
  // video was. Offering the choice again here invites the one combination that
  // cannot work — booking a roll against an image — and the attach would only
  // refuse it later, after they had picked days, length and a slot.
  const offered = lockFormat ? formats.filter((f) => f.key === lockFormat) : formats;
  const fmt = offered.find((f) => f.key === formatKey) || offered[0] || null;

  // Availability is per WINDOW, so it is re-read when the length of the flight
  // changes. Failure is silent and leaves every slot selectable — the server still
  // refuses a taken one, and a broken availability call must not block a booking.
  useEffect(() => {
    // Nothing to clear on the way out: availability is only ever read for a format
    // that HAS a position, so a stale list for an unpositioned one is never seen.
    if (!fmt?.positioned) return undefined;
    let live = true;
    fetchSlots({ days: Number(days), startAt: startAt || undefined, format: fmt?.key })
      .then((r) => { if (live) setSlotState(r.slots || null); })
      .catch(() => { if (live) setSlotState(null); });
    return () => { live = false; };
  }, [days, startAt, fmt?.positioned, fmt?.key]);

  // Mid-roll first, and pre-roll last with its warning: the honest recommendation is
  // not the one with the biggest number on it.
  const slots = useMemo(() => {
    const list = (pricing?.slotPercents || []).slice();
    return list.sort((a, b) => a - b);
  }, [pricing]);
  // Taken slots come from the rate card, matched to the format being booked: a roll
  // at 25% does not consume the banner at 25%, they are different surfaces.
  //
  // The server counts a slot as taken only when an ad is ACTUALLY RUNNING there —
  // approved, paid, in window, creative ready. A slot merely requested by someone
  // still waiting for review stays open, because holding inventory for an advertiser
  // nobody has approved would let anyone reserve the rate card by filling in a form.
  // Burned into the picture rather than spliced before it, which changes what the
  // positions are called and whether pre-roll's warning applies.
  /* ⚠️ A banner is a format that BURNS INTO the picture. It is not "the format whose
   * creative is an image", which is what this asked before a banner could also be a
   * video: every one of these checks would have flipped the moment somebody uploaded
   * a moving banner, and the page would have started calling it a pre-roll. */
  // The ticker is drawn over the picture rather than burned in, but for the booking it
  // behaves like a banner: it interrupts nothing, so 0% is "at the beginning" and the
  // length is time on screen.
  const isTicker = !!fmt?.overlayOnly;
  const isBanner = !!fmt?.burnsIn || isTicker;
  // What this format will actually take. Older checkers send no list, so fall back to
  // the single kind they do send.
  const acceptedKinds = fmt?.creativeKinds?.length ? fmt.creativeKinds : (fmt ? [fmt.creativeKind] : []);
  const takesVideo = acceptedKinds.includes('video');

  const slotRow = (p) => slotState?.find((x) => x.percent === p) || null;
  // FULL, not merely occupied. A position now carries several advertisers at once and
  // rotation splits the plays between them, so one holder is not a closed door — it
  // only changes what this flight would be quoted.
  const slotTaken = (p) => {
    const row = slotRow(p);
    return row ? !row.available : false;
  };
  const sharesLeft = (p) => {
    const row = slotRow(p);
    return row && Number.isFinite(row.sharesLeft) ? row.sharesLeft : null;
  };
  const sharingWith = (p) => {
    const row = slotRow(p);
    return row && Number.isFinite(row.sharesTaken) ? row.sharesTaken : 0;
  };
  // Default to the first slot that is NOT pre-roll, since pre-roll is the one we
  // recommend against — leading with it would be selling against our own advice.
  // Default to the first FREE slot that is not pre-roll. Defaulting to a taken one
  // would show a total for something that cannot be bought.
  const chosenSlot = slotPct
    ?? slots.find((p) => p > 0 && !slotTaken(p))
    ?? slots.find((p) => !slotTaken(p))
    ?? slots.find((p) => p > 0)
    ?? slots[0] ?? 25;

  // The FORMAT's cap, not the platform's — a banner may stay up longer than a spot
  // may run, and quoting one number for both was how the old form read.
  const maxSpot = fmt?.maxSeconds || pricing?.maxCreativeSeconds || 15;
  const minSpot = pricing?.minSpotSeconds || 1;
  /* The spot's own length, taken from the most recent video uploaded to this campaign.
   * The list arrives newest first, and a campaign almost always carries one file, so
   * "the latest video" is the file being booked.
   *
   * Ceil, not round: the video has to FIT inside the length being bought, and buying 8s
   * for an 8.4s spot is buying too little. A format that takes an image has no duration
   * to read, so automatic simply is not offered there.
   *
   * Not clamped to the format's cap on purpose. A 30s file against a 15s format is a
   * real problem the advertiser has to see and fix, and quietly booking 15s would price
   * a spot that cannot run. lengthOk already refuses it, and the hint says why. */
  const spotCandidates = useMemo(() => (
    (creatives || []).filter((c) => c.kind !== 'image' && Number(c.durationSeconds) > 0)
  ), [creatives]);
  /* Exactly one file, or none of this. With two uploaded, "the length of your video" has
     no answer and picking the newest would quietly price against a file the advertiser
     may not have meant. They choose, and the number is theirs to type.
     
     Note this does NOT wait for encoding. The duration is known from the moment the file
     is uploaded and does not change, so gating on the encode would make somebody wait for
     a number we already have. */
  const latestSpotSeconds = spotCandidates.length === 1
    ? Math.ceil(Number(spotCandidates[0].durationSeconds))
    : null;
  /* Automatic length reads the uploaded video's own duration.
   *
   * It now covers banners too, which is the one place the number means something
   * different: for a roll it is how long the spot plays, for a banner it is how long
   * the banner is ON SCREEN. A banner video is played once rather than looped, so it
   * has to be at least as long as the booking, and ticking this is the easy way to
   * guarantee that: it books exactly the length of the video that was uploaded.
   *
   * Keyed on whether a VIDEO was uploaded rather than on the format, so a banner with
   * a still has no length to read and the box stays out of reach, exactly as before. */
  const autoAvailable = latestSpotSeconds != null && takesVideo;
  const tooManySpots = spotCandidates.length > 1 && takesVideo;
  const [autoLength, setAutoLength] = useState(true);

  /* Paying from the wallet, rather than making somebody copy three fields into one.
   *
   * transferWithAioha already routes every login correctly: Keychain, HiveAuth,
   * PeakVault and Ledger sign directly, and a Butter Auth session — which holds no key
   * and cannot sign an active op — goes through ActiveAuthModal, the wallet picker
   * mounted in App.jsx. So there is no provider branching to do here.
   *
   * 🚨 The account matters as much as the amount. A transfer only buys the flight if it
   * comes from the account the campaign is booked under; anything else is refused and
   * returned. Checked before signing, because the alternative is letting someone pay
   * and find out days later. */
  // Per campaign, not one shared value: with two unpaid flights on screen, a single
  // toggle would silently change the currency of the one you are not looking at.
  const [payCcy, setPayCcy] = useState({});
  /* The paying wallet's liquid balance, to PRESELECT the currency: HIVE when it holds
   * enough HIVE for this flight, HBD otherwise. A click still decides. Read once per
   * account; unknown means the old default (HBD). */
  const payer = useAppStore((s) => s.user);
  const [wallet, setWallet] = useState(null);
  useEffect(() => {
    let alive = true;
    if (!payer) return undefined;
    fetchBalances(payer)
      .then((b) => { if (alive && b) setWallet({ account: payer, hive: Number(b.hive) || 0 }); })
      .catch(() => { /* keep HBD as the default */ });
    return () => { alive = false; };
  }, [payer]);
  const ccyFor = useCallback((c, owed) => {
    if (payCcy[c.id]) return payCcy[c.id] === 'HIVE' ? 'HIVE' : 'HBD';
    const inHive = hivePayable(owed, pricing?.hbdPerHive);
    return wallet && wallet.account === payer && inHive != null && wallet.hive >= inHive ? 'HIVE' : 'HBD';
  }, [payCcy, wallet, payer, pricing?.hbdPerHive]);
  const [payBusy, setPayBusy] = useState(null);
  const [payError, setPayError] = useState(null);
  /* Progress while the chain catches up, kept OUT of payError on purpose: that renders
   * in .mkt-upload-error, and telling somebody their payment is being confirmed in red
   * error styling is how you get them to pay twice. */
  const [payWaiting, setPayWaiting] = useState(null);

  const payWithWallet = useCallback(async (c) => {
    const owed = Math.round((c.priceHbd - c.paidHbd) * 1000) / 1000;
    if (!(owed > 0)) return;
    // Same rule the buttons show, so what is highlighted is what gets sent.
    const ccy = ccyFor(c, owed);
    const amount = ccy === 'HIVE' ? hivePayable(owed, pricing?.hbdPerHive) : owed;
    if (amount == null) {
      setPayError(t('ads.pay.noHivePrice'));
      return;
    }
    setPayError(null);
    const signer = getOperationUser();
    if (!signer) {
      setPayError(t('ads.pay.loginAsBooker'));
      return;
    }
    if (c.payFrom && signer.toLowerCase() !== String(c.payFrom).toLowerCase()) {
      setPayError(t('ads.pay.wrongAccount', { payFrom: c.payFrom, signer }));
      return;
    }
    setPayBusy(c.id);
    try {
      await transferWithAioha(c.payTo, amount, ccy, c.memo);
      /* AWAITED, and polled. The wait used to be a bare 4s sleep followed by one
       * unawaited check, so the button un-busied while the claim was still in flight
       * and a slow chain read as a failure. onCheckPayment now waits the transfer out
       * itself, and the button stays busy until there is a real answer. */
      await onCheckPayment(c.id, { afterPay: true });
    } catch (err) {
      // A cancelled signature is not an error worth shouting about, but a failed one is.
      const msg = String(err?.message || err || t('ads.pay.transferFailed'));
      setPayError(/cancel|reject|denied/i.test(msg) ? null : msg);
    } finally {
      setPayBusy(null);
    }
  }, [onCheckPayment, ccyFor, pricing?.hbdPerHive, t]);
  const autoOn = autoLength && autoAvailable;

  /* The ticker message this booking is for: the newest one not turned down. A ticker
   * has no duration of its own, but its message has a readability minimum, so that is
   * the default length (instead of the format's maximum) and the floor the checker
   * holds the attach to. */
  const tickerCreative = isTicker
    ? (creatives || []).find((c) => c.kind === 'text' && c.status !== 'rejected') || null
    : null;
  const tickerNeeds = tickerCreative
    ? (tickerCreative.minSeconds || tickerMinSeconds(tickerCreative.message, fmt?.creativeSpec))
    : null;
  const defaultLength = tickerNeeds ? Math.min(tickerNeeds, maxSpot) : maxSpot;
  const chosenLength = autoOn ? latestSpotSeconds : (spotSeconds ?? defaultLength);
  const tickerTooShort = tickerNeeds != null && Number(chosenLength) < tickerNeeds;
  const lengthOk = Number.isInteger(chosenLength) && chosenLength >= minSpot && chosenLength <= maxSpot
    && !tickerTooShort;
  const autoTooLong = autoOn && chosenLength > maxSpot;

  // Video-length targeting, entered in seconds and open-ended at both ends.
  const [minVideo, setMinVideo] = useState('');
  const [maxVideo, setMaxVideo] = useState('');
  const minVideoNum = parseInt(minVideo, 10);
  const maxVideoNum = parseInt(maxVideo, 10);
  const videoRangeOk = !(Number.isFinite(minVideoNum) && Number.isFinite(maxVideoNum)
    && minVideoNum > maxVideoNum);

  /* The earliest start we accept: TODAY, in the viewer's own timezone.
   *
   * It used to be tomorrow, on the reasoning that a flight has to be approved and paid
   * before it runs. But windowFrom() already begins the clock at the later of now and
   * the requested date, so "today" does not promise anything early: it means start the
   * moment it is approved and paid, which is the thing an advertiser actually wants and
   * is what a blank field has always done. Offering tomorrow as the floor just pushed
   * every same-day booking a day out for no reason.
   *
   * Built from the local date parts on purpose: toISOString is UTC and would offer
   * yesterday to anyone west of it. */
  const earliestISO = useMemo(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }, []);
  // `min` on a date input stops the PICKER, not a typed or pasted value, so the same
  // rule is checked here as well — and again on the server, which is the only copy
  // that actually decides.
  const startOk = !startAt || startAt >= earliestISO;
  // What they actually bought, spelled out. "7 days from the 3rd" is a sum nobody
  // should have to do while deciding whether to buy.
  const runsUntil = useMemo(() => {
    if (!startAt || !Number(days)) return null;
    const end = new Date(`${startAt}T00:00:00`);
    if (Number.isNaN(end.getTime())) return null;
    end.setDate(end.getDate() + Number(days));
    return end.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  }, [startAt, days]);

  const productionFee = wantProduction ? (pricing?.productionFeeHbd || 0) : 0;
  // Must match priceForDays() in 3speakchecks/utils/adModel.js: days x rate x
  // seconds. The quote shown here and the price the server writes have to agree.
  // Must match priceForDays() in 3speakchecks/utils/adModel.js, at the rate for THIS
  // format: days x rate x seconds. The quote shown here and the price the server
  // writes have to agree.
  const rate = fmt ? fmt.ratePerSecondDayHbd : pricing?.pricePerSecondDayHbd;
  const flight = rate != null
    ? flightPrice(days, rate, chosenLength, pricing?.dayCurveK)
    : null;
  const total = flight != null ? Math.round((flight + productionFee) * 1000) / 1000 : null;
  /* What a day of this flight actually costs per second, after the curve. Derived from
   * the quote rather than recomputed, so it can never describe a different number than
   * the one above it. */
  const effectiveDayRate = flight != null && Number(days) > 0 && chosenLength > 0
    ? Math.round((flight / Number(days) / chosenLength) * 10000) / 10000
    : null;
  const daysSaving = savingAt(Number(days), pricing);
  /* The next length worth suggesting, and only while there is a real gain left in it.
   * Past a month the curve has given most of what it has, and a booking form that keeps
   * asking for more is a booking form people stop reading. */
  const nextStep = (() => {
    const d = Number(days);
    const step = [7, 14, 30].find((n) => n > d);
    if (!step) return null;
    const saving = savingAt(step, pricing);
    return saving && saving > (daysSaving || 0) + 2 ? { days: step, saving } : null;
  })();
  const briefTooShort = wantProduction && brief.trim().length < 20;

  async function onBook(e) {
    e.preventDefault();
    if (busy) return;
    setBusy(true); setError(null);
    try {
      const res = await createCampaign({
        reference,
        format: fmt?.key,
        days: Number(days),
        // Omitted entirely for a format with no position: sending one would be a
        // value the advertiser never chose.
        slotPercent: fmt?.positioned ? Number(chosenSlot) : undefined,
        spotSeconds: Number(chosenLength),
        startAt: startAt || undefined,
        minVideoSeconds: Number.isFinite(minVideoNum) && minVideoNum > 0 ? minVideoNum : undefined,
        maxVideoSeconds: Number.isFinite(maxVideoNum) && maxVideoNum > 0 ? maxVideoNum : undefined,
        production: wantProduction ? { requested: true, brief: brief.trim() } : undefined,
      });
      // Credit from an earlier flight that under-delivered is spent at booking, so
      // there may be nothing left to send. Telling someone to pay when they do not
      // have to would send them looking for a payment step that is not there.
      toast.success(res?.payment?.alreadyCovered
        ? t('ads.book.bookedCovered')
        : t('ads.book.bookedPay'));
      refresh();
      if (!creatives.length) onNeedCreative?.();
      if (res?.campaign?.id) {
        setBookedId(res.campaign.id);
        onBooked?.(res.campaign.id);
      }
      return res;
    } catch (err) {
      setError(err.message || t('ads.book.bookFailed'));
    } finally { setBusy(false); }
    return null;
  }

  /* 🚨 POLL FOR THE PAYMENT, DO NOT ASK ONCE.
   *
   * This used to fire a single claim four seconds after the wallet signed, and give up
   * on the first "not found". Four seconds does not cover broadcast, inclusion in a
   * block (3s block time) and the node indexing it into account history. A real payment
   * was missed by TWO SECONDS: the claim asked at 17:30:16 and the transfer landed in a
   * block at 17:30:18. The advertiser was told they had not paid, having just paid.
   *
   * That is the worst failure this page can produce. Money has left their wallet and
   * the screen says it did not arrive, so the rational next move is to pay again.
   *
   * Only a 404 is worth waiting for — it means "no matching transfer yet". Every other
   * status is a real answer (wrong payer, cancelled campaign) and is shown at once
   * rather than after a minute of pointless polling.
   */
  const CLAIM_POLL_MS = [0, 3000, 5000, 8000, 12000, 20000];   // ~48s across 6 tries
  const CLAIM_ONCE_MS = [0, 4000];                              // the manual button

  async function claimWithRetry(id, delays, onWaiting) {
    let last = null;
    for (let i = 0; i < delays.length; i += 1) {
      if (delays[i]) await new Promise((r) => setTimeout(r, delays[i]));
      try {
        return await claimCampaign(id);
      } catch (err) {
        last = err;
        if (err.status !== 404) throw err;   // a real answer, not "not yet"
        onWaiting?.(i + 1, delays.length);
      }
    }
    throw last;
  }

  /**
   * `afterPay` says whether we just watched the wallet sign.
   *
   * If we did, the transfer is definitely coming and it is worth waiting out the chain.
   * If the advertiser pressed "Manually sent", they may have paid an hour ago or not at
   * all, and making them watch a spinner for a minute to be told "no transfer" is worse
   * than answering quickly.
   */
  async function onCheckPayment(id, { afterPay = false } = {}) {
    setError(null);
    setPayError(null);
    setPayWaiting(null);
    try {
      const r = await claimWithRetry(
        id,
        afterPay ? CLAIM_POLL_MS : CLAIM_ONCE_MS,
        (n, of) => setPayWaiting(t('ads.pay.confirming', { n, of })),
      );
      setPayWaiting(null);
      toast.success(r.message || t('ads.pay.found'));
      refresh();
    } catch (err) {
      setPayWaiting(null);
      // A missing payment is the normal case right after booking, not a failure.
      setError(err.status === 404
        ? (afterPay
          ? t('ads.pay.notYetSigned')
          : t('ads.pay.notYet'))
        : (err.message || t('ads.pay.checkFailed')));
    }
  }

  /**
   * Attach an approved creative to a flight.
   *
   * A video spot is attached by its embed id; a banner is an image and is attached
   * by its URL. Which one to send is decided from the CREATIVE, not the campaign,
   * because that is the thing actually being sent — and sending the wrong one gets
   * "a player banner is an image, send imageUrl" from the server, which is a correct
   * answer to a question the page should not have asked.
   */
  async function onAttach(id) {
    const value = picked[id];
    if (!value || saving) return;
    const cr = creatives.find((c) => (c.permlink || c.embedId) === value);
    setSaving(id); setError(null);
    try {
      await attachCreative(cr?.kind === 'image'
        ? { reference, campaignId: id, imageUrl: cr.imageUrl }
        : { reference, campaignId: id, embedId: value });
      toast.success(cr?.kind === 'image' ? t('ads.book.bannerSaved') : (cr?.kind === 'text' ? t('ads.book.tickerSaved') : t('ads.book.spotSaved')));
      setPicked((p) => { const n = { ...p }; delete n[id]; return n; });
      refresh();
    } catch (err) {
      setError(err.message || t('ads.book.attachFailed'));
    } finally { setSaving(null); }
  }

  const ready = creatives.filter((c) => c.status === 'ready');
  /**
   * Has this flight's kind of spot been uploaded and be waiting on US?
   *
   * `pending` is still encoding and `review` is waiting for a person, and in both cases
   * the advertiser has done everything they can. Scoped by kind, because a video
   * sitting in review says nothing useful about a banner flight.
   */
  const awaitingUs = (campaign) => {
    const kinds = kindsFor(campaign);
    return creatives.some(
      (cr) => (cr.status === 'review' || cr.status === 'pending')
        && (!kinds.length || kinds.includes(cr.kind || 'video')),
    );
  };
  /**
   * Every creative kind this flight can run.
   *
   * The banner takes a still OR a video, so the singular `creativeKind` is only the
   * one its copy leads with and is the wrong thing to filter on. Falls back to the
   * singular for a checker too old to send the list.
   */
  const kindsFor = (campaign) => (
    campaign.creativeKinds?.length
      ? campaign.creativeKinds
      : (campaign.creativeKind ? [campaign.creativeKind] : [])
  );
  /**
   * Only the creatives THIS flight can use. A banner flight cannot run a video and a
   * spot flight cannot run a still, so offering both and letting the server refuse
   * is a worse experience than offering the one that works.
   */
  const readyFor = (campaign) => {
    // No stated requirement — an older campaign shape, or a response from before the
    // server published it — means show everything. Guessing 'video' here would hide
    // a perfectly good banner from a banner flight and leave no way to attach it,
    // which is exactly the failure this filter was added to prevent.
    const kinds = kindsFor(campaign);
    return kinds.length ? ready.filter((cr) => kinds.includes(cr.kind || 'video')) : ready;
  };

  /* A flight nobody can act on any more belongs in history: it either ran its course
     or was called off. Everything else is still live in some sense — being drafted,
     waiting on payment, scheduled, running or paused — and is what somebody checks on. */
  const FINISHED = new Set(['complete', 'cancelled']);
  const showBooking = view === 'all' || (view === 'book' && step === 2);
  /* Credit is about what the next booking costs, so it belongs where one is being
     made. Repeating it over the finished flights said nothing about them. */
  const showBalance = view === 'all' || view === 'book';
  const listed = view === 'active'
    ? campaigns.filter((c) => !FINISHED.has(c.status))
    : view === 'history'
      ? campaigns.filter((c) => FINISHED.has(c.status))
      : view === 'book'
        /* Only what was just booked, and only on the step that asks for payment. The
           full list lives under Active spots; showing it here as well was the same
           flights twice on one page. */
        ? (step === 3 && bookedId ? campaigns.filter((c) => c.id === bookedId) : [])
        : campaigns;

  return (
    <div className="mkt-campaigns">
      {view === 'all' ? <h3>{t('ads.book.yourBookings')}</h3> : null}
      {showBooking && (
        <>

      {/* Said before they choose, not after they pay. Booking DOES hold the position
          now: utils/adSlots.js treats a draft or awaiting-payment campaign as holding
          its slot for AD_SLOT_HOLD_HOURS, on the window it would get if it paid. The
          note used to say the opposite, that slots were settled at approval, which had
          simply stopped being true. The duration comes from the server so this cannot
          drift the same way twice. */}
      {awaitingApproval && (
        <p className="mkt-note">
          <MdInfoOutline aria-hidden="true" />
          <span>
            {pricing?.slotHoldHours
              ? t('ads.book.awaitingApprovalHours', { hours: pricing.slotHoldHours })
              : t('ads.book.awaitingApproval')}
          </span>
        </p>
      )}

      <form className="mkt-book" onSubmit={onBook}>
        {/* The type comes first and the rest of the form follows from it: the three
            products differ in price, in length, in what you supply and in whether a
            position is even yours to choose. */}
        {lockFormat ? (
          <p className="mkt-fine mkt-locked-format">
            <Trans
              i18nKey="ads.book.lockedFormat"
              values={{ format: fmt?.label || lockFormat }}
              components={{ b: <strong />, em: <em /> }}
            />
          </p>
        ) : (
          <FormatPicker formats={offered} value={fmt?.key} onChange={(k) => { setFormatKey(k); setSlotPct(null); setSpotSeconds(null); }} />
        )}

        {/* Grouped by what each field describes. Days, length and placement are the
            booking itself; the two duration fields are about the videos it may run
            on, which is a different question and was reading as more booking fields. */}
        <fieldset className="mkt-group">
          <legend>{t('ads.bookSteps.booking')}</legend>
        <div className="mkt-field">
          <label htmlFor="mkt-days">{t('ads.book.days')}</label>
          <input
            id="mkt-days" type="number" min={pricing?.minDays || 1} max={pricing?.maxDays || 90}
            value={days} onChange={(e) => setDays(e.target.value)}
          />
          <span className="mkt-hint">
            {t('ads.book.daysHint', { min: pricing?.minDays || 1, max: pricing?.maxDays || 90 })}
            {/* The nudge, at the moment the number is being chosen. Once they are past
                a month there is little left to sell them, so it stops rather than
                badgering — and it never appears at all if the curve is off. */}
            {daysSaving ? ` ${t('ads.book.daysSaving', { days, saving: daysSaving })}` : ''}
            {nextStep ? ` ${t('ads.book.nextStep', { days: nextStep.days, saving: nextStep.saving })}` : ''}
          </span>
        </div>

        <div className="mkt-field">
          <label htmlFor="mkt-start">{t('ads.wizard.starts')} <span className="mkt-optional">{t('ads.book.optional')}</span></label>
          <input
            id="mkt-start"
            type="date"
            min={earliestISO}
            value={startAt}
            onChange={(e) => setStartAt(e.target.value)}
          />
          <span className={startOk ? 'mkt-hint' : 'mkt-upload-error'}>
            {!startOk
              ? t('ads.book.datePassed')
              : runsUntil
                ? t('ads.book.runsTo', { date: runsUntil })
                : t('ads.book.startBlank')}
          </span>
        </div>
        <div className="mkt-field">
          <label htmlFor="mkt-length">
            {isBanner ? t('ads.book.howLongShows') : t('ads.book.adLength')}
          </label>
          <div className="mkt-length-row">
            <input
              id="mkt-length"
              type="number"
              min={tickerNeeds || minSpot}
              max={maxSpot}
              step="1"
              value={chosenLength}
              disabled={autoOn}
              onChange={(e) => setSpotSeconds(e.target.value === '' ? '' : Number(e.target.value))}
            />
            {takesVideo && (
              <label
                className="mkt-check mkt-auto-length"
                title={autoAvailable
                  ? ''
                  : (tooManySpots
                    ? t('ads.book.tooManySpots')
                    : t('ads.book.uploadFirst'))}
              >
                <input
                  type="checkbox"
                  checked={autoOn}
                  disabled={!autoAvailable}
                  onChange={(e) => {
                    // Turning it off keeps the number that was on screen instead of
                    // falling back to the format's maximum. This is a price field, and
                    // jumping 8s to 30s the moment you take manual control quadruples
                    // the quote without anyone typing anything.
                    if (!e.target.checked && spotSeconds == null) setSpotSeconds(chosenLength);
                    setAutoLength(e.target.checked);
                  }}
                />
                <span>{t('ads.book.automatic')}</span>
              </label>
            )}
          </div>
          <span className={`mkt-hint${lengthOk ? '' : ' mkt-hint-short'}`}>
            {autoTooLong
              ? t('ads.book.autoTooLong', { seconds: chosenLength })
              : (
                <>
                  {t('ads.book.secondsRange', { min: minSpot, max: maxSpot })}{' '}
                  {autoOn
                    ? t('ads.book.lengthFromVideo')
                    : (isTicker
                      ? (tickerTooShort
                        ? t('ads.book.tickerTooShort', { seconds: tickerNeeds })
                        : `${t('ads.book.tickerCross')}${tickerNeeds ? ` ${t('ads.book.tickerAtLeast', { seconds: tickerNeeds })}` : ''}`)
                      : isBanner
                      ? t('ads.book.bannerOnScreen')
                      : (tooManySpots
                        ? t('ads.book.enterLength')
                        : t('ads.book.mustFit')))}
                </>
              )}
          </span>
        </div>

        </fieldset>

        {/* Its own group. Where the ad falls inside the video is a different question
            from how long the flight runs, and sitting in the same box as Days and
            Length made it read as another property of the booking. */}
        {/* Only for formats that HAVE a position. The pre-upload spot plays at the
            one moment it can play, so a placement field there would be something an
            advertiser fills in that changes nothing. */}
        {/* Placement and video-length targeting stack in one column beside the
            booking. Side by side as three equal groups, the placement hint had a
            third of the width and wrapped to five lines. */}
        <div className="mkt-group-col">
        {fmt?.positioned ? (
        <fieldset className="mkt-group">
          <legend>{t('ads.inventory.placement')}</legend>
        <div className="mkt-field">
          <label htmlFor="mkt-slot">{t('ads.book.whenInVideo')}</label>
          <select id="mkt-slot" value={chosenSlot} onChange={(e) => setSlotPct(Number(e.target.value))}>
            {slots.map((p) => (
              <option key={p} value={p} disabled={slotTaken(p)}>
                {/* The "not recommended" warning is about a PRE-ROLL: an ad that plays
                    before the video, to people who were about to leave. A banner at 0%
                    is not that — it appears with the video, so the caveat does not
                    apply and neither does the wording. */}
                {p === 0 && !isBanner
                  ? t('ads.book.beforeNotRecommended')
                  : slotLabel({ percent: p, banner: isBanner })}
                {slotTaken(p)
                  ? t('ads.book.slotFull')
                  : (sharingWith(p) > 0 ? t('ads.book.placesLeft', { left: sharesLeft(p), total: slotRow(p).sharesTotal }) : '')}
              </option>
            ))}
          </select>
          <span className="mkt-hint">
            {/* A position is sold to one advertiser at a time, across every format —
                so this says what is actually for sale, not what exists. */}
            {t('ads.book.slotHint')}
            {sharingWith(chosenSlot) > 0
              ? ` ${t('ads.book.sharePosition', { count: sharingWith(chosenSlot) })}`
              : ` ${t('ads.book.positionCarries', { count: slotRow(chosenSlot)?.sharesTotal || 3 })}`}
          </span>
        </div>
        </fieldset>
        ) : null}

        {/* Both ends optional. Leaving one blank means "no limit on that end", so
            "at least three minutes" does not force you to invent a maximum. */}
        {/* Targeting by video length only means anything where there IS a video
            underneath. The pre-upload spot runs in the upload flow. */}
        {fmt?.surface === 'watch' ? (
        <fieldset className="mkt-group">
          <legend>{t('ads.book.videosToRunOn')} <span className="mkt-optional">{t('ads.book.optional')}</span></legend>
        <div className="mkt-field">
          <label htmlFor="mkt-minvid">{t('ads.book.shortestVideo')}</label>
          <input
            id="mkt-minvid" type="number" min="0" step="1" placeholder={t('ads.book.any')}
            value={minVideo} onChange={(e) => setMinVideo(e.target.value)}
          />
          <span className="mkt-hint">{t('ads.book.noMinimum')}</span>
          {inMinutes(minVideo, t) ? <span className="mkt-mins">{inMinutes(minVideo, t)}</span> : null}
        </div>

        <div className="mkt-field">
          <label htmlFor="mkt-maxvid">{t('ads.book.longestVideo')}</label>
          <input
            id="mkt-maxvid" type="number" min="0" step="1" placeholder={t('ads.book.any')}
            value={maxVideo} onChange={(e) => setMaxVideo(e.target.value)}
          />
          <span className={`mkt-hint${videoRangeOk ? '' : ' mkt-hint-short'}`}>
            {videoRangeOk
              ? t('ads.book.noMaximum')
              : t('ads.book.rangeInvalid')}
          </span>
          {inMinutes(maxVideo, t) ? <span className="mkt-mins">{inMinutes(maxVideo, t)}</span> : null}
        </div>
        </fieldset>
        ) : null}
        </div>
        {/* What this booking buys, exactly: the message at the length being priced, in
            its style. Changing the seconds above changes the speed here. */}
        {isTicker && tickerCreative ? (
          <TickerPreview
            account={account}
            productName={productName}
            message={tickerCreative.message}
            seconds={Number.isInteger(chosenLength) && chosenLength > 0 ? Math.min(chosenLength, maxSpot) : defaultLength}
            tickerStyle={tickerCreative.tickerStyle === 'hold' ? 'hold' : 'crawl'}
            caption={t('ads.ticker.previewCaption', { seconds: chosenLength })}
          />
        ) : null}
        <div className="mkt-book-total">
          {total != null ? (
            <span>
              <Trans i18nKey="ads.book.total" values={{ total }} components={{ b: <strong /> }} />
              {hiveEquivalent(total, pricing?.hbdPerHive) != null ? (
                <span className="mkt-hint">
                  {' '}{t('ads.book.aboutHive', { hive: hiveEquivalent(total, pricing.hbdPerHive) })}
                </span>
              ) : null}
              {productionFee > 0 ? <span className="mkt-hint"> {t('ads.book.feeSplit', { flight, fee: productionFee })}</span> : null}
              {/* ⚠️ This used to read "{chosenLength}s x {days} days at {rate} HBD per
                  second per day", which is a multiplication that no longer reproduces
                  the total: the day rate falls with the length of the flight. Quoting
                  the EFFECTIVE day rate keeps the line arithmetically honest and shows
                  the discount at the same time. */}
              <span className="mkt-hint">
                {' '}· {fmt ? `${fmt.label}, ` : ''}{t('ads.book.secondsOverDays', { seconds: chosenLength, count: Number(days) })}
                {fmt?.rateIsCustom ? t('ads.book.atAgreedRate') : ', '}
                {t('ads.book.perSecondPerDay', { rate: effectiveDayRate != null ? effectiveDayRate : rate })}
                {daysSaving ? t('ads.book.singleDayRate', { rate, saving: daysSaving }) : ''}
              </span>
              {/* What they will actually be asked to transfer. The server spends the
                  balance when the campaign is created, so quoting only the total
                  would overstate what this booking costs them. Mirrors the same
                  min(balance, price) the backend applies — matching `total` works
                  because priceHbd there is likewise flight + production fee. */}
              {balanceHbd > 0 ? (
                <span className="mkt-hint">
                  {' '}· <Trans
                    i18nKey="ads.book.creditApplied"
                    values={{ credit: Math.min(balanceHbd, total), send: Math.round(Math.max(0, total - balanceHbd) * 1000) / 1000 }}
                    components={{ b: <strong /> }}
                  />
                </span>
              ) : null}
            </span>
          ) : null}
          <button
            type="submit"
            className="mkt-primary"
            disabled={busy || briefTooShort || !lengthOk || !videoRangeOk || !startOk
              || (fmt?.positioned && slotTaken(chosenSlot))}
          >
            {busy ? t('ads.book.booking') : t('ads.book.bookThis')}
          </button>
        </div>
      </form>
      {error ? <p className="mkt-upload-error">{error}</p> : null}
        </>
      )}

      {/* Shown whether or not they have campaigns: credit somebody has to go looking
          for is credit they will never spend, which would make "we credit you instead
          of refunding" a way of keeping the money rather than an alternative to
          sending it back. It comes off the next booking on its own. */}
      {showBalance && balanceHbd > 0 && (
        <p className="mkt-balance">
          <Trans i18nKey="ads.book.creditBalance" values={{ balance: balanceHbd }} components={{ b: <strong /> }} />
        </p>
      )}

      {(view === 'active' || view === 'history') && listed.length === 0 && (
        <p className="mkt-fine">
          {view === 'active'
            ? t('ads.book.noLive')
            : t('ads.book.noHistory')}
        </p>
      )}

      {listed.length > 0 && (
        <ul className="mkt-campaign-list">
          {listed.map((c) => (
            <li key={c.id}>
              <div className="mkt-campaign-head">
                <span className="mkt-campaign-name">{c.name}</span>
                <span className="mkt-creative-status">{c.status.replace(/_/g, ' ')}</span>
              </div>
              <div className="mkt-creative-meta">
                {t('ads.wizard.days', { count: c.days })} · {c.spotSeconds ? `${c.spotSeconds}s · ` : ''}
                {slotLabel({
                  percent: c.slotPercent,
                  position: c.slotPosition,
                  banner: c.format === 'video_banner',
                })} · {c.priceHbd} HBD
                {c.forecast != null ? t('ads.book.forecastPlays', { count: c.forecast, plays: formatCount(c.forecast) }) : ''}
              </div>

              {c.production && (
                <div className="mkt-campaign-blocked">
                  {t('ads.book.makingVideo')} · {c.production.status}
                  {c.productionFeeHbd ? ` · ${c.productionFeeHbd} HBD` : ''}
                </div>
              )}

              {/* 'unpaid' is left out: the campaign's own status already says awaiting
                  payment, and the panel asking for the payment is directly below. The
                  key stays in BLOCKED_REASON because dropping it would fall through to
                  the raw `unpaid` for anything else that reads the map. */}
              {c.blockedBy && c.blockedBy !== 'unpaid' && (() => {
                /* "No spot attached yet" is true of the CAMPAIGN and false of the
                   advertiser: the server means no creative is attached, but a spot that
                   is uploaded and waiting on our review is not attachable yet. Telling
                   someone who has done their part that they have not is how a paid
                   advertiser ends up wondering what they missed. */
                const label = (c.blockedBy === 'no_creative' && awaitingUs(c))
                  ? t('ads.book.teamWillReview')
                  : (BLOCKED_REASON[c.blockedBy] ? t(BLOCKED_REASON[c.blockedBy]) : c.blockedBy);
                return <div className="mkt-campaign-blocked">{label}</div>;
              })()}

              {c.paidHbd < c.priceHbd && (
                <div className="mkt-pay">
                  {(() => {
                    const owed = Math.round((c.priceHbd - c.paidHbd) * 1000) / 1000;
                    const ccy = ccyFor(c, owed);
                    const inHive = hivePayable(owed, pricing?.hbdPerHive);
                    const shown = ccy === 'HIVE' ? inHive : owed;
                    return (
                      <>
                        <div className="mkt-pay-ccy" role="group" aria-label={t('ads.promote.payWith')}>
                          {['HBD', 'HIVE'].map((k) => (
                            <button
                              key={k}
                              type="button"
                              className={`mkt-ccy${ccy === k ? ' selected' : ''}`}
                              // No HIVE price, no HIVE option: an unpriced button would
                              // send an amount we cannot work out.
                              disabled={k === 'HIVE' && inHive == null}
                              aria-pressed={ccy === k}
                              onClick={() => setPayCcy((m) => ({ ...m, [c.id]: k }))}
                            >
                              {k}
                            </button>
                          ))}
                        </div>
                        {/* After the choice, because it describes what that choice
                            means: the amount and the asset both change with it. */}
                        <p className="mkt-pay-line">
                          <Trans
                            i18nKey="ads.pay.sendLine"
                            values={{ amount: shown != null ? shown.toFixed(3) : '—', ccy, payTo: c.payTo, memo: c.memo }}
                            components={{ b: <strong />, code: <code />, copy: <CopyButton value={c.memo} /> }}
                          />
                          {ccy === 'HIVE' ? ` ${t('ads.pay.hiveValued')}` : ''}
                        </p>
                      </>
                    );
                  })()}
                  {/* Without this the figure above simply does not match the price on
                      the line beside it, which reads as a pricing bug rather than a
                      discount. Say where the difference went. */}
                  {c.creditAppliedHbd > 0 && (
                    <p className="mkt-hint">
                      {t('ads.pay.lessCredit', { price: c.priceHbd, credit: c.creditAppliedHbd })}
                    </p>
                  )}
                  <div className="mkt-pay-actions">
                    <button
                      type="button"
                      className="mkt-outline"
                      disabled={payBusy === c.id}
                      onClick={() => payWithWallet(c)}
                    >
                      {payBusy === c.id
                        ? (payWaiting ? t('ads.pay.confirmingShort') : t('ads.pay.waitingWallet'))
                        : t('ads.pay.sendWithWallet')}
                    </button>
                    <button type="button" className="mkt-secondary" onClick={() => onCheckPayment(c.id)}>
                      {t('ads.pay.manuallySent')}
                    </button>
                  </div>
                  {payWaiting && <p className="mkt-fine">{payWaiting}</p>}
                  {payError && <p className="mkt-upload-error">{payError}</p>}
                </div>
              )}

              {/* Nothing to attach to a flight that has already run or been called
                  off: the picker offered a choice that could not change anything. */}
              {!c.creative && c.status !== 'complete' && c.status !== 'cancelled' && (() => {
                const usable = readyFor(c);
                const kinds = kindsFor(c);
                const canImage = kinds.includes('image');
                const canVideo = kinds.includes('video');
                const wantsText = kinds.includes('text');
                // Only when the still is the ONLY thing that runs. A banner flight
                // takes either, and calling that "image" is what hid a finished
                // video banner from its own picker.
                const wantsImage = canImage && !canVideo;
                if (!usable.length) {
                  // Approved creatives exist, just none of the right kind. Say which
                  // kind is missing rather than showing an empty picker.
                  return ready.length > 0 ? (
                    <div className="mkt-pay">
                      <p className="mkt-hint">
                        {wantsText
                          ? t('ads.attach.needsTicker')
                          : canImage && canVideo
                          ? t('ads.attach.needsBannerEither', {
                            format: c.formatLabel || t('ads.attach.banner'),
                            spec: c.creativeSpec ? t('ads.attach.specRange', { recommended: c.creativeSpec.recommended, min: c.creativeSpec.minAspect, max: c.creativeSpec.maxAspect }) : '',
                          })
                          : wantsImage
                            ? t('ads.attach.needsBannerImage', {
                              format: c.formatLabel || t('ads.attach.banner'),
                              spec: c.creativeSpec ? t('ads.attach.specRange', { recommended: c.creativeSpec.recommended, min: c.creativeSpec.minAspect, max: c.creativeSpec.maxAspect }) : '',
                            })
                            : t('ads.attach.needsVideo')}
                      </p>
                    </div>
                  ) : null;
                }
                return (
                <div className="mkt-pay">
                  <label className="mkt-hint" htmlFor={`attach-${c.id}`}>
                    {wantsText
                      ? t('ads.attach.useTicker')
                      : canImage && canVideo
                      ? t('ads.attach.useBannerOrVideo')
                      : wantsImage ? t('ads.attach.useBanner') : t('ads.attach.useVideo')}
                  </label>
                  <div className="mkt-attach-row">
                    <select
                      id={`attach-${c.id}`}
                      value={picked[c.id] || ''}
                      onChange={(e) => setPicked((p) => ({ ...p, [c.id]: e.target.value }))}
                    >
                      <option value="" disabled>{t('ads.attach.chooseOne')}</option>
                      {usable.map((cr) => (
                        <option key={cr.embedId} value={cr.permlink || cr.embedId}>
                          {/* A still has no duration — "0s ad" was what it used to say. */}
                          {cr.kind === 'image'
                            ? `${t('ads.attach.bannerOption')}${cr.imageWidth ? ` · ${cr.imageWidth}×${cr.imageHeight}` : ''}`
                            : cr.kind === 'text'
                              ? `${t('ads.attach.tickerOption')} · ${cr.message.length > 48 ? `${cr.message.slice(0, 47)}…` : cr.message}`
                              : t('ads.attach.secondsAd', { seconds: cr.durationSeconds })}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className="mkt-outline"
                      disabled={!picked[c.id] || saving === c.id}
                      onClick={() => onAttach(c.id)}
                    >
                      {saving === c.id ? t('common.actions.saving') : t('common.actions.save')}
                    </button>
                  </div>
                </div>
                );
              })()}

              {(c.delivered > 0 || c.status === 'complete') && (
                <div className="mkt-delivery">
                  <span>
                    {c.forecast
                      ? <Trans i18nKey="ads.delivery.deliveredOf" count={c.delivered} values={{ delivered: formatCount(c.delivered), forecast: formatCount(c.forecast) }} components={{ b: <strong /> }} />
                      : <Trans i18nKey="ads.delivery.delivered" count={c.delivered} values={{ delivered: formatCount(c.delivered) }} components={{ b: <strong /> }} />}
                  </span>
                  {/* A shortfall against forecast is settled as credit toward the
                      next booking, not as a transfer back. Saying "we will send it"
                      would leave them waiting for money that is not coming. */}
                  {/* Credit EARNED is good news. It shared .mkt-refund with the
                      "we are looking at this one" case, which is a problem and is
                      meant to read as one, so both came out in the warning red. */}
                  {c.refundHbd > 0 && (
                    <span className={c.refundStatus === 'credited' ? 'mkt-credit-earned' : 'mkt-refund'}>
                      {c.refundStatus === 'credited'
                        ? t('ads.delivery.credited', { amount: c.creditHbd ?? c.refundHbd })
                        : t('ads.delivery.short', { amount: c.refundHbd })}
                    </span>
                  )}
                  {c.creditAppliedHbd > 0 && (
                    <span className="mkt-credit-used">
                      {t('ads.delivery.creditUsed', { amount: c.creditAppliedHbd })}
                    </span>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// Values are i18n keys.
const CREATIVE_STATUS = {
  pending: 'ads.creativeStatus.pending',
  review: 'ads.creativeStatus.review',
  ready: 'ads.creativeStatus.ready',
  rejected: 'ads.creativeStatus.rejected',
};

/* A creative still waiting on something (our review, or its encode) changes on the
 * server's schedule, not the page's. These lists were read once on mount, so "Waiting
 * for review" stayed on screen after we had approved it until somebody reloaded.
 *
 * Re-reads while anything is unsettled and stops once nothing is, so a settled list
 * makes no requests. Not while the tab is hidden; it catches up the moment it is back. */
/* The status pill. A rejection carries the team's reason INSIDE the pill: as a trailing
 * "· reason" in the grey description it read as part of the ad's own text, and the one
 * thing the advertiser needs to act on was the easiest to miss. */
const rejectedWithNote = (c) => c.status === 'rejected' && !!c.note;
function CreativeStatus({ c }) {
  const { t } = useTranslation();
  const label = CREATIVE_STATUS[c.status] ? t(CREATIVE_STATUS[c.status]) : c.status;
  return (
    <span className={`mkt-creative-status mkt-creative-${c.status}${rejectedWithNote(c) ? ' has-note' : ''}`}>
      {rejectedWithNote(c) ? <>{t('ads.creativeStatus.withNote', { label })}<span className="mkt-creative-note">{c.note}</span></> : label}
    </span>
  );
}

const CREATIVE_POLL_MS = 20000;
const isUnsettled = (c) => c.status === 'pending' || c.status === 'review';
function usePollWhileUnsettled(list, refresh) {
  const waiting = list.some(isUnsettled);
  useEffect(() => {
    if (!waiting) return undefined;
    const tick = () => { if (document.visibilityState === 'visible') refresh(); };
    const timer = setInterval(tick, CREATIVE_POLL_MS);
    document.addEventListener('visibilitychange', tick);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', tick); };
  }, [waiting, refresh]);
}

/**
 * Upload the spot.
 *
 * Available from the moment an application exists, not only once it is approved.
 * The reviewer's first question is what would actually run, and the video answers
 * it better than a paragraph describing the video — so an applicant can attach it
 * straight after applying and hear one answer instead of two. The backend caps how
 * many files a pending applicant may attach, so this is not open file hosting.
 *
 * The upload goes through the ordinary pipeline but is never published to Hive —
 * it has no post, earns nothing, and appears in no feed. It exists so the spot can
 * be watched and approved before it ever runs in front of anyone. A spot cannot
 * reach a viewer while the application is pending: serving needs a booked, paid
 * flight, and a flight needs an approved advertiser.
 */
/**
 * The logo and slogan drawn in the disclosure overlay while the ad plays.
 *
 * Sits with the ad videos because it is part of what the viewer sees, and it lives
 * on the product rather than on each clip: it says who the ad is from, which does
 * not change between one video and the next.
 */
function BrandPanel({ reference, account, productName, initialLogoUrl, initialSlogan }) {
  const { t } = useTranslation();
  const [logoUrl, setLogoUrl] = useState(initialLogoUrl || null);
  const [slogan, setSlogan] = useState(initialSlogan || '');
  const [savedSlogan, setSavedSlogan] = useState(initialSlogan || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const logoInput = useRef(null);

  async function onLogo(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    setBusy(true); setError(null);
    try {
      const res = await uploadLogo({ file, reference });
      setLogoUrl(res.logoUrl);
      toast.success(t('ads.brand.logoSaved'));
    } catch (err) {
      setError(err.message || t('ads.brand.logoFailed'));
    } finally {
      setBusy(false);
      if (logoInput.current) logoInput.current.value = '';   // let the same file be retried
    }
  }

  async function onSaveSlogan() {
    setBusy(true); setError(null);
    try {
      const res = await saveBranding({ reference, slogan: slogan.trim() });
      setSavedSlogan(res.slogan || '');
      toast.success(t('ads.brand.sloganSaved'));
    } catch (err) {
      setError(err.message || t('ads.brand.sloganFailed'));
    } finally { setBusy(false); }
  }

  const over = slogan.trim().length > SLOGAN_MAX;
  const dirty = slogan.trim() !== savedSlogan;

  return (
    <div className="mkt-brand">
      <h3>{t('ads.brand.title')}</h3>
      <p className="mkt-fine">
        {t('ads.brand.intro')}
      </p>

      <div className="mkt-brand-row">
        <div className="mkt-brand-fields">
          <div className="mkt-field">
            <span className="mkt-label">{t('ads.brand.logo')}</span>
            <input
              ref={logoInput}
              id={`mkt-logo-${reference}`}
              type="file"
              accept="image/*"
              onChange={onLogo}
              disabled={busy}
              className="mkt-visually-hidden"
            />
            <label htmlFor={`mkt-logo-${reference}`} className={`mkt-secondary mkt-upload-btn${busy ? ' disabled' : ''}`}>
              {logoUrl ? t('ads.brand.replaceLogo') : t('ads.brand.uploadLogo')}
            </label>
            <span className="mkt-hint">{t('ads.brand.logoHint')}</span>
          </div>

          <div className="mkt-field mkt-field-wide">
            <label htmlFor={`mkt-slogan-${reference}`}>{t('ads.brand.slogan')}</label>
            <input
              id={`mkt-slogan-${reference}`}
              value={slogan}
              maxLength={SLOGAN_MAX}
              onChange={(e) => setSlogan(e.target.value)}
              placeholder={t('ads.brand.sloganPlaceholder')}
            />
            <span className={`mkt-hint${over ? ' mkt-hint-short' : ''}`}>
              {t('ads.brand.sloganCount', { length: slogan.trim().length, max: SLOGAN_MAX })}
            </span>
          </div>

          <div className="mkt-field">
            <span className="mkt-label mkt-visually-hidden">{t('common.actions.save')}</span>
            <button
              type="button"
              className="mkt-secondary"
              onClick={onSaveSlogan}
              disabled={busy || over || !dirty}
            >
              {busy ? t('common.actions.saving') : (dirty ? t('ads.brand.saveSlogan') : t('common.actions.saved'))}
            </button>
          </div>
        </div>

        {/* The overlay on its own. The ad video underneath is a separate thing and
            putting it here answered a question nobody was asking: what matters is
            how the label itself reads, at the size it is drawn. */}
        <div className="mkt-brand-preview">
          <span className="mkt-preview-cap">{t('ads.brand.previewCap')}</span>
          <AdOverlay
            account={account}
            brand={{ productName, slogan: slogan.trim(), logoUrl }}
            previewOnly
          />
        </div>
      </div>

      {error ? <p className="mkt-upload-error">{error}</p> : null}
    </div>
  );
}

/**
 * Write the ticker: a message and a link, with the strip previewed live underneath.
 *
 * The ticker's creative IS this text, so it is saved as a creative and goes to the
 * same review as an image or a video. Editing a word makes a new one that has to be
 * reviewed again, which the server enforces by keying the creative on its content.
 */
// title/blurb are i18n keys.
const TICKER_STYLES = [
  { id: 'crawl', title: 'ads.tickerStyle.crawl.title', blurb: 'ads.tickerStyle.crawl.blurb' },
  { id: 'hold', title: 'ads.tickerStyle.hold.title', blurb: 'ads.tickerStyle.hold.blurb' },
];

/* The ticker as a viewer will get it: the same TickerCrawl the watch page draws, at the
 * width of a real player and running for the seconds being booked. "Phone" also gives
 * it the phone strip (smaller type), which is what decides whether a held line fits.
 *
 * Keyed on everything that changes the run, so a new length or style restarts it from
 * the first frame instead of jumping to wherever the old animation had got to. */
function TickerPreview({ account, productName, message, seconds, tickerStyle = 'crawl', caption }) {
  const { t } = useTranslation();
  const [device, setDevice] = useState('desktop');
  const compact = device === 'phone';
  return (
    <div className="mkt-ticker-preview" aria-label={t('ads.ticker.preview')}>
      <div className="mkt-ticker-preview-head">
        <span className="mkt-preview-cap">{caption}</span>
        <div className="mkt-pay-ccy" role="group" aria-label={t('ads.ticker.screenSize')}>
          {[['desktop', t('ads.ticker.desktop')], ['phone', t('ads.ticker.phone')]].map(([k, label]) => (
            <button
              key={k}
              type="button"
              className={`mkt-ccy${device === k ? ' selected' : ''}`}
              aria-pressed={device === k}
              onClick={() => setDevice(k)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className={`mkt-ticker-stage${compact ? ' is-phone' : ''}`}>
        <TickerCrawl
          key={`${seconds}:${tickerStyle}:${device}`}
          account={account}
          productName={productName}
          message={message}
          durationSeconds={seconds}
          tickerStyle={tickerStyle}
          compact={compact}
          loop
        />
      </div>
    </div>
  );
}

function TickerPanel({ reference, account, productName, format = null, onCreatives }) {
  const { t } = useTranslation();
  const spec = format?.creativeSpec;
  const maxChars = spec?.maxChars || 140;
  const maxSeconds = format?.maxSeconds || 20;
  const [message, setMessage] = useState('');
  const [tickerStyle, setTickerStyle] = useState('crawl');
  const styleName = `mkt-ticker-style-${useId()}`;
  const [link, setLink] = useState('https://');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState([]);

  const refresh = useCallback(() => {
    fetchCreatives(reference)
      .then((r) => {
        const all = r.creatives || [];
        setSaved(all.filter((c) => c.kind === 'text'));
        onCreatives?.(all);
      })
      .catch(() => { /* an unreadable list is not worth an error banner */ });
  }, [reference, onCreatives]);
  useEffect(() => { refresh(); }, [refresh]);
  usePollWhileUnsettled(saved, refresh);

  const length = [...message.trim()].length;
  const words = message.trim() ? message.trim().split(/\s+/).length : 0;
  // How long this message must be booked for to be readable. The checker refuses a
  // shorter booking at attach, so say it here, while it can still be rewritten.
  const needs = tickerMinSeconds(message, spec);
  const tooSlowToRead = needs > maxSeconds;
  const linkOk = /^https:\/\/[^\s/]+\.[^\s]+/i.test(link.trim());
  // What is in the form is already saved as-is. The form is NOT cleared after a save
  // (an empty form right after pressing Save read as "it lost my ticker"), so this is
  // what tells the advertiser it went through; any edit makes it savable again.
  const alreadySaved = saved.some((c) => c.message === message.trim()
    && c.clickUrl === link.trim() && (c.tickerStyle || 'crawl') === tickerStyle);
  const canSave = length > 0 && length <= maxChars && !tooSlowToRead && linkOk && !busy && !alreadySaved;

  async function onSave() {
    if (!canSave) return;
    setBusy(true); setError(null);
    try {
      await saveTickerCreative({ reference, message: message.trim(), clickUrl: link.trim(), style: tickerStyle });
      toast.success(t('ads.ticker.savedReview'));
      refresh();
    } catch (err) {
      setError(err.message || t('ads.ticker.saveFailed'));
    } finally { setBusy(false); }
  }

  return (
    <div className="mkt-creatives">
      <h3>{t('ads.ticker.yourTicker')}</h3>
      <div className="mkt-field mkt-field-wide">
        <label htmlFor="mkt-ticker-msg">{t('ads.market.spec.message')}</label>
        <textarea
          id="mkt-ticker-msg"
          rows={2}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder={t('ads.ticker.messagePlaceholder')}
        />
        <span className={`mkt-hint${length > maxChars || tooSlowToRead ? ' mkt-hint-short' : ''}`}>
          {t('ads.ticker.charCount', { length, max: maxChars })} · {t('ads.ticker.words', { count: words })}
          {tooSlowToRead
            ? t('ads.ticker.tooSlow', { needs, max: maxSeconds })
            : t('ads.ticker.bookAtLeast', { needs })}
        </span>
      </div>
      <div className="mkt-field mkt-field-wide mkt-adtype">
        <span className="mkt-label">{t('ads.ticker.howMoves')}</span>
        <div className="mkt-adtype-row">
          {TICKER_STYLES.map((o) => (
            <label key={o.id} className={`mkt-adtype-opt${tickerStyle === o.id ? ' selected' : ''}`}>
              <input
                type="radio"
                name={styleName}
                value={o.id}
                checked={tickerStyle === o.id}
                onChange={() => setTickerStyle(o.id)}
              />
              <span>
                <strong>{t(o.title)}</strong>
                <span className="mkt-hint">{t(o.blurb)}</span>
              </span>
            </label>
          ))}
        </div>
      </div>
      <div className="mkt-field mkt-field-wide">
        <label htmlFor="mkt-ticker-link">{t('ads.market.spec.link')}</label>
        <input
          id="mkt-ticker-link"
          type="url"
          inputMode="url"
          value={link}
          onChange={(e) => setLink(e.target.value)}
        />
        <span className={`mkt-hint${link.trim() && link.trim() !== 'https://' && !linkOk ? ' mkt-hint-short' : ''}`}>
          {t('ads.ticker.linkHint')}
        </span>
      </div>

      <TickerPreview
        account={account}
        productName={productName}
        message={message.trim() || t('ads.ticker.placeholderMessage')}
        // At the shortest booking that is allowed, so this is the FASTEST it will ever
        // run. Booking longer only slows it down.
        seconds={Math.min(needs, maxSeconds)}
        tickerStyle={tickerStyle}
        caption={t('ads.ticker.alongTop', { seconds: Math.min(needs, maxSeconds) })}
      />

      <div className="mkt-upload-row">
        <button type="button" className="mkt-outline" disabled={!canSave} onClick={onSave}>
          {busy ? t('common.actions.saving') : (alreadySaved ? t('common.actions.saved') : t('ads.ticker.saveTicker'))}
        </button>
      </div>
      {error ? <p className="mkt-upload-error">{error}</p> : null}

      {saved.length > 0 && (
        <ul className="mkt-creative-list">
          {saved.map((c) => (
            <li key={c.embedId}>
              <CreativeStatus c={c} />
              <span className="mkt-creative-meta">
                {c.message}
                {` · ${c.tickerStyle === 'hold' ? t('ads.ticker.styleHold') : t('ads.ticker.styleCrawl')}`}
                {c.minSeconds ? t('ads.ticker.atLeastSeconds', { seconds: c.minSeconds }) : ''}
                {c.note && !rejectedWithNote(c) ? ` · ${c.note}` : ''}
              </span>
              <a href={c.clickUrl} target="_blank" rel="noopener noreferrer">{t('ads.ticker.checkLink')}</a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CreativePanel({ reference, account, maxSeconds, bannerSpec, onCreatives, pending, production, offer, brand, adType = null, single = false }) {
  const { t } = useTranslation();
  const [creatives, setCreatives] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const inputRef = useRef(null);
  /* 🚨 UNIQUE PER PANEL. This id was the constant "mkt-creative-file", and there are
   * TWO CreativePanels on the product page: the booking wizard's, and the one below it
   * that is deliberately kept MOUNTED on every tab (hidden with display:none) so the
   * attach pickers stay filled. Two inputs, one id — and `htmlFor` binds a label to the
   * FIRST match in the document, not to the input beside it.
   *
   * So once the wizard panel had its one creative it disabled its own input, and every
   * upload button on the page silently pointed at that disabled input. The button did
   * nothing, with no error, because the click was landing on a different panel's
   * control. */
  const inputId = `mkt-creative-file-${useId()}`;

  // One file when the wizard asks for one. A booking runs a single creative, so
  // offering "add another" mid-enrollment invites a library nobody asked for and a
  // question ("which of these runs?") the flow cannot answer yet.
  const atLimit = single && creatives.length >= 1;

  const refresh = useCallback(() => {
    fetchCreatives(reference)
      .then((r) => { setCreatives(r.creatives || []); onCreatives?.(r.creatives || []); })
      .catch(() => { /* an unreadable list is not worth an error banner */ });
  }, [reference, onCreatives]);

  useEffect(() => { refresh(); }, [refresh]);
  usePollWhileUnsettled(creatives, refresh);

  async function onFile(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    setError(null);
    setBusy(true);
    try {
      if ((file.type || '').startsWith('image/')) {
        // A still used to be an asset and nothing more — the only product was a spot
        // spliced into HLS, which a still cannot be. It is now the whole of the
        // player-banner format, so saying it "cannot run on its own" is simply
        // false. Whether THIS still is banner-shaped is decided when it is attached
        // to a flight, by the one rule that governs it.
        await uploadImageAsset({ file, reference });
        toast.success(t('ads.creative.imageSaved'));
      } else {
        // Checked here as well as on the server so a too-long spot fails in a second
        // rather than after an upload.
        const durationSeconds = await readVideoDuration(file);
        if (durationSeconds && maxSeconds && durationSeconds > maxSeconds) {
          throw new Error(t('ads.creative.tooLong', { seconds: durationSeconds, max: maxSeconds }));
        }
        await uploadCreative({ file, account, reference, durationSeconds });
        toast.success(t('ads.creative.spotUploaded'));
      }
      refresh();
    } catch (err) {
      setError(err.message || t('ads.creative.uploadFailed'));
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';   // let the same file be retried
    }
  }

  return (
    <div className="mkt-creatives">
      {brand && (
        <BrandPanel
          key={reference}
          reference={reference}
          account={account}
          productName={brand.productName}
          initialLogoUrl={brand.logoUrl}
          initialSlogan={brand.slogan}
        />
      )}

      <h3>
        {adType === 'banner' ? t('ads.creative.yourBanner') : (isVideoAd(adType) ? t('ads.creative.yourVideo') : t('ads.creative.yourCreatives'))}
      </h3>
      {adType !== 'banner' && (
        <p className="mkt-fine">
          {t('ads.creative.uploadIntro')}
          {maxSeconds ? ` ${t('ads.creative.upToSeconds', { seconds: maxSeconds })}` : null}
        </p>
      )}
      <p className="mkt-fine">
        {/* Written for the format being bought. Telling someone making a banner about
            video encoding, or someone making a spot about aspect ratios, is how a
            form ends up feeling like it was written for somebody else. */}
        {adType === 'banner'
          ? (
            <>
              {t('ads.creative.bannerIntro')}
              {` ${bannerAdvice(bannerSpec)}`}
            </>
          )
          : (
            <>
              <Trans i18nKey="ads.creative.imagesToo" components={{ b: <strong /> }} />
              {` ${bannerAdvice(bannerSpec)}`}
              {' '}{t('ads.creative.logoWorth')}
            </>
          )}
      </p>
      {pending && !production && (
        <p className="mkt-fine">
          {t('ads.creative.pendingNote')}
        </p>
      )}
      {production && adType !== 'banner' && (
        // They already asked us to make it, so "upload the video you want to run" is
        // the wrong instruction to leave standing. What we want from them is raw
        // material, and only if they have any.
        <p className="mkt-fine">
          {t('ads.creative.productionNote')}
        </p>
      )}

      {/* A banner takes a still OR a video, and a video is played once for the seconds
          it runs rather than looped, so it has to cover the booking. Deliberately not
          offering GIFs: the compositor takes real video, and a GIF would be accepted by
          the picker and then refused by the encoder. */}
      <div className="mkt-upload-row">
        <input
          ref={inputRef}
          id={inputId}
          type="file"
          accept={adType === 'banner' ? 'image/*,video/*' : (isVideoAd(adType) ? 'video/*' : 'video/*,image/*')}
          onChange={onFile}
          disabled={busy || atLimit}
          className="mkt-visually-hidden"
        />
        <label
          htmlFor={inputId}
          className={`mkt-outline mkt-upload-btn${busy || atLimit ? ' disabled' : ''}`}
          aria-disabled={atLimit ? 'true' : undefined}
        >
          {busy
            ? t('ads.creative.uploading')
            : (atLimit
              ? t('ads.creative.replaceBelow')
              : (adType === 'banner' ? t('ads.creative.uploadBanner')
                : (isVideoAd(adType) ? t('ads.creative.uploadVideo') : t('ads.creative.uploadAny'))))}
        </label>
      </div>
      {error ? <p className="mkt-upload-error">{error}</p> : null}

      {/* "Or have us make it" belongs here, next to the upload button: the question
          is about the video, and the person who has just failed to find a file to
          upload is exactly the person who needs the offer. The FEE is still charged
          on the flight, which is why the state lives with the booking panel. */}
      {offer && (
        <div className="mkt-production">
          <label className="mkt-check">
            <input
              type="checkbox"
              checked={!!offer.wanted}
              onChange={(e) => offer.onChange({ wanted: e.target.checked, brief: offer.brief })}
            />
            <span>
              <strong>{t('ads.production.offer')}</strong>
              {offer.feeHbd
                ? <> <Trans i18nKey="ads.production.fee" values={{ fee: offer.feeHbd }} components={{ b: <strong /> }} /></>
                : null}
            </span>
          </label>
          {offer.wanted && (
            <div className="mkt-field mkt-field-wide">
              <label htmlFor="mkt-spot-brief">{t('ads.production.briefLabel')}</label>
              <textarea
                id="mkt-spot-brief"
                rows={4}
                value={offer.brief}
                onChange={(e) => offer.onChange({ wanted: true, brief: e.target.value })}
                placeholder={t('ads.production.briefPlaceholder')}
              />
              <span className={`mkt-hint${offer.brief.trim().length < 20 ? ' mkt-hint-short' : ''}`}>
                {offer.brief.trim().length < 20
                  ? t('ads.production.moreChars', { count: 20 - offer.brief.trim().length })
                  : t('ads.production.enough')}
              </span>
            </div>
          )}
        </div>
      )}

      {creatives.length > 0 && (
        <ul className="mkt-creative-list">
          {creatives.map((c) => (
            <li key={c.embedId}>
              <CreativeStatus c={c} />
              <span className="mkt-creative-meta">
                {/* Its size, not a verdict. Whether a given still is banner-shaped
                    is the attach route's call — creativeSpecError() on the server is
                    the single definition, and restating it here would be a second
                    copy of the rule to drift out of step. */}
                {c.kind === 'image'
                  ? `${t('ads.creative.image')}${c.imageWidth ? ` · ${c.imageWidth}×${c.imageHeight}` : ''}`
                  : c.kind === 'text'
                    ? `${t('ads.attach.tickerOption')} · ${c.message}`
                    : (c.durationSeconds ? `${c.durationSeconds}s` : t('ads.creative.durationUnknown'))}
                {c.note && !rejectedWithNote(c) ? ` · ${c.note}` : ''}
              </span>
              {c.kind === 'image' ? (
                // The banner itself, not a link to it. Whether a still works as a
                // banner is a question about how it LOOKS, and "View it" made you
                // leave the page to answer it. Shown on a dark ground because that
                // is what it will sit on, and a white logo on white here would read
                // as a broken upload.
                <a
                  className="mkt-creative-thumb"
                  href={c.imageUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={t('ads.creative.openFull')}
                >
                  <img src={c.imageUrl} alt={t('ads.creative.yourBanner')} loading="lazy" />
                </a>
              ) : c.kind === 'text' ? (
                <a href={c.clickUrl} target="_blank" rel="noopener noreferrer">{t('ads.ticker.checkLink')}</a>
              ) : c.previewUrl && c.encoded ? (
                <a href={c.previewUrl} target="_blank" rel="noopener noreferrer">{t('ads.creative.watchBack')}</a>
              ) : <span className="mkt-creative-meta">{t('ads.creative.stillEncoding')}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// `openLoginModal` comes from the app root, which owns the login modal. Opening it
// in place matters here: the /login route redirects home first, and this is a page
// people arrive at from outside 3Speak, so bouncing them off it loses the visit.
export default function Advertise({ openLoginModal }) {
  const { t } = useTranslation();
  const user = useAppStore((s) => s.user);
  const [form, setForm] = useState(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [receipt, setReceipt] = useState(null);
  const [lookupRef, setLookupRef] = useState('');
  const [lookup, setLookup] = useState(null);
  // The logged-in account's own applications, so a returning advertiser does not
  // have to keep a reference code around to find their own work. `forceSigned` is
  // the "ask the checker properly" switch, which costs a signature.
  const [forceSigned, setForceSigned] = useState(false);
  // Bumped whenever a reference is added to this device: applying, or looking one
  // up. localStorage is not reactive and `user` does not change when it is written,
  // so without this the list would keep showing the pre-apply set until a reload.
  const [refsVersion, setRefsVersion] = useState(0);
  // Lifted so the flight panel can offer the spots the creative panel has loaded.
  /* Two lists, not one. Both panels stay MOUNTED — the tabs hide with `hidden`, they do
     not unmount — so a single shared list is written by whichever panel fetched last.
     It was only ever fed by the My-products panel, which is why the wizard's booking
     step saw no creatives at all and could not offer the automatic length. */
  const [creativeList, setCreativeList] = useState([]);
  const [wizCreativeList, setWizCreativeList] = useState([]);

  const { data: inventory, isLoading, error } = useQuery({
    queryKey: ['advertise-inventory'],
    queryFn: fetchInventory,
    staleTime: INVENTORY_STALE_MS,
    retry: false,
  });

  // Offer the markets we can actually deliver rather than a full country list —
  // picking a market with no audience here helps nobody. Empty while SHOW_MARKETS
  // is off, which is what hides the chips: one flag, not a second copy of the rule.
  const marketOptions = useMemo(
    () => (SHOW_MARKETS
      ? (inventory?.audience?.countries || []).filter((c) => c.code !== 'unknown').slice(0, 12)
      : []),
    [inventory],
  );

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  /**
   * This account's applications.
   *
   * The whole list, from the checker, vouched for by our backend's view of the login
   * session, so it loads on arrival for every login type with no prompt. Only when
   * that fails (no session it can verify) does it fall back to the references this
   * device already holds, which are proof on their own: a reference IS the credential
   * the rest of this page uses. `forceSigned` is the "Show my products" button, the
   * one path allowed to ask a wallet for a signature.
   *
   * On react-query rather than a fetch-on-mount effect, like the inventory and rate
   * card above it, so the account key handles invalidation on a login change for us.
   */
  const listMine = useCallback(async () => {
    try {
      return await fetchMyApplications(user, { prompt: forceSigned });
    } catch (err) {
      const cached = forceSigned ? [] : rememberedReferences(user);
      if (!cached.length) throw err;
      const rows = await Promise.all(cached.map((ref) => fetchApplication(ref)
        .then((r) => ({ ...r, reference: ref }))
        .catch(() => null)));   // a stale reference is not an error worth showing
      return rows.filter(Boolean);
    }
  }, [user, forceSigned]);

  const {
    data: mine,
    isFetching: mineBusy,
    error: mineError,
    refetch: refetchMine,
  } = useQuery({
    queryKey: ['advertise-mine', user, forceSigned, refsVersion],
    queryFn: listMine,
    enabled: !!user,
    staleTime: 60 * 1000,
    retry: false,
  });

  const myApps = user ? mine : null;
  // What the wizard is working on: the product step 1 just created, or the one a
  // "Have us make the video": chosen in the spot panel, charged on the flight, so
  // it cannot live inside either one.
  const [bookProduction, setBookProduction] = useState({ wanted: false, brief: '' });

  // The enrollment wizard. `wizRef` is the product once step 1 has created it, which
  // is what unlocks the later steps: there is nothing to upload to, or book against,
  // until it exists.
  const [wizStep, setWizStep] = useState(1);
  // Seeded from storage the first time a saved enrollment is seen, then left alone
  // so the user can move freely. `seededFor` is the reference it was seeded for, so
  // a different product seeds again but the same one never re-snaps.
  const seededFor = useRef(null);
  const [wizExit, setWizExit] = useState(false);
  const [wizKill, setWizKill] = useState(false);
  // What they are making. It decides the file type, the copy, whether the labelling
  // section applies at all, and which format step 3 books — so it is asked once,
  // here, rather than inferred later from whatever happened to be uploaded.
  // What the wizard's plain-language choice means to the rate card. Kept as a map so
  // a new format is one line here rather than another arm on a ternary.
  const WIZ_FORMAT = AD_TYPE_FORMAT;
  const [wizType, setWizType] = useState('video');

  const [wizKilling, setWizKilling] = useState(false);

  // An enrollment in progress survives a refresh. Without this, submitting step 1
  // and reloading dropped you back on an empty form with a product already created
  // server-side — the worst of both, since re-submitting then hits the duplicate
  // guard. Read once per account; the query re-fetches the product it names.
  const saved = useMemo(() => readWizard(user), [user, refsVersion]);

  // The restore. Deliberately an assignment during render rather than an effect:
  // it has to be in place for the FIRST paint, or the wizard shows step 1 and the
  // wrong ad type for a frame before correcting itself.
  if (saved?.reference && seededFor.current !== saved.reference) {
    seededFor.current = saved.reference;
    if (saved.step && saved.step !== wizStep) setWizStep(saved.step);
    if (saved.adType && saved.adType !== wizType) setWizType(saved.adType);
  }
  const { data: wizSaved } = useQuery({
    queryKey: ['advertise-wizard', user, saved?.reference],
    queryFn: () => fetchApplication(saved.reference).then((r) => ({ ...r, reference: saved.reference })),
    enabled: !!user && !!saved?.reference,
    staleTime: 30 * 1000,
    retry: false,
  });

  // previous visit left half-finished.
  const wizRef = (receipt && receipt.reference) ? receipt : (wizSaved || null);
  // Math.max() used to decide this, so that a restored step won on first render.
  // It also meant "Back to your ad" did nothing: setting step 2 while storage still
  // said 3 resolved to max(2,3) = 3, every time. The restored value now seeds the
  // state once, and after that the state is simply the truth.
  const wizAt = wizStep;

  /** Move the wizard, remembering where it got to and what it is making. */
  const goStep = (n, type) => {
    setWizStep(n);
    if (wizRef?.reference) rememberWizard(user, wizRef.reference, n, type || wizType);
  };

  // The rate card also carries the slot length, which is the limit the upload
  // control enforces. One source for it rather than a number typed into the UI.
  // Keyed on the open application, because a negotiated rate is per advertiser: the
  // page shows the public rate card until you open yours, and your own rate after.
  // Quoting the default and then charging the negotiated one would be the worst of
  // both, so the key has to include the reference.
  const { data: rawPricing } = useQuery({
    // Whichever product is in play: the one opened from My products, or the one the
    // wizard is enrolling. Keyed on lookupRef alone, the wizard never passed a
    // reference at all and quoted the PUBLIC rate card while booking against an
    // advertiser who had been given their own rate.
    queryKey: ['advertise-pricing', lookupRef.trim() || wizRef?.reference || null, tickerEnabledFor(user)],
    queryFn: () => fetchPricing(lookupRef.trim() || wizRef?.reference || undefined, { beta: tickerEnabledFor(user) }),
    staleTime: INVENTORY_STALE_MS,
    retry: false,
  });
  /* A format the checker marks `beta` is hidden from everyone outside the beta, here
   * once, so the rate card, the picker and the booking form all agree. Hiding it is a
   * courtesy: the checker refuses the booking either way. */
  const pricing = useMemo(() => {
    if (!rawPricing?.formats) return rawPricing;
    const showBeta = tickerEnabledFor(user);
    return { ...rawPricing, formats: rawPricing.formats.filter((f) => !f.beta || showBeta) };
  }, [rawPricing, user]);

  // The page was one long scroll that mixed three unrelated jobs: reading what is
  // for sale, filling in a form, and managing work already in flight. Tabs so each
  // one is a place you can be, rather than a stretch of page you have to find.
  const [tab, setTab] = useState('general');
  /* Which part of ONE product you are looking at. Booking, the flights that are live
     and the ones that are done are three different jobs, and a single scroll made you
     hunt for whichever one you came for. */
  const [ptab, setPtab] = useState('book');
  /* Where Book a spot has got to. It was one page holding an upload panel, a booking
     form and every flight ever booked, which asked somebody to work out the order for
     themselves. */
  const [bookStep, setBookStep] = useState(1);
  // What a product's "Book a spot" is booking, chosen first in step 1. See AdTypePicker.
  const [bookType, setBookType] = useState('video');
  const TABS = [
    { id: 'general', label: t('ads.tabs.general') },
    { id: 'wizard', label: t('ads.tabs.wizard') },
    { id: 'mine', label: t('ads.tabs.mine') },
  ];

  const PRODUCT_TABS = [
    { id: 'book', label: t('ads.productTabs.book') },
    { id: 'active', label: t('ads.productTabs.active') },
    { id: 'history', label: t('ads.productTabs.history') },
  ];

  const toggleMarket = (code) => setForm((f) => ({
    ...f,
    markets: f.markets.includes(code) ? f.markets.filter((m) => m !== code) : [...f.markets, code],
  }));

  const conceptLeft = 20 - form.creativeConcept.trim().length;
  // Only bites when they actually asked us to make the video — an untouched brief
  // must not block the button for everyone else. Matches the backend's minimum.
  const briefLeft = form.wantProduction ? 20 - form.productionBrief.trim().length : 0;

  // Closed testing. Gated here rather than at the route so a typed-in URL is shut
  // too, not just a link nobody is showing yet. The checker refuses writes from
  // accounts outside the beta regardless — this is the courtesy, not the lock.
  //
  // MUST stay below every hook above: `user` arrives asynchronously, so an early
  // return placed higher would run a different number of hooks before and after
  // login and React would tear the component down instead of revealing the page.
  if (!adsEnabledFor(user)) return <NotFound />;

  async function onSubmit(e) {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    // Hoisted out of the try so the receipt can carry it on the duplicate path too:
    // the upload below needs an owner, and by then the form has been cleared.
    const hiveAccount = String(user || '').trim().toLowerCase().replace(/^@/, '');
    try {
      const payload = {
        hiveAccount,
        projectName: form.projectName.trim(),
        website: form.website.trim() || undefined,
        contact: form.contact.trim(),
        category: form.category,
        creativeConcept: form.creativeConcept.trim(),
        markets: form.markets,
      };
      const budget = parseFloat(form.budgetHbd);
      if (Number.isFinite(budget) && budget > 0) payload.budgetHbd = budget;
      if (form.wantProduction) {
        payload.production = { requested: true, brief: form.productionBrief.trim() };
      }

      const res = await submitApplication(payload);
      // On this device from now on, so the next visit finds it without a signature.
      rememberReference(hiveAccount, res.reference);
      setRefsVersion((v) => v + 1);   // so it shows up under "Your applications" now
      setWizStep(2);                  // step 1 produced the product the rest hangs off
      rememberWizard(hiveAccount, res.reference, 2);
      setReceipt({ ...res, hiveAccount, production: form.wantProduction, projectName: form.projectName });
      setForm(EMPTY_FORM);
      toast.success(t('ads.apply.registered'));
    } catch (err) {
      // The backend returns the reference on a duplicate, which is exactly what
      // someone re-submitting has lost — surface it instead of a bare error.
      if (err.status === 409 && err.body?.reference) {
        rememberReference(hiveAccount, err.body.reference);
        setRefsVersion((v) => v + 1);
        setReceipt({ reference: err.body.reference, status: err.body.status, message: err.message, hiveAccount });
        toast.info(err.message);
      } else {
        toast.error(err.message || t('ads.apply.registerFailed'));
      }
    } finally {
      setSubmitting(false);
    }
  }



  // The product form, defined once and rendered in two places: the Apply tab and
  // step 1 of the wizard. Duplicating it would mean two forms drifting apart on a
  // page whose whole problem was that it had too many places to fill things in.
  const productForm = (
          <form className="mkt-form" onSubmit={onSubmit}>
            {/* Not an input any more. The account is whoever is logged in: typing it
                invited a typo in the one field that decides who owns the application
                and which wallet the booking is paid from. Stated plainly instead, so
                nobody has to guess which account they are applying as. */}
            <div className="mkt-field mkt-field-wide mkt-asaccount">
              <span className="mkt-label">{t('ads.apply.applyingAs')}</span>
              <strong>@{user}</strong>
              <span className="mkt-hint">
                {t('ads.apply.applyingAsHint')}
              </span>
            </div>

            <div className="mkt-field">
              <label htmlFor="mkt-project">{t('ads.apply.productName')}</label>
              <input id="mkt-project" value={form.projectName} onChange={set('projectName')} required />
            </div>

            <div className="mkt-field">
              <label htmlFor="mkt-website">{t('ads.apply.website')} <span className="mkt-optional">{t('ads.book.optional')}</span></label>
              <input id="mkt-website" type="url" value={form.website} onChange={set('website')} placeholder="https://" />
              <span className="mkt-hint">{t('ads.apply.websiteHint')}</span>
            </div>

            <div className="mkt-field">
              <label htmlFor="mkt-contact">{t('ads.apply.contact')}</label>
              <input
                id="mkt-contact"
                value={form.contact}
                onChange={set('contact')}
                placeholder={t('ads.apply.contactPlaceholder')}
                required
              />
            </div>

            <div className="mkt-field">
              <label htmlFor="mkt-category">{t('ads.apply.category')}</label>
              <select id="mkt-category" value={form.category} onChange={set('category')} required>
                <option value="" disabled>{t('ads.attach.chooseOne')}</option>
                {AD_CATEGORIES.map((c) => <option key={c.id} value={c.id}>{t(c.labelKey)}</option>)}
              </select>
            </div>

            <div className="mkt-field">
              <label htmlFor="mkt-budget">{t('ads.apply.budget')} <span className="mkt-optional">{t('ads.book.optional')}</span></label>
              <input
                id="mkt-budget"
                type="number"
                min="0"
                step="1"
                inputMode="decimal"
                value={form.budgetHbd}
                onChange={set('budgetHbd')}
                placeholder="250"
              />
              <span className="mkt-hint">{t('ads.apply.budgetHint')}</span>
            </div>

            {marketOptions.length > 0 && (
              <div className="mkt-field mkt-field-wide">
                <span className="mkt-label">{t('ads.apply.markets')} <span className="mkt-optional">{t('ads.book.optional')}</span></span>
                <div className="mkt-chips">
                  {marketOptions.map((c) => (
                    <button
                      key={c.code}
                      type="button"
                      className={`mkt-chip${form.markets.includes(c.code) ? ' selected' : ''}`}
                      aria-pressed={form.markets.includes(c.code)}
                      onClick={() => toggleMarket(c.code)}
                    >
                      {countryName(c.code)} <span className="mkt-chip-share">{c.sharePct}%</span>
                    </button>
                  ))}
                </div>
                <span className="mkt-hint">{t('ads.apply.marketsHint')}</span>
              </div>
            )}

            <div className="mkt-field mkt-field-wide">
              <label htmlFor="mkt-concept">{t('ads.apply.concept')}</label>
              <textarea
                id="mkt-concept"
                rows={5}
                value={form.creativeConcept}
                onChange={set('creativeConcept')}
                placeholder={t('ads.apply.conceptPlaceholder')}
                required
              />
              <span className={`mkt-hint${conceptLeft > 0 ? ' mkt-hint-short' : ''}`}>
                {conceptLeft > 0 ? t('ads.apply.moreChars', { count: conceptLeft }) : t('ads.apply.enough')}
              </span>
            </div>

            <div className="mkt-production">
              <label className="mkt-check">
                <input
                  type="checkbox"
                  checked={form.wantProduction}
                  onChange={(e) => setForm((f) => ({ ...f, wantProduction: e.target.checked }))}
                />
                <span>
                  {pricing?.productionFeeHbd
                    ? <Trans i18nKey="ads.apply.productionFee" values={{ fee: pricing.productionFeeHbd }} components={{ b: <strong /> }} />
                    : <Trans i18nKey="ads.apply.production" components={{ b: <strong /> }} />}
                </span>
              </label>
              {form.wantProduction && (
                <div className="mkt-field mkt-field-wide">
                  <label htmlFor="mkt-apply-brief">{t('ads.apply.briefLabel')}</label>
                  <textarea
                    id="mkt-apply-brief"
                    rows={4}
                    value={form.productionBrief}
                    onChange={set('productionBrief')}
                    placeholder={t('ads.apply.briefPlaceholder')}
                    required
                  />
                  <span className={`mkt-hint${briefLeft > 0 ? ' mkt-hint-short' : ''}`}>
                    {briefLeft > 0
                      ? t('ads.apply.briefMore', { count: briefLeft })
                      : t('ads.production.enough')}
                  </span>
                </div>
              )}
              {!form.wantProduction && (
                <span className="mkt-hint">
                  {t('ads.apply.haveVideo')}
                </span>
              )}
            </div>

            <div className="mkt-actions">
              <button type="submit" className="mkt-outline" disabled={submitting || briefLeft > 0}>
                {submitting ? t('ads.apply.sending') : t('ads.apply.register')}
              </button>
              <span className="mkt-fine">{t('ads.apply.reviewedByPerson')}</span>
            </div>
          </form>
  );

  return (
    <div className="mkt-page">
      <SEOHead
        title={t('ads.page.title')}
        description={t('ads.page.description')}
        url="https://3speak.tv/advertise"
      />
      <header className="mkt-header">
        <MdCampaign className="mkt-header-icon" aria-hidden="true" />
        <div>
          <h1>{t('ads.page.title')}</h1>
          <p className="mkt-lede">
            <Trans i18nKey="ads.page.lede" components={{ b: <strong /> }} />
          </p>
        </div>
      </header>

      {/* Only for a signed-in account with an empty wallet: where HIVE comes from. */}
      <FundsNotice user={user} hbdPerHive={pricing?.hbdPerHive} />

      <div className="mkt-tabs" role="tablist" aria-label={t('ads.page.tablistLabel')}>
        {TABS.map((tb) => (
          <button
            key={tb.id}
            type="button"
            role="tab"
            id={`mkt-tab-${tb.id}`}
            aria-selected={tab === tb.id}
            aria-controls={`mkt-panel-${tb.id}`}
            className={`mkt-tab${tab === tb.id ? ' selected' : ''}`}
            onClick={() => setTab(tb.id)}
          >
            {tb.label}
            {tb.id === 'mine' && myApps?.length ? (
              <span className="mkt-tab-count">{myApps.length}</span>
            ) : null}
          </button>
        ))}
      </div>

      <div
        role="tabpanel"
        id="mkt-panel-general"
        aria-labelledby="mkt-tab-general"
        hidden={tab !== 'general'}
      >
      {/* Three cards for the three things this page deals in, in the order you meet
          them. It replaced a four-step "how it works" list because the steps did not
          say what the nouns WERE, and the page is full of them: people could not tell
          whether they were filling in a product, a video or a booking. Numbered
          because the order is real: no booking without a product. */}
      <section className="mkt-intro">
        <h2><FaRocket aria-hidden="true" /> {t('ads.general.stepsTitle')}</h2>
        <p className="mkt-intro-lede">
          {t('ads.general.stepsLede')}
        </p>
        <ol className="mkt-steps">
          <li>
            <strong>{t('ads.general.product.title')}</strong>
            <span>{t('ads.general.product.what')}</span>
            <span className="mkt-step-detail">
              {t('ads.general.product.detail')}
            </span>
          </li>
          <li>
            <strong>{t('ads.general.ads.title')}</strong>
            <span>
              {t('ads.general.ads.what')}
            </span>
            <span className="mkt-step-detail">
              {pricing?.maxCreativeSeconds
                ? t('ads.general.ads.detailMax', { seconds: pricing.maxCreativeSeconds })
                : t('ads.general.ads.detail')}
            </span>
          </li>
          <li>
            <strong>{t('ads.general.bookings.title')}</strong>
            <span>{t('ads.general.bookings.what')}</span>
            <span className="mkt-step-detail">
              {t('ads.general.bookings.detail')}
            </span>
          </li>
        </ol>
        <p className="mkt-fine">
          {t('ads.general.pricedNote')}
        </p>
      </section>

      {/* The way in. The overview explains the thing; this is the one control that
          starts it, so it sits above the detail rather than under it. */}
      <button type="button" className="mkt-enroll-cta" onClick={() => { setWizStep(wizRef ? 2 : 1); setTab('wizard'); }}>
        <MdCampaign aria-hidden="true" />
        {t('ads.general.enrollCta')}
      </button>

      <section className="mkt-section">
        <h2><FaLayerGroup aria-hidden="true" /> {t('ads.general.formatsTitle')}</h2>
        {pricing?.formats?.length ? (
          <p className="mkt-intro-lede">
            {savingAt(7, pricing)
              ? t('ads.general.pricingIntroSaving', { week: savingAt(7, pricing), month: savingAt(30, pricing) })
              : t('ads.general.pricingIntro')}
            {/* Named in real numbers rather than described. "Cheaper for longer" is a
                claim every rate card makes; a week at 25% off is a reason to book a
                week. Both figures come from the server's own curve, so they cannot
                drift from what the booking form will quote. */}
            {' '}{t(pricing.minDays
              ? (pricing.maxDays ? 'ads.general.examplesFromTo' : 'ads.general.examplesFrom')
              : (pricing.maxDays ? 'ads.general.examplesTo' : 'ads.general.examples'), {
              seconds: EXAMPLE_SECONDS,
              days: Math.max(EXAMPLE_DAYS, pricing.minDays || 0),
              count: pricing.minDays || 0,
              max: pricing.maxDays,
            })}
          </p>
        ) : pricing?.pricePerSecondDayHbd ? (
          // Fallback for a checker too old to send the rate card: one product, one price.
          <p className="mkt-headline-price">
            <Trans i18nKey="ads.general.headlinePrice" values={{ price: pricing.pricePerSecondDayHbd }} components={{ b: <strong /> }} />
            {pricing.minDays && pricing.maxCreativeSeconds ? (
              <span className="mkt-hint">
                {' '}· {t('ads.general.headlineExample', {
                  seconds: pricing.maxCreativeSeconds,
                  minDays: pricing.minDays,
                  price: flightPrice(pricing.minDays, pricing.pricePerSecondDayHbd, pricing.maxCreativeSeconds, pricing.dayCurveK),
                  hive: hiveEquivalent(flightPrice(pricing.minDays, pricing.pricePerSecondDayHbd, pricing.maxCreativeSeconds, pricing.dayCurveK), pricing.hbdPerHive) != null
                    ? ` ${t('ads.book.aboutHive', { hive: hiveEquivalent(flightPrice(pricing.minDays, pricing.pricePerSecondDayHbd, pricing.maxCreativeSeconds, pricing.dayCurveK), pricing.hbdPerHive) })}`
                    : '',
                })}
              </span>
            ) : null}
          </p>
        ) : null}
        {/* Every number here comes from /advertise/pricing rather than the copy: a
            hardcoded price is a promise the server has no idea it made. */}
        <RateCard pricing={pricing} />
        <p>
          {t('ads.general.flatBooking')}
        </p>
        <p>
          {t('ads.general.quotedForecast')}
        </p>
      </section>

      <section className="mkt-section">
        <h2><FaUsers aria-hidden="true" /> {t('ads.general.audienceTitle')}</h2>
        <InventoryPanel data={inventory} isLoading={isLoading} error={error} />
      </section>

      {/* Two audiences who are not buying anything, side by side: the people whose
          videos carry the ads and the people who watch them. Both are paid, and an
          advertiser reading this page should see that the money goes somewhere real. */}
      <div className="mkt-audience-pair">
        <section className="mkt-section mkt-creators">
          <h2><FaVideo aria-hidden="true" /> {t('ads.general.creatorTitle')}</h2>
          <p>
            {t('ads.prompt.lede')}
          </p>
          <p className="mkt-fine">
            {t('ads.general.creatorNote')}
          </p>
        </section>

        <section className="mkt-section mkt-viewers">
          <h2><FaTv aria-hidden="true" /> {t('ads.general.viewerTitle')}</h2>
          <p>
            {t('ads.general.viewerText')}
          </p>
          <p className="mkt-fine">
            {t('ads.general.viewerNote')}
          </p>
        </section>
      </div>
      </div>

      <div
        role="tabpanel"
        id="mkt-panel-wizard"
        aria-labelledby="mkt-tab-wizard"
        hidden={tab !== 'wizard'}
      >
        <section className="mkt-section">
          {/* One flow instead of three places to be. Each step is a thing the
              advertiser has to produce anyway; the wizard only decides the order and
              refuses to ask for the next one before the last one exists. */}
          <ol className="mkt-wiz-nav">
            {WIZARD_STEPS.map((label, i) => {
              const n = i + 1;
              const state = n < wizAt ? ' done' : (n === wizAt ? ' current' : '');
              return (
                <li key={label} className={`mkt-wiz-step${state}`} aria-current={n === wizStep ? 'step' : undefined}>
                  <span className="mkt-wiz-num">{n < wizStep ? '✓' : n}</span>
                  <span>{t(label)}</span>
                </li>
              );
            })}
          </ol>

          {wizRef && (
            <div className="mkt-wiz-cancel">
              <span className="mkt-fine">
                <Trans i18nKey="ads.wiz.workingOn" values={{ name: wizRef.projectName || t('ads.wiz.yourProduct') }} components={{ b: <strong /> }} />
              </span>
              <button type="button" className="mkt-linkish" onClick={() => setWizKill(true)}>
                {t('ads.wiz.cancelDelete')}
              </button>
            </div>
          )}

          {wizKill && (
            // Deleting is the one thing here that cannot be undone, so it asks first
            // and says exactly what goes.
            <div className="mkt-panel mkt-panel-muted mkt-wiz-exit">
              <p style={{ margin: 0 }}>
                <Trans i18nKey="ads.wiz.deleteConfirm" components={{ b: <strong /> }} />
              </p>
              <div className="mkt-wiz-actions">
                <button
                  type="button"
                  className="mkt-outline"
                  disabled={wizKilling}
                  onClick={async () => {
                    setWizKilling(true);
                    try {
                      await discardProduct(wizRef.reference);
                      clearWizard(user);
                      setReceipt(null);
                      setForm(EMPTY_FORM);
                      setWizStep(1);
                      setRefsVersion((v) => v + 1);
                      setWizKill(false);
                      toast.success(t('ads.wiz.deleted'));
                    } catch (err) {
                      toast.error(err.message || t('ads.wiz.deleteFailed'));
                    } finally { setWizKilling(false); }
                  }}
                >
                  {wizKilling ? t('ads.wiz.deleting') : t('ads.wiz.yesDelete')}
                </button>
                <button type="button" className="mkt-secondary" onClick={() => setWizKill(false)}>
                  {t('ads.wiz.keepIt')}
                </button>
              </div>
            </div>
          )}

          {!user ? (
            <div className="mkt-panel mkt-panel-muted">
              <p style={{ margin: 0 }}>
                {t('ads.wiz.loginPrompt')}
              </p>
              {/* Sign up rides the same ENABLE_BUTRAUTH gate as the one in the nav, so
                  the two never disagree about whether an account can be made yet. With
                  it off, Log in is the only action and takes the primary styling. */}
              <div className="mkt-signin-actions">
                <button
                  type="button"
                  className={ENABLE_BUTRAUTH ? 'mkt-secondary' : 'mkt-primary'}
                  onClick={() => openLoginModal?.('login')}
                >
                  {t('common.actions.login')}
                </button>
                {ENABLE_BUTRAUTH && (
                  <button
                    type="button"
                    className="mkt-primary"
                    onClick={() => openLoginModal?.('signup')}
                  >
                    {t('common.actions.signUp')}
                  </button>
                )}
              </div>
            </div>
          ) : (
            <>
              {wizAt === 1 && (
                <>
                  <h2>{t('ads.wiz.tellUs')}</h2>
                  <p className="mkt-fine">
                    {t('ads.wiz.tellUsHint')}
                  </p>
                  {productForm}
                </>
              )}

              {wizAt === 2 && wizRef && (
                <>
                  <h2>{t('ads.wizardSteps.ad')}</h2>

                  <AdTypePicker
                    value={wizType}
                    pricing={pricing}
                    onChange={(type) => { setWizType(type); if (wizRef?.reference) rememberWizard(user, wizRef.reference, wizAt, type); }}
                  />
                  {wizType === 'ticker' ? (
                    <TickerPanel
                      reference={wizRef.reference}
                      account={wizRef.hiveAccount}
                      productName={wizRef.projectName}
                      format={pricing?.formats?.find((f) => f.key === 'video_ticker')}
                      onCreatives={setWizCreativeList}
                    />
                  ) : (
                  <CreativePanel
                    reference={wizRef.reference}
                    account={wizRef.hiveAccount}
                    maxSeconds={pricing?.maxCreativeSeconds}
                    bannerSpec={pricing?.formats?.find((f) => f.key === 'video_banner')?.creativeSpec}
                    pending={wizRef.status !== 'approved'}
                    production={!!wizRef.production}
                    adType={wizType}
                    single
                    /* A banner carries no disclosure overlay of its own — the label is
                       part of the burned image — so asking for a logo and slogan here
                       would collect something that is never drawn. */
                    brand={wizType === 'banner' ? null : { productName: wizRef.projectName, logoUrl: null, slogan: null }}
                    offer={wizType === 'banner' ? null : { ...bookProduction, feeHbd: pricing?.productionFeeHbd, onChange: setBookProduction }}
                    onCreatives={setWizCreativeList}
                  />
                  )}
                  <div className="mkt-wiz-actions">
                    {/* Outline, not a red fill, and only once "Your ad" is complete. */}
                    <button
                      type="button"
                      className="mkt-outline"
                      disabled={!!adStepMissing(wizType, wizCreativeList, bookProduction)}
                      onClick={() => goStep(3)}
                    >
                      {t('ads.wiz.nextBook')}
                    </button>
                    {adStepMissing(wizType, wizCreativeList, bookProduction)
                      ? <span className="mkt-hint">{t(adStepMissing(wizType, wizCreativeList, bookProduction))}</span>
                      : null}
                    {/* Stopping here is a legitimate ending, not a failure — but it is
                        not a booked ad, and saying so now is kinder than letting them
                        find out when nothing ever runs. */}
                    <button type="button" className="mkt-linkish" onClick={() => setWizExit(true)}>
                      {t('ads.wiz.finishLater')}
                    </button>
                  </div>
                </>
              )}

              {wizAt === 3 && wizRef && (
                <>
                  <h2>{t('ads.wizardSteps.book')}</h2>
                  <CampaignPanel
                    reference={wizRef.reference}
                    pricing={pricing}
                    creatives={wizCreativeList}
                    // A ticker has no video for us to make, so a production request ticked
                    // earlier for a video ad must not ride along and charge its fee.
                    production={wizType === 'ticker' ? null : bookProduction}
                    awaitingApproval={wizRef.status !== 'approved'}
                    lockFormat={WIZ_FORMAT[wizType] || 'video_roll'}
                    account={wizRef.hiveAccount}
                    productName={wizRef.projectName}
                  />
                  <div className="mkt-wiz-actions">
                    <button type="button" className="mkt-secondary" onClick={() => goStep(2)}>
                      {t('ads.wiz.backToAd')}
                    </button>
                  </div>
                </>
              )}

              {wizExit && (
                <div className="mkt-panel mkt-panel-muted mkt-wiz-exit">
                  <p style={{ margin: 0 }}>
                    <Trans i18nKey="ads.wiz.savedNotFinished" components={{ b: <strong /> }} />
                  </p>
                  <p className="mkt-fine">
                    <Trans i18nKey="ads.wiz.pickUp" components={{ b: <strong /> }} />
                  </p>
                  <div className="mkt-wiz-actions">
                    <button type="button" className="mkt-primary" onClick={() => { setWizExit(false); goStep(3); }}>
                      {t('ads.wiz.bookNow')}
                    </button>
                    <button
                      type="button"
                      className="mkt-secondary"
                      onClick={() => {
                        setWizExit(false);
                        if (wizRef?.reference) { setLookupRef(wizRef.reference); setLookup(wizRef); }
                        setTab('mine');
                      }}
                    >
                      {t('ads.wiz.leaveForNow')}
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </section>
      </div>

      <div
        role="tabpanel"
        id="mkt-panel-mine"
        aria-labelledby="mkt-tab-mine"
        hidden={tab !== 'mine'}
      >
        {/* Master/detail. The list used to sit above the detail, so opening a product
            pushed everything down and you lost sight of which one you were looking at
            once you scrolled into its bookings. */}
        <div className="mkt-stack">
          <div className="mkt-products">
            <div className="mkt-split-head">
              <h2>{t('ads.mine.title')}</h2>
              <div className="mkt-head-actions">
              {user && (() => {
                /* The server allows many products but only ONE application under review
                   at a time, so that a reviewer is not reading the same person twice.
                   Saying so on the button beats letting somebody fill in the whole form
                   and meet a 409 at the end of it. */
                const pending = (myApps || []).find((a) => a.status === 'pending');
                return (
                <button
                  type="button"
                  className="mkt-newproduct"
                  disabled={!!pending}
                  title={pending
                    ? t('ads.mine.pendingTitle', { name: pending.projectName || t('ads.mine.aProduct') })
                    : t('ads.mine.registerAnother')}
                  onClick={() => {
                    /* A second product is a fresh enrollment, so the wizard has to be
                       genuinely empty. Clearing storage alone is not enough: `receipt`
                       holds the product registered earlier in this session and wins over
                       storage when wizRef is resolved, so the wizard would reopen the one
                       you just finished instead of starting a new one. */
                    clearWizard(user);
                    setReceipt(null);
                    setRefsVersion((v) => v + 1);
                    setWizStep(1);
                    setLookupRef('');
                    setTab('wizard');
                  }}
                >
                  <span aria-hidden="true">+</span> {t('ads.mine.new')}
                </button>
                );
              })()}
              </div>
            </div>

            {/* Said in the panel too, not only in a tooltip nobody hovers on a phone. */}
            {user && (myApps || []).some((a) => a.status === 'pending') && (
              <p className="mkt-fine">
                {t('ads.mine.onePending')}
              </p>
            )}

            {!user && (
              <div className="mkt-panel mkt-panel-muted">
                <p style={{ margin: 0 }}>
                  {t('ads.mine.loginPrompt')}
                </p>
                <button type="button" className="mkt-secondary" onClick={() => openLoginModal?.('login')}>
                  {t('common.actions.login')}
                </button>
              </div>
            )}

            {mineBusy && !myApps && <p className="mkt-fine">{t('ads.mine.looking')}</p>}

            {mineError && (
              <div className="mkt-panel mkt-panel-muted">
                <p style={{ margin: 0 }}>{mineError.message || t('ads.mine.loadFailed')}</p>
                {/* The way back. Without it the only control left was a code nobody has. */}
                <button
                  type="button"
                  className="mkt-secondary"
                  onClick={() => { if (forceSigned) refetchMine(); else setForceSigned(true); }}
                >
                  {t('ads.mine.showMine')}
                </button>
              </div>
            )}

            {myApps && myApps.length === 0 && !mineBusy && (
              <p className="mkt-fine">
                {t('ads.mine.empty', { user })}
              </p>
            )}

            {myApps && myApps.length > 0 && (
              <ul className="mkt-mine-strip">
                {myApps.map((a) => (
                  <li key={a.reference}>
                    {/* The whole row is the control. A separate "Open" button made the
                        row look clickable and then ignored the click everywhere else. */}
                    <button
                      type="button"
                      className={`mkt-mine-item${a.reference === lookupRef.trim() ? ' selected' : ''}`}
                      aria-current={a.reference === lookupRef.trim() ? 'true' : undefined}
                      onClick={() => { setLookupRef(a.reference); setLookup(a); }}
                    >
                      <span className="mkt-mine-body">
                        <strong>{a.projectName}</strong>
                        <span className="mkt-mine-meta">
                          <code>{a.reference}</code>
                          {a.production?.requested ? t('ads.mine.makingIt') : null}
                        </span>
                      </span>
                      <StatusBadge status={a.status} />
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {/* A wallet login has a key in the browser, so proving who it is means a
                signing prompt. Springing that on someone the moment the page loads is
                worse than a button, so this is the button. Butter Auth and HiveSigner
                never reach here — the server verifies those sessions on its own. */}
            {user && !myApps && !mineBusy && !mineError && (
              <>
                <p className="mkt-fine">
                  {t('ads.mine.signOnce')}
                </p>
                <button type="button" className="mkt-secondary" onClick={() => setForceSigned(true)}>
                  {t('ads.mine.showMine')}
                </button>
              </>
            )}

            {myApps && myApps.length > 0 && (
              <p className="mkt-fine">
                {t('ads.mine.otherBrowser')}{' '}
                <button type="button" className="mkt-linkish" onClick={() => setForceSigned(true)}>
                  {t('ads.mine.fetchFull')}
                </button>
              </p>
            )}

          </div>

          <div className="mkt-split-main">
            {lookup ? (
              <div className="mkt-lookup-result">
                <div className="mkt-detail-head">
                  <div>
                    <h3>{lookup.projectName}</h3>
                    <span className="mkt-mine-meta">
                      @{lookup.hiveAccount} · <code>{lookupRef.trim()}</code>
                    </span>
                  </div>
                  <StatusBadge status={lookup.status} />
                </div>
                {lookup.note ? <p className="mkt-lookup-note">{lookup.note}</p> : null}

                {(lookup.status === 'pending' || lookup.status === 'approved') && (
                  <div className="mkt-ptabs" role="tablist" aria-label={t('ads.mine.thisProduct')}>
                    {PRODUCT_TABS.map((tb) => (
                      <button
                        key={tb.id}
                        type="button"
                        role="tab"
                        aria-selected={ptab === tb.id}
                        className={`mkt-ptab${ptab === tb.id ? ' selected' : ''}`}
                        onClick={() => setPtab(tb.id)}
                      >
                        {tb.label}
                      </button>
                    ))}
                  </div>
                )}

                {ptab === 'book' && (lookup.status === 'pending' || lookup.status === 'approved') && (
                  <ol className="mkt-wiz-nav">
                    {BOOK_STEPS.map((label, i) => {
                      const n = i + 1;
                      const state = n < bookStep ? ' done' : (n === bookStep ? ' current' : '');
                      return (
                        <li
                          key={label}
                          className={`mkt-wiz-step${state}`}
                          aria-current={n === bookStep ? 'step' : undefined}
                        >
                          <span className="mkt-wiz-num">{n < bookStep ? '✓' : n}</span>
                          <span>{t(label)}</span>
                        </li>
                      );
                    })}
                  </ol>
                )}

                {/* Uploading is open to a pending applicant; booking is not. Nothing can
                    run either way until the product is approved and a booking is paid for,
                    so the split is where it belongs.

                    Kept MOUNTED on every tab rather than rendered only on its own: this
                    panel owns the creative list, and the attach pickers on a flight under
                    Active spots are filled from it. Rendering it conditionally left them
                    empty for anyone who opened a product straight into another tab. */}
                {(lookup.status === 'pending' || lookup.status === 'approved') && (
                  <div style={{ display: ptab === 'book' && bookStep === 1 ? undefined : 'none' }}>
                  <AdTypePicker value={bookType} onChange={setBookType} pricing={pricing} />
                  {/* The upload panel stays MOUNTED for the ticker too (hidden), because it
                      owns the creative list the Active spots pickers are filled from. */}
                  <div style={{ display: bookType === 'ticker' ? 'none' : undefined }}>
                  <CreativePanel
                    reference={lookupRef.trim()}
                    account={lookup.hiveAccount}
                    maxSeconds={pricing?.maxCreativeSeconds}
                    bannerSpec={pricing?.formats?.find((f) => f.key === 'video_banner')?.creativeSpec}
                    onCreatives={setCreativeList}
                    pending={lookup.status !== 'approved'}
                    production={!!lookup.production?.requested}
                    adType={bookType}
                    // The label overlay and "we make it" belong to video spots only. A
                    // banner carries its own disclosure in the picture.
                    brand={isSpotType(bookType) ? {
                      productName: lookup.projectName,
                      logoUrl: lookup.logoUrl,
                      slogan: lookup.slogan,
                    } : null}
                    offer={isSpotType(bookType) && lookup.status === 'approved' && !lookup.production?.requested ? {
                      ...bookProduction,
                      feeHbd: pricing?.productionFeeHbd,
                      onChange: setBookProduction,
                    } : null}
                  />
                  </div>
                  {bookType === 'ticker' && (
                    <TickerPanel
                      reference={lookupRef.trim()}
                      account={lookup.hiveAccount}
                      productName={lookup.projectName}
                      format={pricing?.formats?.find((f) => f.key === 'video_ticker')}
                      onCreatives={setCreativeList}
                    />
                  )}
                  </div>
                )}
                {/* Booking is open before approval now. The whole thing can be filled
                    in one sitting and reviewed afterwards; nothing reaches a viewer
                    until a person has approved the product AND the ad video, which
                    the server enforces at serving time rather than here. */}
                {(lookup.status === 'pending' || lookup.status === 'approved') && (
                  <CampaignPanel
                    reference={lookupRef.trim()}
                    pricing={pricing}
                    creatives={creativeList}
                    // A production request only means something for a video spot.
                    production={isSpotType(bookType) ? bookProduction : null}
                    awaitingApproval={lookup.status !== 'approved'}
                    // Settled in "Your ad", so the booking form does not ask again.
                    lockFormat={AD_TYPE_FORMAT[bookType] || 'video_roll'}
                    view={ptab}
                    step={ptab === 'book' ? bookStep : null}
                    onBooked={() => setBookStep(3)}
                    account={lookup.hiveAccount}
                    productName={lookup.projectName}
                  />
                )}

                {ptab === 'book' && (lookup.status === 'pending' || lookup.status === 'approved') && (
                  <div className="mkt-wiz-actions">
                    {bookStep === 1 && (() => {
                      const missing = adStepMissing(bookType, creativeList, bookProduction);
                      return (
                        <>
                          <button
                            type="button"
                            className="mkt-outline"
                            disabled={!!missing}
                            onClick={() => setBookStep(2)}
                          >
                            {t('ads.mine.nextBooking')}
                          </button>
                          {missing ? <span className="mkt-hint">{t(missing)}</span> : null}
                        </>
                      );
                    })()}
                    {bookStep === 2 && (
                      <button type="button" className="mkt-outline" onClick={() => setBookStep(1)}>
                        {t('ads.wiz.backToAd')}
                      </button>
                    )}
                    {bookStep === 3 && (
                      <>
                        <button
                          type="button"
                          className="mkt-primary"
                          onClick={() => { setPtab('active'); setBookStep(1); }}
                        >
                          {t('common.actions.done')}
                        </button>
                        <button type="button" className="mkt-outline" onClick={() => setBookStep(2)}>
                          {t('ads.mine.bookAnother')}
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div className="mkt-panel mkt-panel-muted mkt-split-empty">
                <p style={{ margin: 0 }}>
                  {myApps?.length
                    ? t('ads.mine.pickProduct')
                    : t('ads.mine.showUpHere')}
                </p>
              </div>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}
