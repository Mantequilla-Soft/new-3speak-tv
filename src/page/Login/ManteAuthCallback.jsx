import { useEffect, useRef, useState } from "react"
import { useNavigate, useSearchParams } from "react-router-dom"
import { toastIn } from '../../utils/toast';
import { useAppStore } from "../../lib/store"
import { useTranslation } from "react-i18next"
import { endWalletSession } from "../../hive-api/aioha"
import { Icon } from "../../components/v2/ui"
import mark from "../../assets/image/3S_mark.svg"
import "./Callback.scss"

// Every toast from this module is headed "Sign in"; the message becomes the
// line under it. See utils/toast.js.
const toast = toastIn('Sign in');

// Module-level guard: survives React StrictMode double-invokes and component re-mounts.
// Keyed by the OAuth code so a different flow can still run.
const processedCodes = new Set()

const ManteAuthCallback = () => {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const { setUser, setIncubationUser } = useAppStore()
  const hasRun = useRef(false)
  const [closeable, setCloseable] = useState(false)
  const [ok, setOk] = useState(null) // null = working, true = success, false = failed
  // While working (19j): 'exchange' = Butter Auth approved, checking the
  // account; 'verified' = account checked, loading the feed.
  const [stage, setStage] = useState('exchange')
  // "Taking too long? Try again" only once it really is taking long.
  const [slow, setSlow] = useState(false)
  useEffect(() => {
    if (ok !== null) return undefined
    const id = setTimeout(() => setSlow(true), 12000)
    return () => clearTimeout(id)
  }, [ok])

  const code = params.get("code")
  const state = params.get("state")
  const isPopup = state === "popup"

  // Popup flow: write the result for the opener (picked up via a 'storage'
  // event), then try to close. The opener also closes us from its side, which
  // is more reliable — some browsers refuse window.close() after the
  // cross-origin auth hop. If we're still here, show a "you can close this"
  // message instead of an endless spinner; the opener has already logged in.
  const finishPopup = (result) => {
    try {
      localStorage.setItem("butrauth_login_result", JSON.stringify({ ...result, ts: Date.now() }))
    } catch { /* ignore */ }
    try { window.close() } catch { /* ignore */ }
    setOk(!result.error)
    setCloseable(true)
  }

  useEffect(() => {
    const handleAuth = async () => {
      if (hasRun.current) return
      hasRun.current = true

      // Also guard at the module level against StrictMode re-mounts reusing the same code
      if (code && processedCodes.has(code)) return
      if (code) processedCodes.add(code)

      // Only `code` is required. The `username` redirect param is deliberately
      // NOT read: it is absent for an INCUBATING login, and the exchange response
      // is the authoritative answer about what kind of session this is anyway.
      // Requiring it here rejected the flow before the exchange could run.
      if (!code) {
        if (isPopup) return finishPopup({ error: t('auth.manteCallback.loginFailedLower') })
        toast.error(t('auth.manteCallback.butrauthFailed'))
        navigate("/")
        return
      }

      try {
        // Exchange the code via our backend. Bounded with a timeout so a hung
        // or slow backend can't leave the popup spinning indefinitely.
        const ctrl = new AbortController()
        const timer = setTimeout(() => ctrl.abort(), 25000)
        let res
        try {
          res = await fetch("/api/manteauth/exchange", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({
              code,
              redirect_uri: window.location.origin + "/callback"
            }),
            signal: ctrl.signal
          })
        } finally {
          clearTimeout(timer)
        }

        // A gateway timeout/5xx returns HTML, not JSON — read defensively so a
        // parse error doesn't mask the real status.
        let data = {}
        try { data = await res.json() } catch { /* non-JSON error body */ }
        // A session is valid with EITHER a Hive account or an incubation handle.
        if (!res.ok || (!data.username && !data.handle)) {
          throw new Error(data.error || t('auth.manteCallback.exchangeFailedStatus', { status: res.status }))
        }

        setStage('verified')

        // Local marker that we're in a ManteAuth-backed session. Username is
        // also in the threespeak_user cookie (non-sensitive). localStorage is
        // shared with the opener, so this also keeps a later reload logged in.
        localStorage.setItem("manteauth_login", "true")

        // Full-page login (popup blocked) on top of a wallet session: end that
        // session here, the popup path does it in App.
        if (!isPopup) await endWalletSession()

        if (data.incubation) {
          // The handle is deliberately kept OUT of `user_id`. getOperationUser()
          // reads that key and everything that builds a Hive operation reads
          // getOperationUser() — putting a handle there would have every
          // broadcast try to post as an account that does not exist, which is
          // exactly the failure the null hiveUsername is designed to prevent.
          if (isPopup) return finishPopup({ handle: data.handle, incubation: true })

          // Writes the handle key and clears user_id itself, so the store and
          // localStorage cannot disagree about which kind of session this is.
          setIncubationUser(data.handle)
          toast.success(t('auth.manteCallback.signedInAs', { handle: data.handle }))
          navigate(state || "/")
          return
        }

        localStorage.setItem("user_id", data.username)
        localStorage.removeItem("incubation_handle")

        if (isPopup) return finishPopup({ username: data.username })

        setUser(data.username)
        toast.success(t('auth.manteCallback.loggedInAs', { username: data.username }))
        navigate(state || "/")
      } catch (err) {
        const msg = err?.name === "AbortError"
          ? t('auth.manteCallback.timedOut')
          : (err?.message || t('auth.manteCallback.exchangeFailed'))
        if (isPopup) return finishPopup({ error: msg })
        toast.error(t('auth.manteCallback.butrauthFailedWith', { msg }))
        navigate("/")
      }
    }

    handleAuth()
  }, [])

  // 19j: the mark at the top; at the bottom a big status line, then the steps
  // as cards (done = check, now = cyan spinner) and, when it drags on, a way
  // to start over. Success and failure end in one status card (42a "You're in").
  const tryAgain = () => {
    if (isPopup) { try { window.close() } catch { /* ignore */ } }
    navigate("/")
  }
  const steps = [
    { label: t('auth.manteCallback.steps.approved'), done: true },
    { label: t('auth.manteCallback.steps.verified'), done: stage === 'verified' },
    { label: t('auth.manteCallback.steps.loading'), done: false, now: stage === 'verified' },
  ]
  return (
    <div className="signin-cb">
      <div className="signin-cb__box" role="status" aria-live="polite">
        <img className="signin-cb__mark" src={mark} alt="3Speak" />
        {ok === false ? (
          <>
            <h1 className="signin-cb__title">{t('auth.manteCallback.loginFailed')}</h1>
            <div className="signin-cb__steps">
              <div className="signin-cb__card is-error">
                <Icon name="error" size={24} />
                <span>{t('auth.manteCallback.closeAndRetry')}</span>
              </div>
            </div>
          </>
        ) : ok === true ? (
          <>
            <h1 className="signin-cb__title">{t('auth.manteCallback.youreIn')}</h1>
            <div className="signin-cb__steps">
              <div className="signin-cb__card">
                <Icon name="check_circle" size={24} />
                <span>{closeable ? t('auth.manteCallback.closeAndReturn') : t('auth.manteCallback.signingIn')}</span>
              </div>
            </div>
          </>
        ) : (
          <>
            <h1 className="signin-cb__title">{t('auth.manteCallback.signingIn')}</h1>
            <ol className="signin-cb__steps">
              {steps.map((st, i) => {
                const now = st.now || (!st.done && steps.slice(0, i).every((x) => x.done) && !steps.some((x) => x.now))
                return (
                  <li key={st.label} className={`signin-cb__card${st.done ? ' is-done' : now ? ' is-now' : ' is-next'}`}>
                    <Icon
                      name={st.done ? 'check_circle' : now ? 'progress_activity' : 'radio_button_unchecked'}
                      size={24}
                      className={now ? 'v2-spin' : undefined}
                    />
                    <span>{st.label}</span>
                  </li>
                )
              })}
            </ol>
            {slow && (
              <p className="signin-cb__slow">
                {t('auth.manteCallback.tooLong')}{' '}
                <button type="button" className="signin-cb__retry" onClick={tryAgain}>{t('common.actions.tryAgain')}</button>
              </p>
            )}
          </>
        )}
      </div>
    </div>
  )
}

export default ManteAuthCallback
