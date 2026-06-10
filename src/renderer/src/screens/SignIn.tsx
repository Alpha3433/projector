import { useEffect, useState } from 'react'
import type { AuthState } from '../../../shared/types'
import { api } from '../api'

interface Props {
  auth: AuthState | null
  onSignedIn: (state: AuthState) => void
}

export default function SignIn({ auth, onSignedIn }: Props): JSX.Element {
  const [pat, setPat] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showDeviceFlow, setShowDeviceFlow] = useState(false)
  const [clientId, setClientId] = useState(auth?.clientId ?? '')
  const [flow, setFlow] = useState<{ userCode: string; verificationUri: string } | null>(null)

  useEffect(() => {
    return api.onDeviceFlow((e) => {
      if (e.type === 'code') {
        setFlow({ userCode: e.userCode, verificationUri: e.verificationUri })
      } else if (e.type === 'success') {
        setFlow(null)
        setBusy(false)
        void api.getAuthState().then(onSignedIn)
      } else {
        setFlow(null)
        setBusy(false)
        setError(e.message)
      }
    })
  }, [onSignedIn])

  const signInWithPat = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      onSignedIn(await api.signInWithToken(pat))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setBusy(false)
    }
  }

  const startFlow = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    await api.saveClientId(clientId)
    await api.startDeviceFlow(clientId)
  }

  const cancelFlow = async (): Promise<void> => {
    await api.cancelDeviceFlow()
    setFlow(null)
    setBusy(false)
  }

  return (
    <div className="signin-screen">
      <div className="signin-card">
        <div className="brand">
          <div className="brand-phone" />
          <h1>Projector</h1>
        </div>
        <p className="signin-tagline">
          Beam your GitHub branches into an iPhone on your desk. Sign in to pick a repo.
        </p>

        {error && <div className="error-banner">{error}</div>}

        {!flow && (
          <>
            <label className="field-label" htmlFor="pat">
              GitHub personal access token
            </label>
            <input
              id="pat"
              type="password"
              placeholder="ghp_… or github_pat_…"
              value={pat}
              onChange={(e) => setPat(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && pat && !busy) void signInWithPat()
              }}
              disabled={busy}
            />
            <p className="field-hint">
              Needs the <code>repo</code> scope (or a fine-grained token with repository read
              access).{' '}
              <a
                href="#create-token"
                onClick={(e) => {
                  e.preventDefault()
                  void api.openExternal(
                    'https://github.com/settings/tokens/new?scopes=repo&description=Projector'
                  )
                }}
              >
                Create one on GitHub
              </a>
            </p>
            <button className="btn btn-primary" disabled={!pat || busy} onClick={() => void signInWithPat()}>
              {busy ? 'Signing in…' : 'Sign in'}
            </button>

            <div className="divider">
              <span>or</span>
            </div>

            {!showDeviceFlow ? (
              <button className="btn btn-ghost" onClick={() => setShowDeviceFlow(true)}>
                Use OAuth device flow instead
              </button>
            ) : (
              <>
                <label className="field-label" htmlFor="client-id">
                  OAuth app client ID
                </label>
                <input
                  id="client-id"
                  type="text"
                  placeholder="Iv1.… or Ov23li…"
                  value={clientId}
                  onChange={(e) => setClientId(e.target.value)}
                  disabled={busy}
                />
                <p className="field-hint">
                  Create an OAuth app at GitHub → Settings → Developer settings and tick{' '}
                  <em>Enable Device Flow</em>. No client secret is needed.
                </p>
                <button
                  className="btn btn-primary"
                  disabled={!clientId || busy}
                  onClick={() => void startFlow()}
                >
                  {busy ? 'Waiting for GitHub…' : 'Start device flow'}
                </button>
              </>
            )}
          </>
        )}

        {flow && (
          <div className="device-flow-panel">
            <p>Enter this code on GitHub to authorize Projector:</p>
            <div
              className="user-code"
              title="Click to copy"
              onClick={() => void navigator.clipboard.writeText(flow.userCode)}
            >
              {flow.userCode}
            </div>
            <button
              className="btn btn-primary"
              onClick={() => void api.openExternal(flow.verificationUri)}
            >
              Open {flow.verificationUri.replace('https://', '')}
            </button>
            <button className="btn btn-ghost" onClick={() => void cancelFlow()}>
              Cancel
            </button>
          </div>
        )}

        {auth && !auth.encryptionAvailable && (
          <p className="field-hint warn">
            Heads up: your OS keychain isn&apos;t available, so the token will be stored without
            encryption.
          </p>
        )}
      </div>
    </div>
  )
}
