import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { MdCampaign, MdInfoOutline, MdCheckCircle, MdSchedule, MdCancel, MdVideocam, MdTv } from 'react-icons/md';
import { toastIn } from '../utils/toast';
import { useAppStore } from '../lib/store';
import { transferWithAioha, getOperationUser } from '../hive-api/aioha';
import { adsEnabledFor, ENABLE_BUTRAUTH } from '../utils/config';
import SEOHead from '../components/SEOHead';
import NotFound from './NotFound';
import AdOverlay from '../components/ads/AdOverlay';
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
  identityIsSilent,
  uploadCreative,
  uploadImageAsset,
  uploadLogo,
  saveBranding,
  SLOGAN_MAX,
  fetchCreatives,
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
import './Advertise.scss';

// Every toast from this module is headed "Advertising"; the message becomes the
// line under it. See utils/toast.js.
const toast = toastIn('Advertising');

// The inventory forecast only moves every few hours, so a long stale time keeps
// the page instant on revisit without ever showing a number the backend disowns.
const INVENTORY_STALE_MS = 10 * 60 * 1000;

// Country breakdown and per-market targeting, hidden for now. The numbers behind
// them are real but thin at this scale — a market with a 4% share is a handful of
// sessions a day, and offering it as something to buy promises a precision we
// cannot deliver yet. Flip to true to bring back both the "Who watches" panel and
// the market chips on the form; the backend has accepted `markets` all along.
const SHOW_MARKETS = false;

/** The enrollment steps, in the order they have to happen. */
const WIZARD_STEPS = ['Your product', 'Your ad', 'Book a slot'];

/* Booking, for a product that already exists. Same three things the enrollment
   wizard ends on, minus registering the product itself. */
const BOOK_STEPS = ['Your ad', 'The booking', 'Pay'];

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

function StatTile({ value, label, note }) {
  return (
    <div className="mkt-stat">
      <span className="mkt-stat-value">{value}</span>
      <span className="mkt-stat-label">{label}</span>
      {note ? <span className="mkt-stat-note">{note}</span> : null}
    </div>
  );
}

