/**
 * Pricing and format helpers for the advertising market, shared by the Advertise
 * page and the market panels (components/ads/AdMarketPanels.jsx). Plain values and
 * functions only, so the component files stay components (fast refresh).
 */
import { t } from '../i18n';

// Country breakdown and per-market targeting, hidden for now. The numbers behind
// them are real but thin at this scale — a market with a 4% share is a handful of
// sessions a day, and offering it as something to buy promises a precision we
// cannot deliver yet. Flip to true to bring back both the "Who watches" panel and
// the market chips on the form; the backend has accepted `markets` all along.
export const SHOW_MARKETS = false;

/* Which surfaces exist ONLY on 3speak.tv.
 *
 * A video roll or banner travels with the video: a 3Speak player embedded on someone
 * else's site is still a 3Speak player, and the spot is already in the manifest it
 * loads. The shorts feed and the upload studio have no embedded equivalent — they are
 * pages on this site, so a spot booked on either runs here and nowhere else.
 *
 * Stated on the page because an advertiser comparing formats on price alone reads the
 * shorts rate as buying the same reach as the video rate, and it does not. Better they
 * know which audience they are buying before they book than discover it from a
 * delivery report afterwards.
 *
 * Keyed off `surface`, the server's own word, so a format on a NEW surface is treated
 * as travelling rather than being silently labelled site-only on a guess. */
export const SITE_ONLY_SURFACES = new Set(['shorts', 'upload']);

// Where each format actually runs, in the reader's terms. Keyed off `surface`,
// which is the server's own word for it, so a format on a new surface shows the
// raw key rather than being silently mislabelled as one of these.
// Values are i18n keys; translate at render with t().
export const SURFACE_LABEL = {
  watch: 'ads.market.surface.watch',
  shorts: 'ads.market.surface.shorts',
  upload: 'ads.market.surface.upload',
};

export const EXAMPLE_SECONDS = 10;

/* The window every example price is quoted over.
 *
 * Deliberately NOT the bookable minimum. That is now one day, and a one-day quote makes
 * every format look like small change, which reads as a toy rather than as a rate card.
 * Three days is short enough to still be a real booking and long enough that the numbers
 * separate. Floored at the minimum so this cannot quote a window nobody can book. */
export const EXAMPLE_DAYS = 3;

/** The longer flight quoted beside it, to show the day rate falling. */
export const LONG_EXAMPLE_DAYS = 30;

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
export function flightPrice(days, ratePerSecondDay, seconds, dayCurveK) {
  const d = Number(days);
  const r = Number(ratePerSecondDay);
  const secs = Number(seconds);
  if (!Number.isFinite(d) || d <= 0 || !Number.isFinite(r) || !Number.isFinite(secs)) return null;
  const k = Number(dayCurveK);
  const exp = Number.isFinite(k) && k > 0 && k <= 1 ? k : 1;
  return Math.round((d ** exp) * r * secs * 1000) / 1000;
}

export function hivePayable(hbd, hbdPerHive) {
  const rate = Number(hbdPerHive);
  if (!Number.isFinite(rate) || rate <= 0 || !Number.isFinite(hbd) || hbd <= 0) return null;
  return Math.ceil((hbd / rate) * 1000) / 1000;
}

