import { useEffect, useRef, useState } from "react"
import { useNavigate, useSearchParams } from "react-router-dom"
import { toastIn } from '../../utils/toast';
import { useAppStore } from "../../lib/store"

// Every toast from this module is headed "Sign in"; the message becomes the
// line under it. See utils/toast.js.
const toast = toastIn('Sign in');

// Module-level guard: survives React StrictMode double-invokes and component re-mounts.
// Keyed by the OAuth code so a different flow can still run.
const processedCodes = new Set()

const ManteAuthCallback = () => {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const { setUser, setIncubationUser } = useAppStore()
  const hasRun = useRef(false)
  const [closeable, setCloseable] = useState(false)
  const [ok, setOk] = useState(null) // null = working, true = success, false = failed

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
        if (isPopup) return finishPopup({ error: "login failed" })
        toast.error("Butter Auth login failed")
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
          throw new Error(data.error || `Token exchange failed (${res.status})`)
        }

        // Local marker that we're in a ManteAuth-backed session. Username is
        // also in the threespeak_user cookie (non-sensitive). localStorage is
        // shared with the opener, so this also keeps a later reload logged in.
        localStorage.setItem("manteauth_login", "true")

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
          toast.success(`Signed in as @${data.handle}`)
          navigate(state || "/")
          return
        }

        localStorage.setItem("user_id", data.username)
        localStorage.removeItem("incubation_handle")

        if (isPopup) return finishPopup({ username: data.username })

        setUser(data.username)
        toast.success(`Logged in as @${data.username} via Butter Auth`)
        navigate(state || "/")
      } catch (err) {
        const msg = err?.name === "AbortError"
          ? "Login timed out — please try again"
          : (err?.message || "Token exchange failed")
        if (isPopup) return finishPopup({ error: msg })
        toast.error("Butter Auth login failed: " + msg)
        navigate("/")
      }
    }

    handleAuth()
  }, [])

  return (
    <div style={{
      display: "flex",
      flexDirection: "column",
      justifyContent: "center",
      alignItems: "center",
      height: "87vh",
      textAlign: "center",
      padding: "0 20px",
      gap: "14px",
    }}>
      <style>{`
        @keyframes ba-sc-draw { to { stroke-dashoffset: 0; } }
        @keyframes ba-sc-pop { 0%{transform:scale(.85)} 55%{transform:scale(1.06)} 100%{transform:scale(1)} }
        .ba-sc { width:100px; height:100px; animation: ba-sc-pop .45s ease-out; }
        .ba-sc circle { fill:none; stroke:#e8d89b; stroke-width:2.5; opacity:.5; stroke-dasharray:1; stroke-dashoffset:1; animation: ba-sc-draw .55s ease-out forwards; }
        .ba-sc path { fill:none; stroke:#e8d89b; stroke-width:4; stroke-linecap:round; stroke-linejoin:round; stroke-dasharray:1; stroke-dashoffset:1; animation: ba-sc-draw .4s .5s ease-out forwards; filter: drop-shadow(0 0 8px rgba(232,216,155,.35)); }
        .ba-sc.err circle, .ba-sc.err path { stroke:#e05a4d; opacity:1; filter:none; }
      `}</style>
      {ok === false ? (
        <>
          <svg className="ba-sc err" viewBox="0 0 52 52" aria-hidden="true">
            <circle pathLength="1" cx="26" cy="26" r="24" />
            <path pathLength="1" d="M18 18 L34 34 M34 18 L18 34" />
          </svg>
          <h2 style={{ margin: 0 }}>Login failed</h2>
          <p style={{ margin: 0, color: "var(--text-secondary, #888)" }}>
            You can close this window and try again.
          </p>
        </>
      ) : (
        <>
          <svg className="ba-sc" viewBox="0 0 52 52" aria-hidden="true">
            <circle pathLength="1" cx="26" cy="26" r="24" />
            <path pathLength="1" d="M15 27 l7.5 7.5 L38 17" />
          </svg>
          <h2 style={{ margin: 0 }}>You're in</h2>
          <p style={{ margin: 0, color: "var(--text-secondary, #888)" }}>
            {closeable ? "You can close this window and return to 3Speak." : "Signing you in…"}
          </p>
        </>
      )}
    </div>
  )
}

export default ManteAuthCallback