function InventoryPanel({ data, isLoading, error }) {
  if (isLoading) return <div className="mkt-panel mkt-panel-muted">Loading current availability…</div>;

  if (error) {
    // A 503 means the forecast job has not produced a snapshot yet — that is a
    // different message from "something broke", and an advertiser deserves the
    // honest one rather than a spinner that never resolves.
    // 404 means the whole ad surface is switched off server-side, not that one
    // number is missing — and in that state the form below does NOT work either,
    // so saying it does would send someone into a dead end.
    if (error.status === 404) {
      return (
        <div className="mkt-panel mkt-panel-muted">
          Advertising is switched off at the moment. Nothing here will submit until it is turned back on.
        </div>
      );
    }
    return (
      <div className="mkt-panel mkt-panel-muted">
        {error.status === 503
          ? 'Availability figures are being recalculated. Apply below and we will send you the current numbers with your quote.'
          : 'Availability figures are temporarily unavailable. The form below still works.'}
      </div>
    );
  }
  if (!data) return null;

  const { audience, slots, quality } = data;
  // Mid-roll first: it is what we actually sell, and leading with the bigger
  // pre-roll number would be selling a slot we do not recommend.
  // Plain time order. It used to push pre-roll to the bottom so the biggest number
  // would not lead, but a table of positions that is not in position order reads as
  // broken — the "not recommended" tag carries that argument on its own.
  const ordered = [...(slots || [])].sort((a, b) => a.percent - b.percent);
  const topCountries = (audience?.countries || []).slice(0, 6);

  return (
    <div className="mkt-inventory">
      <div className="mkt-stats">
        <StatTile value={formatCount(audience?.sessionsPerDay)} label="Watch sessions a day" note="Trailing 7 days, after filtering" />
        <StatTile value={formatCount(audience?.videos)} label="Videos in the pool" note={`Last ${data.windowDays} days`} />
        <StatTile value={formatCount(audience?.watchHours)} label="Watch hours" note={`Last ${data.windowDays} days`} />
      </div>

      <div className="mkt-slots">
        <h3>Where an ad can run</h3>
        <div className="mkt-table-wrap">
          <table className="mkt-table">
            <thead>
              <tr>
                <th>Placement</th>
                <th className="num">Plays a day</th>
                <th className="num">Plays a month</th>
                <th className="num">Reach</th>
              </tr>
            </thead>
            <tbody>
              {ordered.map((s) => (
                <tr key={s.percent}>
                  <td>
                    {slotLabel(s)}
                    {s.percent === 0 ? <span className="mkt-tag">not recommended</span> : null}
                  </td>
                  <td className="num">{formatCount(s.perDay)}</td>
                  <td className="num">{formatCount(s.perMonth)}</td>
                  <td className="num">{s.reachPct}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mkt-fine">
          <strong>Not recommended:</strong> an ad before the video reaches more sessions on
          paper, but almost half of all
          watching here stops inside fifteen seconds, so most of those plays land on
          someone who was already leaving. An ad placed further in is counted only when
          the viewer actually got there.
        </p>
      </div>

      {SHOW_MARKETS && topCountries.length > 0 && (
        <div className="mkt-countries">
          <h3>Who watches</h3>
          <ul className="mkt-country-list">
            {topCountries.map((c) => (
              <li key={c.code}>
                <span className="mkt-country-name">{countryName(c.code)}</span>
                <span className="mkt-country-bar" aria-hidden="true">
                  <span style={{ width: `${Math.min(100, c.sharePct * 3)}%` }} />
                </span>
                <span className="mkt-country-share">{c.sharePct}%</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {quality && (
        <p className="mkt-note">
          <span>
            <strong>{quality.removedPct}% of raw traffic is excluded</strong> from these
            figures: sessions under {quality.minEngagedSeconds} seconds, accounts too fast to
            be real viewers, and videos whose creator opted out. What is left is what we sell.
          </span>
        </p>
      )}
    </div>
  );
}

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
  if (!formats?.length) return null;
  return (
    <fieldset className="mkt-group mkt-formats">
      <legend>What you are buying</legend>
      <div className="mkt-format-list" role="radiogroup" aria-label="Ad type">
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
                  <span className="mkt-format-rate-unit"> /sec /day</span>
                </span>
              </span>
              <span className="mkt-format-blurb">{f.blurb}</span>
              <span className="mkt-format-meta">
                {`You supply ${suppliesFor(f).toLowerCase()}`}
                {' · up to '}{f.maxSeconds}s
                {f.rateIsCustom ? ' · your agreed rate' : null}
              </span>
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

// Where each format actually runs, in the reader's terms. Keyed off `surface`,
// which is the server's own word for it, so a format on a new surface shows the
// raw key rather than being silently mislabelled as one of these.
const SURFACE_LABEL = {
  watch: 'Inside videos',
  shorts: 'Between shorts',
  upload: 'Before an upload',
};

/**
 * The full rate card: every bookable spot, each with its own price.
 *
 * Built from `pricing.formats`, the same array FormatPicker reads, so a format
 * added on the server appears here without a frontend change. The section used to
 * quote one number — the video roll's — as though it were the price of the page,
 * which understated the banner and left the shorts and pre-upload spots off the
 * page entirely.
 *
 * Tiles rather than a table: these are four different products, not four readings
 * of one measure, and a row per product invited a price comparison down a column
 * that is not the point. Each tile carries a worked example, because a raw
 * per-second-per-day rate is a number nobody can price a campaign from in their head.
 */
const EXAMPLE_SECONDS = 10;
/* The window every example price is quoted over.
 *
 * Deliberately NOT the bookable minimum. That is now one day, and a one-day quote makes
 * every format look like small change, which reads as a toy rather than as a rate card.
 * Three days is short enough to still be a real booking and long enough that the numbers
 * separate. Floored at the minimum so this cannot quote a window nobody can book. */
const EXAMPLE_DAYS = 3;
/** The longer flight quoted beside it, to show the day rate falling. */
const LONG_EXAMPLE_DAYS = 30;

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
function inMinutes(raw) {
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return null;
  const mins = Math.floor(n / 60);
  const secs = n % 60;
  if (!mins) return `${secs} sec`;
  return secs ? `${mins} min ${secs} sec` : `${mins} min`;
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
  const [done, setDone] = useState(false);
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <button
      type="button"
      className={`mkt-copy${done ? ' done' : ''}`}
      title="Copy the memo"
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
      {done ? 'Copied' : 'Copy'}
    </button>
  );
}

/**
 * What a flight costs: rate x seconds x days^K.
 *
 * Mirrors priceForDays() in 3speakchecks/utils/adModel.js, and takes K from the pricing
 * payload rather than declaring its own. A second copy of a pricing constant is how a
 * page ends up quoting one number and the server charging another; if the curve ever
 * moves, this follows without being touched.
 *
 * Falls back to a straight line when the server sent no K, which is what an older
 * checker means — never a discount we then fail to honour.
 */
function flightPrice(days, ratePerSecondDay, seconds, dayCurveK) {
  const d = Number(days);
  const r = Number(ratePerSecondDay);
  const secs = Number(seconds);
  if (!Number.isFinite(d) || d <= 0 || !Number.isFinite(r) || !Number.isFinite(secs)) return null;
  const k = Number(dayCurveK);
  const exp = Number.isFinite(k) && k > 0 && k <= 1 ? k : 1;
  return Math.round((d ** exp) * r * secs * 1000) / 1000;
}

function hivePayable(hbd, hbdPerHive) {
  const rate = Number(hbdPerHive);
  if (!Number.isFinite(rate) || rate <= 0 || !Number.isFinite(hbd) || hbd <= 0) return null;
  return Math.ceil((hbd / rate) * 1000) / 1000;
}

function hiveEquivalent(hbd, hbdPerHive) {
  const rate = Number(hbdPerHive);
  if (!Number.isFinite(rate) || rate <= 0 || !Number.isFinite(hbd) || hbd <= 0) return null;
  return Math.round((hbd / rate) * 1000) / 1000;
}

/**
 * How much cheaper a day is on an N-day flight than on a one-day one, as a percentage.
 *
 * The curve is `days^K`, so the day rate is `days^(K-1)` of the single-day rate and the
 * spot length and HBD rate cancel out entirely — this is a property of the curve, not of
 * any particular format, which is why one number can be quoted for the whole page.
 *
 * Returns null when there is nothing to advertise: no curve (K = 1, or a checker too old
 * to send one) or a saving too small to be worth a sentence.
 */
/**
 * What an advertiser has to bring for a format, in words.
 *
 * Reads the LIST of accepted kinds rather than the single `creativeKind`, because the
 * banner takes either and saying "an image" would turn away somebody who has a video
 * ready. Falls back to the singular for a checker too old to send the list.
 */
function suppliesFor(f) {
  const kinds = f?.creativeKinds?.length ? f.creativeKinds : (f ? [f.creativeKind] : []);
  const image = kinds.includes('image');
  const video = kinds.includes('video');
  if (image && video) return 'An image or a video';
  return image ? 'An image' : 'A video';
}

function savingAt(days, pricing) {
  const k = Number(pricing?.dayCurveK);
  if (!(k > 0 && k < 1) || !(days > 1)) return null;
  if (pricing?.maxDays && days > pricing.maxDays) return null;
  const saving = Math.round((1 - days ** (k - 1)) * 100);
  return saving >= 5 ? saving : null;
}

function RateCard({ pricing }) {
  const formats = pricing?.formats || [];
  if (!formats.length) return null;
  const days = Math.max(EXAMPLE_DAYS, pricing?.minDays || 0) || null;

  return (
    <ul className="mkt-ratecard">
      {formats.map((f) => {
        // Quoted at one length across every tile, so they compare the SPOTS rather
        // than their maximum lengths. Clamped, so a format capped under the
        // baseline is quoted at its cap and says so.
        const seconds = Math.min(EXAMPLE_SECONDS, f.maxSeconds || EXAMPLE_SECONDS);
        const example = days && f.ratePerSecondDayHbd
          ? flightPrice(days, f.ratePerSecondDayHbd, seconds, pricing?.dayCurveK)
          : null;
        /* The same spot over a month, quoted beside it. A day rate that falls as the
         * flight grows is the offer, and nobody acts on an offer they have to derive —
         * so the longer number sits next to the short one rather than being implied.
         * Hidden when there is no curve to advertise (K = 1, or a checker too old to
         * send one) and when the saving is too small to be worth a sentence. */
        const longer = (() => {
          const k = Number(pricing?.dayCurveK);
          if (!example || !days || !(k > 0 && k < 1)) return null;
          if (!pricing?.maxDays || LONG_EXAMPLE_DAYS > pricing.maxDays) return null;
          const price = flightPrice(LONG_EXAMPLE_DAYS, f.ratePerSecondDayHbd, seconds, k);
          if (price == null) return null;
          // Against the ONE-day rate, the same baseline the section above quotes, so
          // the two numbers on the page cannot disagree about the same curve.
          const saving = savingAt(LONG_EXAMPLE_DAYS, pricing);
          return saving ? { days: LONG_EXAMPLE_DAYS, price, saving } : null;
        })();
        return (
          <li key={f.key} className="mkt-rc-tile">
            <div className="mkt-rc-head">
              <h3>{f.label}</h3>
              <span className="mkt-rc-rate">
                {f.ratePerSecondDayHbd} HBD
                <span className="mkt-rc-unit"> /sec /day</span>
              </span>
            </div>

            <p className="mkt-rc-blurb">{f.blurb}</p>

            <dl className="mkt-rc-facts">
              <div>
                <dt>Where it runs</dt>
                <dd>{SURFACE_LABEL[f.surface] || f.surface}</dd>
              </div>
              <div>
                <dt>You supply</dt>
                <dd>
                  {suppliesFor(f)}
                  {f.maxSeconds ? `, up to ${f.maxSeconds}s` : null}
                </dd>
              </div>
            </dl>

            {example != null ? (
              <div className="mkt-rc-example">
                <span className="mkt-rc-example-price">
                  {example} HBD
                  {hiveEquivalent(example, pricing?.hbdPerHive) != null ? (
                    <span className="mkt-rc-example-hive">
                      {' '}or about {hiveEquivalent(example, pricing.hbdPerHive)} HIVE
                    </span>
                  ) : null}
                </span>
                <span className="mkt-rc-example-note">
                  for a {seconds}s spot over {days} days
                  {longer ? (
                    <>
                      {'; '}
                      <strong>{longer.price} HBD</strong> for {longer.days} days, about
                      {' '}{longer.saving}% less per day
                    </>
                  ) : null}
                </span>
              </div>
            ) : null}

            {f.rateIsCustom ? <span className="mkt-tag">your agreed rate</span> : null}
          </li>
        );
      })}
    </ul>
  );
}

function StatusBadge({ status }) {
  const map = {
    pending: { Icon: MdSchedule, label: 'Under review' },
    approved: { Icon: MdCheckCircle, label: 'Approved' },
    rejected: { Icon: MdCancel, label: 'Not accepted' },
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
const isVideoAd = (t) => t === 'video' || t === 'shorts';

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
}) {
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
  const awaitingEncode = creatives.some((c) => c.kind !== 'image' && !c.encoded);
  useEffect(() => {
    if (!awaitingEncode) return undefined;
    const t = setInterval(refresh, 15000);
    return () => clearInterval(t);
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
  const isBanner = !!fmt?.burnsIn;
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
  const [payBusy, setPayBusy] = useState(null);
  const [payError, setPayError] = useState(null);

  const payWithWallet = useCallback(async (c) => {
    const owed = Math.round((c.priceHbd - c.paidHbd) * 1000) / 1000;
    if (!(owed > 0)) return;
    const ccy = payCcy[c.id] === 'HIVE' ? 'HIVE' : 'HBD';
    const amount = ccy === 'HIVE' ? hivePayable(owed, pricing?.hbdPerHive) : owed;
    if (amount == null) {
      setPayError('We cannot read the HIVE price right now. Pay in HBD, or try again shortly.');
      return;
    }
    setPayError(null);
    const signer = getOperationUser();
    if (!signer) {
      setPayError('Log in with the account this flight is booked under to pay from your wallet.');
      return;
    }
    if (c.payFrom && signer.toLowerCase() !== String(c.payFrom).toLowerCase()) {
      setPayError(`This flight is booked under @${c.payFrom}, and only a payment from that account buys it. You are signed in as @${signer}, so a transfer from here would be returned to you. Switch account, or send it manually from @${c.payFrom}.`);
      return;
    }
    setPayBusy(c.id);
    try {
      await transferWithAioha(c.payTo, amount, ccy, c.memo);
      // The transfer is signed, not yet irreversible-block. Give the chain a moment
      // before asking the checker to look, or the first check reliably finds nothing
      // and reads as a failure to the advertiser.
      await new Promise((r) => setTimeout(r, 4000));
      onCheckPayment(c.id);
    } catch (err) {
      // A cancelled signature is not an error worth shouting about, but a failed one is.
      const msg = String(err?.message || err || 'Transfer failed');
      setPayError(/cancel|reject|denied/i.test(msg) ? null : msg);
    } finally {
      setPayBusy(null);
    }
  }, [onCheckPayment, payCcy, pricing?.hbdPerHive]);
  const autoOn = autoLength && autoAvailable;

  const chosenLength = autoOn ? latestSpotSeconds : (spotSeconds ?? maxSpot);
  const lengthOk = Number.isInteger(chosenLength) && chosenLength >= minSpot && chosenLength <= maxSpot;
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
        ? 'Booked and scheduled, covered in full by your credit'
        : 'Booked. Send the payment to start it');
      refresh();
      if (!creatives.length) onNeedCreative?.();
      if (res?.campaign?.id) {
        setBookedId(res.campaign.id);
        onBooked?.(res.campaign.id);
      }
      return res;
    } catch (err) {
      setError(err.message || 'Could not make that booking');
    } finally { setBusy(false); }
    return null;
  }

  async function onCheckPayment(id) {
    setError(null);
    try {
      const r = await claimCampaign(id);
      toast.success(r.message || 'Payment found');
      refresh();
    } catch (err) {
      // A missing payment is the normal case right after booking, not a failure.
      setError(err.status === 404 ? 'No matching transfer found yet. It can take a moment to appear on chain.' : (err.message || 'Could not check'));
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
      toast.success(cr?.kind === 'image' ? 'Banner saved' : 'Spot saved');
      setPicked((p) => { const n = { ...p }; delete n[id]; return n; });
      refresh();
    } catch (err) {
      setError(err.message || 'Could not use that creative');
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
      {view === 'all' ? <h3>Your bookings</h3> : null}
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
            You can book now, while we review you. Booking holds the position
            {pricing?.slotHoldHours ? ` for ${pricing.slotHoldHours} hours` : ''}, so it
            is yours if your payment arrives in that time. If it does not, the hold
            lapses and the slot goes back on sale. Nothing runs and nothing is charged
            until you pay.
          </span>
        </p>
      )}

      <form className="mkt-book" onSubmit={onBook}>
        {/* The type comes first and the rest of the form follows from it: the three
            products differ in price, in length, in what you supply and in whether a
            position is even yours to choose. */}
        {lockFormat ? (
          <p className="mkt-fine mkt-locked-format">
            Booking a <strong>{fmt?.label || lockFormat}</strong>, to match the ad you uploaded.
            {' '}Change it in <em>Your ad</em> if that is not what you meant.
          </p>
        ) : (
          <FormatPicker formats={offered} value={fmt?.key} onChange={(k) => { setFormatKey(k); setSlotPct(null); setSpotSeconds(null); }} />
        )}

        {/* Grouped by what each field describes. Days, length and placement are the
            booking itself; the two duration fields are about the videos it may run
            on, which is a different question and was reading as more booking fields. */}
        <fieldset className="mkt-group">
          <legend>The booking</legend>
        <div className="mkt-field">
          <label htmlFor="mkt-days">Days</label>
          <input
            id="mkt-days" type="number" min={pricing?.minDays || 1} max={pricing?.maxDays || 90}
            value={days} onChange={(e) => setDays(e.target.value)}
          />
          <span className="mkt-hint">
            How long it runs. {pricing?.minDays || 1} to {pricing?.maxDays || 90}.
            {/* The nudge, at the moment the number is being chosen. Once they are past
                a month there is little left to sell them, so it stops rather than
                badgering — and it never appears at all if the curve is off. */}
            {daysSaving ? ` At ${days} days you pay about ${daysSaving}% less per day than a single day.` : ''}
            {nextStep ? ` ${nextStep.days} days would make it about ${nextStep.saving}% less.` : ''}
          </span>
        </div>

        <div className="mkt-field">
          <label htmlFor="mkt-start">Starts <span className="mkt-optional">optional</span></label>
          <input
            id="mkt-start"
            type="date"
            min={earliestISO}
            value={startAt}
            onChange={(e) => setStartAt(e.target.value)}
          />
          <span className={startOk ? 'mkt-hint' : 'mkt-upload-error'}>
            {!startOk
              ? 'That date has passed. Pick today or later.'
              : runsUntil
                ? `Runs to ${runsUntil}.`
                : 'Leave blank, or pick today, to start as soon as it is approved and paid.'}
          </span>
        </div>
        <div className="mkt-field">
          <label htmlFor="mkt-length">
            {isBanner ? 'How long it shows' : 'Ad length'}
          </label>
          <div className="mkt-length-row">
            <input
              id="mkt-length"
              type="number"
              min={minSpot}
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
                    ? 'You have more than one ad video, so we cannot tell which length to use. Enter it yourself.'
                    : 'Upload your ad video first')}
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
                <span>Automatic</span>
              </label>
            )}
          </div>
          <span className={`mkt-hint${lengthOk ? '' : ' mkt-hint-short'}`}>
            {autoTooLong
              ? `Your spot is ${chosenLength}s, longer than this format allows. Upload a shorter one, or pick a format that takes it.`
              : (
                <>
                  Seconds, {minSpot} to {maxSpot}.{' '}
                  {autoOn
                    ? 'Taken from the ad video you uploaded.'
                    : (isBanner
                      ? 'How long the banner stays on screen. A video banner has to be at least this long.'
                      : (tooManySpots
                        ? 'More than one ad video uploaded, so enter the length of the one you are booking.'
                        : 'Your ad video has to fit inside this.'))}
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
          <legend>Placement</legend>
        <div className="mkt-field">
          <label htmlFor="mkt-slot">When in the video</label>
          <select id="mkt-slot" value={chosenSlot} onChange={(e) => setSlotPct(Number(e.target.value))}>
            {slots.map((p) => (
              <option key={p} value={p} disabled={slotTaken(p)}>
                {/* The "not recommended" warning is about a PRE-ROLL: an ad that plays
                    before the video, to people who were about to leave. A banner at 0%
                    is not that — it appears with the video, so the caveat does not
                    apply and neither does the wording. */}
                {p === 0 && !isBanner
                  ? 'Before the video (not recommended)'
                  : slotLabel({ percent: p, banner: isBanner })}
                {slotTaken(p)
                  ? ' (full for these dates)'
                  : (sharingWith(p) > 0 ? ` (${sharesLeft(p)} of ${slotRow(p).sharesTotal} places left)` : '')}
              </option>
            ))}
          </select>
          <span className="mkt-hint">
            {/* A position is sold to one advertiser at a time, across every format —
                so this says what is actually for sale, not what exists. */}
            How far into each video it runs. Later reaches fewer people, but reaches
            them watching.
            {sharingWith(chosenSlot) > 0
              ? ` You would share this position with ${sharingWith(chosenSlot)} other `
                + `${sharingWith(chosenSlot) === 1 ? 'advertiser' : 'advertisers'}, taking turns, `
                + 'so the forecast on your booking is your share of it rather than the whole position.'
              : ` A position carries up to ${slotRow(chosenSlot)?.sharesTotal || 3} advertisers at a time, taking turns.`}
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
          <legend>Videos to run on <span className="mkt-optional">optional</span></legend>
        <div className="mkt-field">
          <label htmlFor="mkt-minvid">Shortest video</label>
          <input
            id="mkt-minvid" type="number" min="0" step="1" placeholder="any"
            value={minVideo} onChange={(e) => setMinVideo(e.target.value)}
          />
          <span className="mkt-hint">Seconds. Blank for no minimum.</span>
          {inMinutes(minVideo) ? <span className="mkt-mins">{inMinutes(minVideo)}</span> : null}
        </div>

        <div className="mkt-field">
          <label htmlFor="mkt-maxvid">Longest video</label>
          <input
            id="mkt-maxvid" type="number" min="0" step="1" placeholder="any"
            value={maxVideo} onChange={(e) => setMaxVideo(e.target.value)}
          />
          <span className={`mkt-hint${videoRangeOk ? '' : ' mkt-hint-short'}`}>
            {videoRangeOk
              ? 'Seconds. Blank for no maximum.'
              : 'The longest cannot be shorter than the shortest.'}
          </span>
          {inMinutes(maxVideo) ? <span className="mkt-mins">{inMinutes(maxVideo)}</span> : null}
        </div>
        </fieldset>
        ) : null}
        </div>
        <div className="mkt-book-total">
          {total != null ? (
            <span>
              <strong>{total} HBD</strong> total
              {hiveEquivalent(total, pricing?.hbdPerHive) != null ? (
                <span className="mkt-hint">
                  {' '}(about {hiveEquivalent(total, pricing.hbdPerHive)} HIVE)
                </span>
              ) : null}
              {productionFee > 0 ? <span className="mkt-hint"> ({flight} booking + {productionFee} production)</span> : null}
              {/* ⚠️ This used to read "{chosenLength}s x {days} days at {rate} HBD per
                  second per day", which is a multiplication that no longer reproduces
                  the total: the day rate falls with the length of the flight. Quoting
                  the EFFECTIVE day rate keeps the line arithmetically honest and shows
                  the discount at the same time. */}
              <span className="mkt-hint">
                {' '}· {fmt ? `${fmt.label}, ` : ''}{chosenLength}s over {days} day{Number(days) === 1 ? '' : 's'}
                {fmt?.rateIsCustom ? ' at your agreed rate, ' : ', '}
                {effectiveDayRate != null ? `${effectiveDayRate} HBD per second per day` : `${rate} HBD per second per day`}
                {daysSaving ? ` — ${rate} on a single day, ${daysSaving}% less at this length` : ''}
              </span>
              {/* What they will actually be asked to transfer. The server spends the
                  balance when the campaign is created, so quoting only the total
                  would overstate what this booking costs them. Mirrors the same
                  min(balance, price) the backend applies — matching `total` works
                  because priceHbd there is likewise flight + production fee. */}
              {balanceHbd > 0 ? (
                <span className="mkt-hint">
                  {' '}· {Math.min(balanceHbd, total)} HBD credit applied, so you send{' '}
                  <strong>
                    {Math.round(Math.max(0, total - balanceHbd) * 1000) / 1000} HBD
                  </strong>
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
            {busy ? 'Booking…' : 'Book this ad'}
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
          You have <strong>{balanceHbd} HBD</strong> in credit from flights that
          under-delivered. It comes off your next booking automatically.
        </p>
      )}

      {(view === 'active' || view === 'history') && listed.length === 0 && (
        <p className="mkt-fine">
          {view === 'active'
            ? 'No live bookings. Anything you book shows up here until it finishes.'
            : 'Nothing here yet. Flights land here once they finish or are called off.'}
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
                {c.days} days · {c.spotSeconds ? `${c.spotSeconds}s · ` : ''}
                {slotLabel({
                  percent: c.slotPercent,
                  position: c.slotPosition,
                  banner: c.format === 'video_banner',
                })} · {c.priceHbd} HBD
                {c.forecast != null ? ` · forecast ${formatCount(c.forecast)} play${c.forecast === 1 ? '' : 's'}` : ''}
              </div>

              {c.production && (
                <div className="mkt-campaign-blocked">
                  We are making the video · {c.production.status}
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
                  ? 'The team will review your ad file soon. We attach it for you once it passes, and get in touch if there is a choice to make.'
                  : (BLOCKED_REASON[c.blockedBy] || c.blockedBy);
                return <div className="mkt-campaign-blocked">{label}</div>;
              })()}

              {c.paidHbd < c.priceHbd && (
                <div className="mkt-pay">
                  {(() => {
                    const owed = Math.round((c.priceHbd - c.paidHbd) * 1000) / 1000;
                    const ccy = payCcy[c.id] === 'HIVE' ? 'HIVE' : 'HBD';
                    const inHive = hivePayable(owed, pricing?.hbdPerHive);
                    const shown = ccy === 'HIVE' ? inHive : owed;
                    return (
                      <>
                        <div className="mkt-pay-ccy" role="group" aria-label="Pay with">
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
                          Send <strong>{shown != null ? shown.toFixed(3) : '—'} {ccy}</strong> to{' '}
                          <strong>@{c.payTo}</strong> with the memo <code>{c.memo}</code>{' '}
                          <CopyButton value={c.memo} />.
                          {ccy === 'HIVE' ? ' HIVE is valued at the on-chain price when it arrives, so this covers the price at today\u2019s.' : ''}
                        </p>
                      </>
                    );
                  })()}
                  {/* Without this the figure above simply does not match the price on
                      the line beside it, which reads as a pricing bug rather than a
                      discount. Say where the difference went. */}
                  {c.creditAppliedHbd > 0 && (
                    <p className="mkt-hint">
                      {c.priceHbd} HBD less {c.creditAppliedHbd} HBD credit from an earlier
                      flight that under-delivered.
                    </p>
                  )}
                  <div className="mkt-pay-actions">
                    <button
                      type="button"
                      className="mkt-outline"
                      disabled={payBusy === c.id}
                      onClick={() => payWithWallet(c)}
                    >
                      {payBusy === c.id ? 'Waiting for your wallet…' : 'Send with wallet'}
                    </button>
                    <button type="button" className="mkt-secondary" onClick={() => onCheckPayment(c.id)}>
                      Manually sent
                    </button>
                  </div>
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
                        {canImage && canVideo
                          ? `This is a ${c.formatLabel || 'banner'} flight, so it needs an approved banner, either an image${c.creativeSpec ? ` (${c.creativeSpec.recommended}, between ${c.creativeSpec.minAspect}:1 and ${c.creativeSpec.maxAspect}:1)` : ''} or a video.`
                          : wantsImage
                            ? `This is a ${c.formatLabel || 'banner'} flight, so it needs an approved banner image${c.creativeSpec ? ` (${c.creativeSpec.recommended}, between ${c.creativeSpec.minAspect}:1 and ${c.creativeSpec.maxAspect}:1)` : ''}.`
                            : 'This flight needs an approved ad video.'}
                      </p>
                    </div>
                  ) : null;
                }
                return (
                <div className="mkt-pay">
                  <label className="mkt-hint" htmlFor={`attach-${c.id}`}>
                    {canImage && canVideo
                      ? 'Use one of your approved banners or ad videos'
                      : wantsImage ? 'Use one of your approved banners' : 'Use one of your approved ad videos'}
                  </label>
                  <div className="mkt-attach-row">
                    <select
                      id={`attach-${c.id}`}
                      value={picked[c.id] || ''}
                      onChange={(e) => setPicked((p) => ({ ...p, [c.id]: e.target.value }))}
                    >
                      <option value="" disabled>Choose one</option>
                      {usable.map((cr) => (
                        <option key={cr.embedId} value={cr.permlink || cr.embedId}>
                          {/* A still has no duration — "0s ad" was what it used to say. */}
                          {cr.kind === 'image'
                            ? `Banner${cr.imageWidth ? ` · ${cr.imageWidth}×${cr.imageHeight}` : ''}`
                            : `${cr.durationSeconds}s ad`}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className="mkt-outline"
                      disabled={!picked[c.id] || saving === c.id}
                      onClick={() => onAttach(c.id)}
                    >
                      {saving === c.id ? 'Saving…' : 'Save'}
                    </button>
                  </div>
                </div>
                );
              })()}

              {(c.delivered > 0 || c.status === 'complete') && (
                <div className="mkt-delivery">
                  <span><strong>{formatCount(c.delivered)}</strong> play{c.delivered === 1 ? '' : 's'} delivered
                    {c.forecast ? ` of ${formatCount(c.forecast)} forecast` : ''}</span>
                  {/* A shortfall against forecast is settled as credit toward the
                      next booking, not as a transfer back. Saying "we will send it"
                      would leave them waiting for money that is not coming. */}
                  {/* Credit EARNED is good news. It shared .mkt-refund with the
                      "we are looking at this one" case, which is a problem and is
                      meant to read as one, so both came out in the warning red. */}
                  {c.refundHbd > 0 && (
                    <span className={c.refundStatus === 'credited' ? 'mkt-credit-earned' : 'mkt-refund'}>
                      {c.refundStatus === 'credited'
                        ? `${c.creditHbd ?? c.refundHbd} HBD credited to you for under-delivery. It comes off your next booking`
                        : `${c.refundHbd} HBD short of forecast. We are looking at this one`}
                    </span>
                  )}
                  {c.creditAppliedHbd > 0 && (
                    <span className="mkt-credit-used">
                      {c.creditAppliedHbd} HBD of credit went into this booking
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

const CREATIVE_STATUS = {
  pending: 'Encoding',
  review: 'Waiting for review',
  ready: 'Approved',
  rejected: 'Not accepted',
};

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
      toast.success('Logo saved');
    } catch (err) {
      setError(err.message || 'Could not save that logo');
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
      toast.success('Slogan saved');
    } catch (err) {
      setError(err.message || 'Could not save that slogan');
    } finally { setBusy(false); }
  }

  const over = slogan.trim().length > SLOGAN_MAX;
  const dirty = slogan.trim() !== savedSlogan;

  return (
    <div className="mkt-brand">
      <h3>How your ad is labelled</h3>
      <p className="mkt-fine">
        While your ad plays we show who it is from, over the video. This is what it says.
      </p>

      <div className="mkt-brand-row">
        <div className="mkt-brand-fields">
          <div className="mkt-field">
            <span className="mkt-label">Logo</span>
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
              {logoUrl ? 'Replace logo' : 'Upload a logo'}
            </label>
            <span className="mkt-hint">Shown as a circle, so a square image works best.</span>
          </div>

          <div className="mkt-field mkt-field-wide">
            <label htmlFor={`mkt-slogan-${reference}`}>Slogan</label>
            <input
              id={`mkt-slogan-${reference}`}
              value={slogan}
              maxLength={SLOGAN_MAX}
              onChange={(e) => setSlogan(e.target.value)}
              placeholder="One line about what you do"
            />
            <span className={`mkt-hint${over ? ' mkt-hint-short' : ''}`}>
              {slogan.trim().length}/{SLOGAN_MAX} characters. Two lines at most in the overlay.
            </span>
          </div>

          <div className="mkt-field">
            <span className="mkt-label mkt-visually-hidden">Save</span>
            <button
              type="button"
              className="mkt-secondary"
              onClick={onSaveSlogan}
              disabled={busy || over || !dirty}
            >
              {busy ? 'Saving…' : (dirty ? 'Save slogan' : 'Saved')}
            </button>
          </div>
        </div>

        {/* The overlay on its own. The ad video underneath is a separate thing and
            putting it here answered a question nobody was asking: what matters is
            how the label itself reads, at the size it is drawn. */}
        <div className="mkt-brand-preview">
          <span className="mkt-preview-cap">Top left of your ad</span>
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

function CreativePanel({ reference, account, maxSeconds, bannerSpec, onCreatives, pending, production, offer, brand, adType = null, single = false }) {
  const [creatives, setCreatives] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const inputRef = useRef(null);

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
        toast.success('Image saved. Use it as a player banner, or we can build an ad video around it');
      } else {
        // Checked here as well as on the server so a too-long spot fails in a second
        // rather than after an upload.
        const durationSeconds = await readVideoDuration(file);
        if (durationSeconds && maxSeconds && durationSeconds > maxSeconds) {
          throw new Error(`That video is ${durationSeconds} seconds. The most an ad can run is ${maxSeconds}.`);
        }
        await uploadCreative({ file, account, reference, durationSeconds });
        toast.success('Spot uploaded. We will review it before it runs');
      }
      refresh();
    } catch (err) {
      setError(err.message || 'Upload failed');
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
        {adType === 'banner' ? 'Your banner' : (isVideoAd(adType) ? 'Your ad video' : 'Your ad creatives')}
      </h3>
      {adType !== 'banner' && (
        <p className="mkt-fine">
          Upload the video you want to run. It is never posted to Hive and never appears
          in any feed &mdash; it goes through the same encoder as everything else so it
          plays cleanly inside a break, and then waits for us to watch it.
          {maxSeconds ? ` Up to ${maxSeconds} seconds.` : null}
        </p>
      )}
      <p className="mkt-fine">
        {/* Written for the format being bought. Telling someone making a banner about
            video encoding, or someone making a spot about aspect ratios, is how a
            form ends up feeling like it was written for somebody else. */}
        {adType === 'banner'
          ? (
            <>
              A player banner is a still or a short video, shown over the video while it
              plays. A video banner is played once, so it has to be at least as long as
              the banner runs.
              {bannerSpec
                ? ` ${bannerSpec.recommended} works well, and it needs to be a strip between `
                  + `${bannerSpec.minAspect}:1 and ${bannerSpec.maxAspect}:1.`
                : ' It needs to be a wide strip.'}
            </>
          )
          : (
            <>
              Images too. A still is what a <strong>player banner</strong> is made of &mdash;
              {bannerSpec
                ? ` ${bannerSpec.recommended} works well, and it needs to be a strip between `
                  + `${bannerSpec.minAspect}:1 and ${bannerSpec.maxAspect}:1.`
                : ' it needs to be a wide strip.'}
              {' '}A logo or key art that is not that shape is still worth uploading: we can
              build an ad video around it.
            </>
          )}
      </p>
      {pending && !production && (
        <p className="mkt-fine">
          You can do this now, while your product is being reviewed. It is the quickest way
          to show us what you have in mind, and nothing here runs until both your product and
          the ad video are approved and a booking is paid for. If you would rather we made
          the video, say so on the form and skip this.
        </p>
      )}
      {production && adType !== 'banner' && (
        // They already asked us to make it, so "upload the video you want to run" is
        // the wrong instruction to leave standing. What we want from them is raw
        // material, and only if they have any.
        <p className="mkt-fine">
          You have asked us to make the ad video, so there is nothing you need to upload here.
          If you have a logo, key art or footage you want us to work from, this is where to
          put it.
        </p>
      )}

      {/* A banner takes a still OR a video, and a video is played once for the seconds
          it runs rather than looped, so it has to cover the booking. Deliberately not
          offering GIFs: the compositor takes real video, and a GIF would be accepted by
          the picker and then refused by the encoder. */}
      <div className="mkt-upload-row">
        <input
          ref={inputRef}
          id="mkt-creative-file"
          type="file"
          accept={adType === 'banner' ? 'image/*,video/*' : (isVideoAd(adType) ? 'video/*' : 'video/*,image/*')}
          onChange={onFile}
          disabled={busy || atLimit}
          className="mkt-visually-hidden"
        />
        <label
          htmlFor="mkt-creative-file"
          className={`mkt-outline mkt-upload-btn${busy || atLimit ? ' disabled' : ''}`}
          aria-disabled={atLimit ? 'true' : undefined}
        >
          {busy
            ? 'Uploading…'
            : (atLimit
              ? 'Replace it below to change it'
              : (adType === 'banner' ? 'Upload your banner'
                : (isVideoAd(adType) ? 'Upload your ad video' : 'Upload a video or image')))}
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
              <strong>No ad video? Have us make it for you.</strong>
              {offer.feeHbd
                ? <> A one-off <strong>{offer.feeHbd} HBD</strong>, added to your booking.</>
                : null}
            </span>
          </label>
          {offer.wanted && (
            <div className="mkt-field mkt-field-wide">
              <label htmlFor="mkt-spot-brief">What should the ad say?</label>
              <textarea
                id="mkt-spot-brief"
                rows={4}
                value={offer.brief}
                onChange={(e) => offer.onChange({ wanted: true, brief: e.target.value })}
                placeholder="What you are advertising, who it is for, the one thing a viewer should remember, and anything you want us to avoid. Upload a logo or stills above and we will use them."
              />
              <span className={`mkt-hint${offer.brief.trim().length < 20 ? ' mkt-hint-short' : ''}`}>
                {offer.brief.trim().length < 20
                  ? `${20 - offer.brief.trim().length} more characters, we cannot make an ad from a blank brief`
                  : 'Enough to work from, thanks'}
              </span>
            </div>
          )}
        </div>
      )}

      {creatives.length > 0 && (
        <ul className="mkt-creative-list">
          {creatives.map((c) => (
            <li key={c.embedId}>
              <span className={`mkt-creative-status mkt-creative-${c.status}`}>
                {CREATIVE_STATUS[c.status] || c.status}
              </span>
              <span className="mkt-creative-meta">
                {/* Its size, not a verdict. Whether a given still is banner-shaped
                    is the attach route's call — creativeSpecError() on the server is
                    the single definition, and restating it here would be a second
                    copy of the rule to drift out of step. */}
                {c.kind === 'image'
                  ? `Image${c.imageWidth ? ` · ${c.imageWidth}×${c.imageHeight}` : ''}`
                  : (c.durationSeconds ? `${c.durationSeconds}s` : 'duration unknown')}
                {c.note ? ` · ${c.note}` : ''}
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
                  title="Open the full size"
                >
                  <img src={c.imageUrl} alt="Your banner" loading="lazy" />
                </a>
              ) : c.previewUrl && c.encoded ? (
                <a href={c.previewUrl} target="_blank" rel="noopener noreferrer">Watch it back</a>
              ) : <span className="mkt-creative-meta">still encoding</span>}
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
  const user = useAppStore((s) => s.user);
  const [form, setForm] = useState(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [receipt, setReceipt] = useState(null);
  const [lookupRef, setLookupRef] = useState('');
  const [lookup, setLookup] = useState(null);
  const [lookingUp, setLookingUp] = useState(false);
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
   * Two ways in. The cached path replays references we have already proved ownership
   * of: a reference IS the credential the rest of this page uses, so once one is on
   * the device it costs nothing and asks for no signature. The signed path goes to
   * the checker with proof and returns the lot, which is what a new browser needs.
   *
   * On react-query rather than a fetch-on-mount effect, like the inventory and rate
   * card above it, so the account key handles invalidation on a login change for us.
   */
  // Read once per account rather than on every render — localStorage in a render
  // body would make the query's `enabled` flip about as React re-renders.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- refsVersion IS the signal
  const hasCachedRefs = useMemo(() => rememberedReferences(user).length > 0, [user, refsVersion]);

  const listMine = useCallback(async () => {
    const cached = rememberedReferences(user);
    if (cached.length && !forceSigned) {
      const rows = await Promise.all(cached.map((ref) => fetchApplication(ref)
        .then((r) => ({ ...r, reference: ref }))
        .catch(() => null)));   // a stale reference is not an error worth showing
      return rows.filter(Boolean);
    }
    return fetchMyApplications(user);
  }, [user, forceSigned]);

  // Runs on arrival when it can do so silently: cached references always, and the
  // signed route for logins the server can verify on its own (Butter Auth,
  // HiveSigner). A wallet login would mean a signing popup the moment the page
  // loads, which is not something to spring on someone who came to read it, so
  // `forceSigned` waits for them to press the button.
  const {
    data: mine,
    isFetching: mineBusy,
    error: mineError,
  } = useQuery({
    queryKey: ['advertise-mine', user, forceSigned, refsVersion],
    queryFn: listMine,
    enabled: !!user && (forceSigned || hasCachedRefs || identityIsSilent()),
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
  const WIZ_FORMAT = { video: 'video_roll', banner: 'video_banner', shorts: 'shorts_roll' };
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
  const { data: pricing } = useQuery({
    // Whichever product is in play: the one opened from My products, or the one the
    // wizard is enrolling. Keyed on lookupRef alone, the wizard never passed a
    // reference at all and quoted the PUBLIC rate card while booking against an
    // advertiser who had been given their own rate.
    queryKey: ['advertise-pricing', lookupRef.trim() || wizRef?.reference || null],
    queryFn: () => fetchPricing(lookupRef.trim() || wizRef?.reference || undefined),
    staleTime: INVENTORY_STALE_MS,
    retry: false,
  });

  // The page was one long scroll that mixed three unrelated jobs: reading what is
  // for sale, filling in a form, and managing work already in flight. Tabs so each
  // one is a place you can be, rather than a stretch of page you have to find.
  const [tab, setTab] = useState('general');
  /* Which part of ONE product you are looking at. Booking, the flights that are live
     and the ones that are done are three different jobs, and a single scroll made you
     hunt for whichever one you came for. */
  const [ptab, setPtab] = useState('book');
  /* Opening a product by its reference is the fallback path: it matters to somebody
     who registered on another browser, and to nobody else. It sat permanently at the
     foot of the product list, so it took up room on every visit for the one visit it
     is needed on. */
  const [showLookup, setShowLookup] = useState(false);
  /* Where Book a spot has got to. It was one page holding an upload panel, a booking
     form and every flight ever booked, which asked somebody to work out the order for
     themselves. */
  const [bookStep, setBookStep] = useState(1);
  const TABS = [
    { id: 'general', label: 'General' },
    { id: 'wizard', label: 'Enroll your ad' },
    { id: 'mine', label: 'My products' },
  ];

  const PRODUCT_TABS = [
    { id: 'book', label: 'Book a spot' },
    { id: 'active', label: 'Active spots' },
    { id: 'history', label: 'Booking history' },
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
      toast.success('Product registered. We will review it');
    } catch (err) {
      // The backend returns the reference on a duplicate, which is exactly what
      // someone re-submitting has lost — surface it instead of a bare error.
      if (err.status === 409 && err.body?.reference) {
        rememberReference(hiveAccount, err.body.reference);
        setRefsVersion((v) => v + 1);
        setReceipt({ reference: err.body.reference, status: err.body.status, message: err.message, hiveAccount });
        toast.info(err.message);
      } else {
        toast.error(err.message || 'Could not register that product');
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function onLookup(e) {
    e.preventDefault();
    const ref = lookupRef.trim();
    if (!ref || lookingUp) return;
    setLookingUp(true);
    setLookup(null);
    try {
      const found = await fetchApplication(ref);
      setLookup(found);
      // Typed once, remembered after — the same bargain as applying.
      if (found?.hiveAccount) {
        rememberReference(found.hiveAccount, ref);
        setRefsVersion((v) => v + 1);
      }
    } catch (err) {
      toast.error(err.status === 404 ? 'No product with that reference' : (err.message || 'Lookup failed'));
    } finally {
      setLookingUp(false);
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
              <span className="mkt-label">Applying as</span>
              <strong>@{user}</strong>
              <span className="mkt-hint">
                The account the booking will be paid from. Log in as a different account to
                apply as that one.
              </span>
            </div>

            <div className="mkt-field">
              <label htmlFor="mkt-project">Product name</label>
              <input id="mkt-project" value={form.projectName} onChange={set('projectName')} required />
            </div>

            <div className="mkt-field">
              <label htmlFor="mkt-website">Website <span className="mkt-optional">optional</span></label>
              <input id="mkt-website" type="url" value={form.website} onChange={set('website')} placeholder="https://" />
              <span className="mkt-hint">Where viewers land when they click your ad.</span>
            </div>

            <div className="mkt-field">
              <label htmlFor="mkt-contact">How we reach you</label>
              <input
                id="mkt-contact"
                value={form.contact}
                onChange={set('contact')}
                placeholder="Discord, Telegram, email, whatever you actually read"
                required
              />
            </div>

            <div className="mkt-field">
              <label htmlFor="mkt-category">Category</label>
              <select id="mkt-category" value={form.category} onChange={set('category')} required>
                <option value="" disabled>Choose one</option>
                {AD_CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
            </div>

            <div className="mkt-field">
              <label htmlFor="mkt-budget">Budget in HBD <span className="mkt-optional">optional</span></label>
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
              <span className="mkt-hint">A rough figure is enough.</span>
            </div>

            {marketOptions.length > 0 && (
              <div className="mkt-field mkt-field-wide">
                <span className="mkt-label">Markets <span className="mkt-optional">optional</span></span>
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
                <span className="mkt-hint">Leave all unselected to run everywhere.</span>
              </div>
            )}

            <div className="mkt-field mkt-field-wide">
              <label htmlFor="mkt-concept">What do you want to run?</label>
              <textarea
                id="mkt-concept"
                rows={5}
                value={form.creativeConcept}
                onChange={set('creativeConcept')}
                placeholder="The spot itself, who it is aimed at, and roughly when you would want it live."
                required
              />
              <span className={`mkt-hint${conceptLeft > 0 ? ' mkt-hint-short' : ''}`}>
                {conceptLeft > 0 ? `${conceptLeft} more characters` : 'Enough to go on, thanks'}
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
                  <strong>Have us make the video for you.</strong> Tick this if you do not
                  have a spot yet
                  {pricing?.productionFeeHbd
                    ? <>. A one-off <strong>{pricing.productionFeeHbd} HBD</strong>, quoted with
                      your booking and charged only when you book, so applying costs nothing.</>
                    : '.'}
                </span>
              </label>
              {form.wantProduction && (
                <div className="mkt-field mkt-field-wide">
                  <label htmlFor="mkt-apply-brief">What should the spot say?</label>
                  <textarea
                    id="mkt-apply-brief"
                    rows={4}
                    value={form.productionBrief}
                    onChange={set('productionBrief')}
                    placeholder="What you are advertising, who it is for, the one thing a viewer should remember, and anything you want us to avoid. You can send us a logo and stills once you have your reference."
                    required
                  />
                  <span className={`mkt-hint${briefLeft > 0 ? ' mkt-hint-short' : ''}`}>
                    {briefLeft > 0
                      ? `${briefLeft} more characters, we cannot make a spot from a blank brief`
                      : 'Enough to work from, thanks'}
                  </span>
                </div>
              )}
              {!form.wantProduction && (
                <span className="mkt-hint">
                  Already have the video? Leave this unticked. You can upload it as soon as
                  you have your reference, without waiting to be approved.
                </span>
              )}
            </div>

            <div className="mkt-actions">
              <button type="submit" className="mkt-outline" disabled={submitting || briefLeft > 0}>
                {submitting ? 'Sending…' : 'Register this product'}
              </button>
              <span className="mkt-fine">Reviewed by a person. We do not accept every product.</span>
            </div>
          </form>
  );

  return (
    <div className="mkt-page">
      <SEOHead
        title="Advertise on 3Speak videos"
        description="Put a short ad inside videos on 3Speak, paid in HBD or HIVE. Every advertiser is reviewed by hand."
        url="https://3speak.tv/advertise"
      />
      <header className="mkt-header">
        <MdCampaign className="mkt-header-icon" aria-hidden="true" />
        <div>
          <h1>Advertise on 3Speak videos</h1>
          <p className="mkt-lede">
            Your ad plays <strong>inside</strong> the video rather than in a box beside it, so
            it reaches people whether or not they run an ad blocker.
          </p>
        </div>
      </header>

      <div className="mkt-tabs" role="tablist" aria-label="Advertising">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`mkt-tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls={`mkt-panel-${t.id}`}
            className={`mkt-tab${tab === t.id ? ' selected' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
            {t.id === 'mine' && myApps?.length ? (
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
        <h2>How it works</h2>
        <p className="mkt-intro-lede">
          Three things, and each one holds the next.
        </p>
        <ol className="mkt-steps">
          <li>
            <strong>Your product</strong>
            <span>Whatever you want to advertise.</span>
            <span className="mkt-step-detail">
              Tell us once and a person reads it. Something different later means a new
              product.
            </span>
          </li>
          <li>
            <strong>Your ad videos</strong>
            <span>
              The clip that plays inside someone&apos;s video.
            </span>
            <span className="mkt-step-detail">
              Upload as many as you like{pricing?.maxCreativeSeconds ? ` (up to ${pricing.maxCreativeSeconds} seconds)` : ''}, or ask
              us to make one. We watch each before it runs.
            </span>
          </li>
          <li>
            <strong>Your bookings</strong>
            <span>When your ad runs, where it falls, and what it costs.</span>
            <span className="mkt-step-detail">
              Book as many as you like. Each uses one of your ad videos and starts when your
              payment lands.
            </span>
          </li>
        </ol>
        <p className="mkt-fine">
          Priced per second of ad, per day. Nothing runs until your product and ad video are
          both approved.
        </p>
      </section>

      {/* The way in. The overview explains the thing; this is the one control that
          starts it, so it sits above the detail rather than under it. */}
      <button type="button" className="mkt-enroll-cta" onClick={() => { setWizStep(wizRef ? 2 : 1); setTab('wizard'); }}>
        <MdCampaign aria-hidden="true" />
        Enroll your ad on 3Speak
      </button>

      <section className="mkt-section">
        <h2>What you would be buying</h2>
        <InventoryPanel data={inventory} isLoading={isLoading} error={error} />
      </section>

      <section className="mkt-section">
        <h2>How it is priced</h2>
        {pricing?.formats?.length ? (
          <p className="mkt-intro-lede">
            Every spot is priced per second of ad, per day it runs, and the day rate
            falls the longer you book
            {/* Named in real numbers rather than described. "Cheaper for longer" is a
                claim every rate card makes; a week at 25% off is a reason to book a
                week. Both figures come from the server's own curve, so they cannot
                drift from what the booking form will quote. */}
            {savingAt(7, pricing) ? ` — a week costs about ${savingAt(7, pricing)}% less per day than a single day, a month about ${savingAt(30, pricing)}% less` : ''}.
            {' '}Examples use a
            {' '}{EXAMPLE_SECONDS}-second spot over {Math.max(EXAMPLE_DAYS, pricing.minDays || 0)} days
            {pricing.minDays ? `; you can book from ${pricing.minDays} day${pricing.minDays === 1 ? '' : 's'}` : ''}
            {pricing.maxDays ? ` up to ${pricing.maxDays}` : ''}.
          </p>
        ) : pricing?.pricePerSecondDayHbd ? (
          // Fallback for a checker too old to send the rate card: one product, one price.
          <p className="mkt-headline-price">
            <strong>{pricing.pricePerSecondDayHbd} HBD</strong> per second of spot, per day
            {pricing.minDays && pricing.maxCreativeSeconds ? (
              <span className="mkt-hint">
                {' '}· a {pricing.maxCreativeSeconds}s spot for the {pricing.minDays}-day minimum
                  is {flightPrice(pricing.minDays, pricing.pricePerSecondDayHbd, pricing.maxCreativeSeconds, pricing.dayCurveK)} HBD{hiveEquivalent(flightPrice(pricing.minDays, pricing.pricePerSecondDayHbd, pricing.maxCreativeSeconds, pricing.dayCurveK), pricing.hbdPerHive) != null ? ` (about ${hiveEquivalent(flightPrice(pricing.minDays, pricing.pricePerSecondDayHbd, pricing.maxCreativeSeconds, pricing.dayCurveK), pricing.hbdPerHive)} HIVE)` : ''},
                and a shorter spot costs proportionally less
              </span>
            ) : null}
          </p>
        ) : null}
        {/* Every number here comes from /advertise/pricing rather than the copy: a
            hardcoded price is a promise the server has no idea it made. */}
        <RateCard pricing={pricing} />
        <p>
          A flat booking: your spot runs across the network for a fixed period at a fixed
          price. No CPM, so nobody has a reason to pad the count.
        </p>
        <p>
          You are quoted against the forecast above and reported against what actually
          played. Fall short and the difference comes back as credit on your next booking.
        </p>
      </section>

      {/* Two audiences who are not buying anything, side by side: the people whose
          videos carry the ads and the people who watch them. Both are paid, and an
          advertiser reading this page should see that the money goes somewhere real. */}
      <div className="mkt-audience-pair">
        <section className="mkt-section mkt-creators">
          <h2><MdVideocam aria-hidden="true" /> If you are a creator</h2>
          <p>
            Ads run on your videos and you earn a share of what they make, along with the
            community you posted in.
          </p>
          <p className="mkt-fine">
            Switch them off any time in Settings. Your videos are then removed from what we
            offer advertisers too.
          </p>
        </section>

        <section className="mkt-section mkt-viewers">
          <h2><MdTv aria-hidden="true" /> If you are a viewer</h2>
          <p>
            You earn a share too, for the videos you actually watch. Paid in HBD or HIVE,
            same as everyone else.
          </p>
          <p className="mkt-fine">
            Opt in from Settings. We only count a video once you have watched most of it.
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
                  <span>{label}</span>
                </li>
              );
            })}
          </ol>

          {wizRef && (
            <div className="mkt-wiz-cancel">
              <span className="mkt-fine">
                Working on <strong>{wizRef.projectName || 'your product'}</strong> ·{' '}
                <code>{wizRef.reference}</code>
              </span>
              <button type="button" className="mkt-linkish" onClick={() => setWizKill(true)}>
                Cancel and delete
              </button>
            </div>
          )}

          {wizKill && (
            // Deleting is the one thing here that cannot be undone, so it asks first
            // and says exactly what goes.
            <div className="mkt-panel mkt-panel-muted mkt-wiz-exit">
              <p style={{ margin: 0 }}>
                <strong>Delete this enrollment?</strong> The product, its bookings and the ad
                videos attached to it are removed. Anything you uploaded stays on the upload
                service, unlisted and earning nothing, but it is no longer attached to a
                product. This cannot be undone.
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
                      toast.success('Enrollment deleted');
                    } catch (err) {
                      toast.error(err.message || 'Could not delete that enrollment');
                    } finally { setWizKilling(false); }
                  }}
                >
                  {wizKilling ? 'Deleting…' : 'Yes, delete it'}
                </button>
                <button type="button" className="mkt-secondary" onClick={() => setWizKill(false)}>
                  Keep it
                </button>
              </div>
            </div>
          )}

          {!user ? (
            <div className="mkt-panel mkt-panel-muted">
              <p style={{ margin: 0 }}>
                Log in with the Hive account you want to advertise from. Your product is tied
                to that account, and it is the wallet the booking is paid from.
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
                  Log in
                </button>
                {ENABLE_BUTRAUTH && (
                  <button
                    type="button"
                    className="mkt-primary"
                    onClick={() => openLoginModal?.('signup')}
                  >
                    Sign up
                  </button>
                )}
              </div>
            </div>
          ) : (
            <>
              {wizAt === 1 && (
                <>
                  <h2>Tell us about your product</h2>
                  <p className="mkt-fine">
                    Whatever you want to advertise. A person reads every one of these.
                  </p>
                  {productForm}
                </>
              )}

              {wizAt === 2 && wizRef && (
                <>
                  <h2>Your ad</h2>

                  <div className="mkt-field mkt-field-wide mkt-adtype">
                    <span className="mkt-label">What are you running?</span>
                    <div className="mkt-adtype-row">
                      {[
                        {
                          id: 'video',
                          title: 'A video ad',
                          // From the rate card, not typed in: this number moved from 15 to 30
                          // and the two places it had been written by hand did not move with it.
                          blurb: pricing?.maxCreativeSeconds
                            ? `Plays inside the video, up to ${pricing.maxCreativeSeconds} seconds.`
                            : 'Plays inside the video.',
                        },
                        { id: 'banner', title: 'A player banner', blurb: 'A still shown over the video while it plays.' },
                        { id: 'shorts', title: 'A shorts spot', blurb: 'Plays full screen between shorts. Upright video only.' },
                      ].map((o) => (
                        <label key={o.id} className={`mkt-adtype-opt${wizType === o.id ? ' selected' : ''}`}>
                          <input
                            type="radio"
                            name="mkt-adtype"
                            value={o.id}
                            checked={wizType === o.id}
                            onChange={() => { setWizType(o.id); if (wizRef?.reference) rememberWizard(user, wizRef.reference, wizAt, o.id); }}
                          />
                          <span>
                            <strong>{o.title}</strong>
                            <span className="mkt-hint">{o.blurb}</span>
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>

                  <p className="mkt-fine">
                    {wizType === 'banner'
                      ? 'Upload the image that will be shown over the video.'
                      : (wizType === 'shorts'
                        ? 'Upload the upright video that will play between shorts. It has to be portrait, because a landscape spot plays small with black bars either side. 1080x1920 works well.'
                        : 'Upload the video that will play, or ask us to make it. This is also where the logo and slogan shown over your ad are set.')}
                  </p>
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
                  <div className="mkt-wiz-actions">
                    <button type="button" className="mkt-primary" onClick={() => goStep(3)}>
                      Next: book a slot
                    </button>
                    {/* Stopping here is a legitimate ending, not a failure — but it is
                        not a booked ad, and saying so now is kinder than letting them
                        find out when nothing ever runs. */}
                    <button type="button" className="mkt-linkish" onClick={() => setWizExit(true)}>
                      Finish later
                    </button>
                  </div>
                </>
              )}

              {wizAt === 3 && wizRef && (
                <>
                  <h2>Book a slot</h2>
                  <CampaignPanel
                    reference={wizRef.reference}
                    pricing={pricing}
                    creatives={wizCreativeList}
                    production={bookProduction}
                    awaitingApproval={wizRef.status !== 'approved'}
                    lockFormat={WIZ_FORMAT[wizType] || 'video_roll'}
                  />
                  <div className="mkt-wiz-actions">
                    <button type="button" className="mkt-secondary" onClick={() => goStep(2)}>
                      Back to your ad
                    </button>
                  </div>
                </>
              )}

              {wizExit && (
                <div className="mkt-panel mkt-panel-muted mkt-wiz-exit">
                  <p style={{ margin: 0 }}>
                    <strong>Saved, but not finished.</strong> Your product and anything you
                    uploaded are kept under reference <code>{wizRef?.reference}</code>. Nothing
                    will run until you book a slot and pay for it, and we cannot review a
                    booking that does not exist yet.
                  </p>
                  <p className="mkt-fine">
                    Pick it up any time from <strong>My products</strong> on this page.
                  </p>
                  <div className="mkt-wiz-actions">
                    <button type="button" className="mkt-primary" onClick={() => { setWizExit(false); goStep(3); }}>
                      Book a slot now
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
                      Leave it for now
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
              <h2>Your products</h2>
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
                    ? `${pending.projectName || 'A product'} is still under review. We come back to you on that one before you start another.`
                    : 'Register another product'}
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
                  <span aria-hidden="true">+</span> New
                </button>
                );
              })()}
              <button
                type="button"
                className="mkt-codebtn"
                aria-expanded={showLookup}
                aria-controls="mkt-lookup-form"
                title="Open a product with the reference you were given"
                onClick={() => setShowLookup((v) => !v)}
              >
                Open by code
              </button>
              </div>
            </div>

            {showLookup && (
              <form className="mkt-lookup" id="mkt-lookup-form" onSubmit={onLookup}>
                <label className="mkt-visually-hidden" htmlFor="mkt-ref">Product reference</label>
                <input
                  id="mkt-ref"
                  value={lookupRef}
                  onChange={(e) => setLookupRef(e.target.value)}
                  placeholder="Open by reference"
                  autoComplete="off"
                  // Only ever rendered by pressing the button above, so taking the
                  // caret is finishing that action rather than stealing focus.
                  autoFocus
                />
                <button type="submit" className="mkt-secondary" disabled={lookingUp || !lookupRef.trim()}>
                  {lookingUp ? 'Checking…' : 'Open'}
                </button>
              </form>
            )}
            {/* Said in the panel too, not only in a tooltip nobody hovers on a phone. */}
            {user && (myApps || []).some((a) => a.status === 'pending') && (
              <p className="mkt-fine">
                One product is under review. We come back to you on that one before you
                start another.
              </p>
            )}

            {!user && (
              <div className="mkt-panel mkt-panel-muted">
                <p style={{ margin: 0 }}>
                  Log in to see the products registered to your Hive account, or open a single
                  one with its reference.
                </p>
              </div>
            )}

            {mineBusy && !myApps && <p className="mkt-fine">Looking…</p>}

            {mineError && (
              <div className="mkt-panel mkt-panel-muted">
                <p style={{ margin: 0 }}>{mineError.message || 'Could not load your products'}</p>
                <p className="mkt-fine">You can still open one with its reference.</p>
              </div>
            )}

            {myApps && myApps.length === 0 && !mineBusy && (
              <p className="mkt-fine">
                Nothing yet under @{user}. Register a product and it will show up here.
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
                          {a.production?.requested ? ' · we are making it' : null}
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
                  Sign once to list every product registered to your account. We remember it on
                  this device afterwards, so you will not be asked again here.
                </p>
                <button type="button" className="mkt-secondary" onClick={() => setForceSigned(true)}>
                  Show my products
                </button>
              </>
            )}

            {myApps && myApps.length > 0 && (
              <p className="mkt-fine">
                Registered one on another browser?{' '}
                <button type="button" className="mkt-linkish" onClick={() => setForceSigned(true)}>
                  Fetch the full list
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
                  <div className="mkt-ptabs" role="tablist" aria-label="This product">
                    {PRODUCT_TABS.map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        role="tab"
                        aria-selected={ptab === t.id}
                        className={`mkt-ptab${ptab === t.id ? ' selected' : ''}`}
                        onClick={() => setPtab(t.id)}
                      >
                        {t.label}
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
                          <span>{label}</span>
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
                  <CreativePanel
                    reference={lookupRef.trim()}
                    account={lookup.hiveAccount}
                    maxSeconds={pricing?.maxCreativeSeconds}
                    bannerSpec={pricing?.formats?.find((f) => f.key === 'video_banner')?.creativeSpec}
                    onCreatives={setCreativeList}
                    pending={lookup.status !== 'approved'}
                    production={!!lookup.production?.requested}
                    brand={{
                      productName: lookup.projectName,
                      logoUrl: lookup.logoUrl,
                      slogan: lookup.slogan,
                    }}
                    offer={lookup.status === 'approved' && !lookup.production?.requested ? {
                      ...bookProduction,
                      feeHbd: pricing?.productionFeeHbd,
                      onChange: setBookProduction,
                    } : null}
                  />
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
                    production={bookProduction}
                    awaitingApproval={lookup.status !== 'approved'}
                    view={ptab}
                    step={ptab === 'book' ? bookStep : null}
                    onBooked={() => setBookStep(3)}
                  />
                )}

                {ptab === 'book' && (lookup.status === 'pending' || lookup.status === 'approved') && (
                  <div className="mkt-wiz-actions">
                    {bookStep === 1 && (
                      <button type="button" className="mkt-primary" onClick={() => setBookStep(2)}>
                        Next: the booking
                      </button>
                    )}
                    {bookStep === 2 && (
                      <button type="button" className="mkt-outline" onClick={() => setBookStep(1)}>
                        Back to your ad
                      </button>
                    )}
                    {bookStep === 3 && (
                      <>
                        <button
                          type="button"
                          className="mkt-primary"
                          onClick={() => { setPtab('active'); setBookStep(1); }}
                        >
                          Done
                        </button>
                        <button type="button" className="mkt-outline" onClick={() => setBookStep(2)}>
                          Book another
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
                    ? 'Pick a product above to see its ad videos and bookings.'
                    : 'Open a product with its reference to see its ad videos and bookings.'}
                </p>
              </div>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}
