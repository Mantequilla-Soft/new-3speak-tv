/**
 * `promise`'s value if it settles within `ms`, else `fallback`. A rejection also
 * gives `fallback`, so this never rejects: for extras a page can go without (the
 * warm-up Shorts in the Shorts feed) that must never hold up what it shows.
 */
export function settleWithin(promise, ms, fallback) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms);
    Promise.resolve(promise).then(
      (value) => { clearTimeout(timer); resolve(value); },
      () => { clearTimeout(timer); resolve(fallback); },
    );
  });
}