export function hiveEquivalent(hbd, hbdPerHive) {
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
export function suppliesKey(f) {
  const kinds = f?.creativeKinds?.length ? f.creativeKinds : (f ? [f.creativeKind] : []);
  if (kinds.includes('text')) return 'text';
  const image = kinds.includes('image');
  const video = kinds.includes('video');
  if (image && video) return 'imageOrVideo';
  return image ? 'image' : 'video';
}

export function suppliesFor(f) {
  return t(`ads.market.supplies.${suppliesKey(f)}`);
}

/** "You supply …" as one translated sentence. */
export function youSupply(f) {
  return t(`ads.market.youSupply.${suppliesKey(f)}`);
}

/**
 * The size and file guidance for a format, as short key/value facts for its tile.
 *
 * Rows in the tile's fact list rather than (i) buttons: a tooltip hides the one thing
 * an advertiser needs before they open an editor, and does not exist on a phone. Two
 * terse rows cost less space than a sentence and are read the same way as the rows
 * above them.
 *
 * Read from `creativeSpec`, which is the same definition the attach route enforces, so
 * the tile cannot recommend a size the server then refuses. Formats with no spec (the
 * landscape spots) have no shape rule; they get the player's own shape as advice.
 */
/**
 * The shape of the recommended banner size: its ratio, and the smallest size at that
 * ratio the server still accepts. 1456x240 gives 6:1 and 728x120. Null when the
 * recommendation is not a WxH we can read.
 */
export function bannerShape(spec) {
  const m = /^(\d+)\s*x\s*(\d+)$/i.exec(String(spec?.recommended || ''));
  if (!m) return null;
  const ratio = Number(m[1]) / Number(m[2]);
  if (!(ratio > 0)) return null;
  const minW = spec.minWidth || Number(m[1]);
  return {
    // 1456/240 is 6.07, which nobody wants to read as "6.1:1".
    ratio: Math.abs(ratio - Math.round(ratio)) < 0.1 ? Math.round(ratio) : ratio.toFixed(1),
    smallest: `${minW}×${Math.round(minW / ratio)}`,
  };
}

/** The banner size advice as one sentence, for the upload panel. */
export function bannerAdvice(spec) {
  const shape = bannerShape(spec);
  if (!shape) return t('ads.market.bannerAdvice.wideStrip');
  return t('ads.market.bannerAdvice.makeIt', {
    size: spec.recommended.replace('x', '×'), ratio: shape.ratio, smallest: shape.smallest,
  });
}

/* How long a ticker has to run for its message to be readable. The same formula the
 * checker enforces at attach (utils/adFormats.js tickerMinSeconds), with its numbers
 * read from the rate card so there is one place they live. Takes a word count or the
 * message itself. */
export function tickerMinSeconds(wordsOrMessage, spec) {
  const words = typeof wordsOrMessage === 'number'
    ? wordsOrMessage
    : (String(wordsOrMessage || '').trim() ? String(wordsOrMessage).trim().split(/\s+/).length : 0);
  const m = spec?.minSeconds || {};
  const base = Number.isFinite(m.base) ? m.base : 4;
  const perWord = Number.isFinite(m.perWord) ? m.perWord : 0.5;
  const floor = Number.isFinite(m.floor) ? m.floor : 5;
  return Math.max(floor, Math.ceil(base + perWord * words));
}

export function specFor(f) {
  const spec = f?.creativeSpec;
  const kinds = f?.creativeKinds?.length ? f.creativeKinds : [f?.creativeKind];
  // A ticker has no file to size. What it needs is the length limit, said in the same
  // two rows so the tiles still line up.
  if (kinds.includes('text')) {
    return {
      rows: [
        // The note is the readability scale: a longer message has to be booked for
        // longer, or it crosses the screen faster than anyone can read it.
        { label: t('ads.market.spec.message'), value: t('ads.market.spec.upToChars', { count: spec?.maxChars || 140 }), note: t('ads.market.spec.wordsNeed', { s10: tickerMinSeconds(10, spec), s20: tickerMinSeconds(20, spec) }) },
        { label: t('ads.market.spec.link'), value: t('ads.market.spec.anyHttps'), note: t('ads.market.spec.avatarAdded') },
      ],
    };
  }
  const files = kinds.includes('image') && kinds.includes('video')
    ? t('ads.market.spec.filesAny')
    : (kinds.includes('image') ? t('ads.market.spec.filesImage') : 'MP4 (H.264)');
  const x = (s) => String(s || '').replace('x', '×');
  const rows = (size, note) => ({ rows: [{ label: t('ads.market.spec.bestSize'), value: size, note }, { label: t('ads.market.spec.file'), value: files }] });
  if (spec?.shape === 'portrait') {
    return rows(`${x(spec.recommended)}, 9:16`, t('ads.market.spec.uprightMinWidth', { width: spec.minWidth }));
  }
  if (spec) {
    // Recommend the recommended SHAPE, not the 3:1 to 12:1 range the server will merely
    // accept: anything off that shape is letterboxed inside the banner box.
    const shape = bannerShape(spec);
    return rows(
      x(spec.recommended),
      shape ? t('ads.market.spec.orAnyRatio', { ratio: shape.ratio, smallest: shape.smallest }) : t('ads.market.spec.minWidth', { width: spec.minWidth }),
    );
  }
  return rows('1920×1080, 16:9', t('ads.market.spec.landscape'));
}

export function savingAt(days, pricing) {
  const k = Number(pricing?.dayCurveK);
  if (!(k > 0 && k < 1) || !(days > 1)) return null;
  if (pricing?.maxDays && days > pricing.maxDays) return null;
  const saving = Math.round((1 - days ** (k - 1)) * 100);
  return saving >= 5 ? saving : null;
}

/* The formats, grouped by how the viewer meets them. One list for every place the
 * formats are shown (rate card, "What are you running?"), so the two agree. A format
 * the checker adds later and nobody has placed lands in "More formats" rather than
 * disappearing. */
export const FORMAT_GROUPS = [
  {
    id: 'screen',
    // title/note are i18n keys; translate at render.
    title: 'ads.market.groups.screen.title',
    note: 'ads.market.groups.screen.note',
    keys: ['video_roll', 'shorts_roll'],
  },
  {
    id: 'overlay',
    title: 'ads.market.groups.overlay.title',
    note: 'ads.market.groups.overlay.note',
    keys: ['video_banner', 'video_ticker'],
  },
  {
    id: 'creators',
    title: 'ads.market.groups.creators.title',
    note: 'ads.market.groups.creators.note',
    keys: ['upload_gate'],
  },
];

/** Split items into FORMAT_GROUPS by their format key, keeping each group's order. */
export function groupByFormat(items, keyOf) {
  const placed = new Set(FORMAT_GROUPS.flatMap((g) => g.keys));
  const groups = FORMAT_GROUPS
    .map((g) => ({ ...g, items: g.keys.map((k) => items.find((it) => keyOf(it) === k)).filter(Boolean) }))
    .filter((g) => g.items.length);
  const rest = items.filter((it) => !placed.has(keyOf(it)));
  if (rest.length) groups.push({ id: 'more', title: 'ads.market.groups.more.title', note: null, items: rest });
  return groups;
}
