/**
 * The advertising market at a glance: the audience forecast (InventoryPanel) and the
 * grouped, expandable rate card (RateCard), plus the pricing and format helpers they
 * share with the booking form.
 *
 * Moved out of page/Advertise.jsx so the warm-up profile of an ADVERTISER can show
 * the same panels without loading the whole Advertise page. Both pages import from
 * here; the markup is styled by page/Advertise.scss under `.mkt-page`, so a page
 * embedding these wraps them in `.mkt-page.mkt-embed` (see that file).
 */
import { formatCount, slotLabel, countryName } from '../../lib/advertiseData';
import {
  SHOW_MARKETS,
  SITE_ONLY_SURFACES,
  SURFACE_LABEL,
  EXAMPLE_SECONDS,
  EXAMPLE_DAYS,
  LONG_EXAMPLE_DAYS,
  flightPrice,
  hiveEquivalent,
  suppliesFor,
  specFor,
  savingAt,
  groupByFormat,
} from '../../lib/adMarket';
import '../../page/Advertise.scss';
import { useTranslation, Trans } from 'react-i18next';

function StatTile({ value, label, note }) {
  return (
    <div className="mkt-stat">
      <span className="mkt-stat-value">{value}</span>
      <span className="mkt-stat-label">{label}</span>
      {note ? <span className="mkt-stat-note">{note}</span> : null}
    </div>
  );
}

export function InventoryPanel({ data, isLoading, error }) {
  const { t } = useTranslation();
  if (isLoading) return <div className="mkt-panel mkt-panel-muted">{t('ads.inventory.loading')}</div>;

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
          {t('ads.inventory.switchedOff')}
        </div>
      );
    }
    return (
      <div className="mkt-panel mkt-panel-muted">
        {error.status === 503
          ? t('ads.inventory.recalculating')
          : t('ads.inventory.unavailable')}
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
        <StatTile value={formatCount(audience?.sessionsPerDay)} label={t('ads.inventory.sessionsPerDay')} note={t('ads.inventory.sessionsNote')} />
        {/* Distinct videos with at least one counted watch in the window (adInventory.js),
            not uploads and not plays. "In the pool" read as either. */}
        <StatTile value={formatCount(audience?.videos)} label={t('ads.inventory.videosWatched')} note={t('ads.inventory.videosNote', { days: data.windowDays })} />
        <StatTile value={formatCount(audience?.watchHours)} label={t('ads.inventory.watchHours')} note={t('ads.inventory.lastDays', { days: data.windowDays })} />
      </div>

      <div className="mkt-slots">
        <h3>{t('ads.inventory.whereTitle')}</h3>
        <div className="mkt-table-wrap">
          <table className="mkt-table">
            <thead>
              <tr>
                <th>{t('ads.inventory.placement')}</th>
                <th className="num">{t('ads.inventory.playsDay')}</th>
                <th className="num">{t('ads.inventory.playsMonth')}</th>
                <th className="num">{t('ads.inventory.reach')}</th>
              </tr>
            </thead>
            <tbody>
              {ordered.map((s) => (
                <tr key={s.percent}>
                  <td>
                    {slotLabel(s)}
                    {s.percent === 0 ? <span className="mkt-tag">{t('ads.inventory.notRecommendedTag')}</span> : null}
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
          <Trans i18nKey="ads.inventory.notRecommendedNote" components={{ b: <strong /> }} />
        </p>
      </div>

      {SHOW_MARKETS && topCountries.length > 0 && (
        <div className="mkt-countries">
          <h3>{t('ads.inventory.whoWatches')}</h3>
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
            <Trans
              i18nKey="ads.inventory.qualityNote"
              values={{ pct: quality.removedPct, seconds: quality.minEngagedSeconds }}
              components={{ b: <strong /> }}
            />
          </span>
        </p>
      )}
    </div>
  );
}

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
export function RateCard({ pricing }) {
  const { t } = useTranslation();
  const formats = pricing?.formats || [];
  if (!formats.length) return null;
  const days = Math.max(EXAMPLE_DAYS, pricing?.minDays || 0) || null;

  return (
    <div className="mkt-format-groups">
    {groupByFormat(formats, (f) => f.key).map((g) => (
    <section key={g.id} className="mkt-format-group" aria-label={t(g.title)}>
      <h3 className="mkt-group-title">{t(g.title)}</h3>
      {g.note ? <p className="mkt-group-note">{t(g.note)}</p> : null}
    <ul className="mkt-ratecard">
      {g.items.map((f) => {
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
                <span className="mkt-rc-unit">{t('ads.rateCard.perSecDay')}</span>
              </span>
            </div>

            <p className="mkt-rc-blurb">{f.blurb}</p>

            {/* Name, rate and one line by default; the facts and the worked prices on
                request. Five tiles in full were a wall of numbers before anyone had
                picked a format to care about. Native <details>, so it opens from the
                keyboard and is announced without any state of ours. */}
            <details className="mkt-rc-more">
            <summary>{t('ads.rateCard.details')}</summary>
            <dl className="mkt-rc-facts">
              <div>
                <dt>{t('ads.rateCard.whereRuns')}</dt>
                <dd>{SURFACE_LABEL[f.surface] ? t(SURFACE_LABEL[f.surface]) : f.surface}</dd>
              </div>
              {SITE_ONLY_SURFACES.has(f.surface) ? (
                <div>
                  <dt>{t('ads.rateCard.seenOn')}</dt>
                  <dd>{t('ads.rateCard.siteOnly')}</dd>
                </div>
              ) : null}
              <div>
                <dt>{t('ads.rateCard.youSupply')}</dt>
                <dd>
                  {suppliesFor(f)}
                  {f.maxSeconds ? t('ads.rateCard.upToSeconds', { seconds: f.maxSeconds }) : null}
                </dd>
              </div>
              {specFor(f).rows.map((r) => (
                <div key={r.label}>
                  <dt>{r.label}</dt>
                  <dd>
                    {r.value}
                    {r.note ? <span className="mkt-rc-sub">{r.note}</span> : null}
                  </dd>
                </div>
              ))}
            </dl>

            {example != null ? (
              <div className="mkt-rc-example">
                <span className="mkt-rc-example-price">
                  {example} HBD
                  {hiveEquivalent(example, pricing?.hbdPerHive) != null ? (
                    <span className="mkt-rc-example-hive">
                      {' '}{t('ads.rateCard.orAboutHive', { hive: hiveEquivalent(example, pricing.hbdPerHive) })}
                    </span>
                  ) : null}
                </span>
                <span className="mkt-rc-example-note">
                  {t('ads.rateCard.forSpotOver', { seconds, days })}
                  {longer ? (
                    <>
                      {'; '}
                      <Trans
                        i18nKey="ads.rateCard.longerOffer"
                        values={{ price: longer.price, days: longer.days, saving: longer.saving }}
                        components={{ b: <strong /> }}
                      />
                    </>
                  ) : null}
                </span>
              </div>
            ) : null}
            </details>

            {f.rateIsCustom ? <span className="mkt-tag">{t('ads.rateCard.agreedRate')}</span> : null}
          </li>
        );
      })}
    </ul>
    </section>
    ))}
    </div>
  );
}
