import { useEffect, useRef, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Icon } from "../v2/Icon";
import SearchSuggest from "./SearchSuggest";
import { addRecentSearch, searchPagePath } from "./searchHelpers";
import "./NavSearch.scss";

// The top bar's search field (designs 20a at rest, 28c while typing). At rest
// it is a quiet 40px field with a "/" hint; focused it grows to the left over
// the section tabs (never pushing Create, the bell or the avatar) and opens the
// two-column dropdown. Enter, a tag or "All results" open the search page.
function NavSearch() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [term, setTerm] = useState('');
  const [debounced, setDebounced] = useState('');
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(term.trim()), 400);
    return () => clearTimeout(timer);
  }, [term]);

  const close = useCallback(() => {
    setOpen(false);
    inputRef.current?.blur();
  }, []);

  // "/" focuses the field from anywhere that is not already a text field.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
      const el = document.activeElement;
      if (el?.tagName === 'INPUT' || el?.tagName === 'TEXTAREA' || el?.isContentEditable) return;
      e.preventDefault();
      inputRef.current?.focus();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  // A press anywhere outside the field and its dropdown closes it.
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (!wrapRef.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const goTo = useCallback((path) => {
    setTerm('');
    setDebounced('');
    close();
    navigate(path);
  }, [close, navigate]);

  const search = useCallback((value) => {
    const q = String(value || '').trim();
    if (q.length < 2) return;
    addRecentSearch(q);
    goTo(searchPagePath(q));
  }, [goTo]);

  return (
    <div
      className={`navsearch-wrap${open ? ' is-open' : ''}${term ? ' has-value' : ''}`}
      ref={wrapRef}
      // Tabbing out of the field and its dropdown closes it, like a click outside.
      onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false); }}
    >
      <div className="navsearch-field">
        <Icon name="search" size={20} className="navsearch-icon" />
        <input
          ref={inputRef}
          value={term}
          onChange={(e) => { setTerm(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') search(term);
            if (e.key === 'Escape') close();
          }}
          type="search"
          enterKeyHint="search"
          placeholder={t('common.actions.search')}
          aria-label={t('common.actions.search')}
          className="navsearch-input"
        />
        {open ? (
          <button type="button" className="navsearch-key" aria-label={t('common.actions.close')} onMouseDown={(e) => { e.preventDefault(); close(); }}>esc</button>
        ) : term ? (
          <button type="button" className="navsearch-clear" aria-label={t('feeds.discover.clearSearch')} onClick={() => { setTerm(''); inputRef.current?.focus(); }}>
            <Icon name="close" size={16} />
          </button>
        ) : (
          <span className="navsearch-key" aria-hidden="true">/</span>
        )}
      </div>
      {open && (
        <SearchSuggest className="navsearch-dropdown" term={debounced} onSearch={search} onNavigate={goTo} />
      )}
    </div>
  );
}

export default NavSearch;
