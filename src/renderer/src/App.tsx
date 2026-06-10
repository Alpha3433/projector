import { useEffect, useState } from 'react'
import type { AuthState, BranchInfo, ProjectSelection } from '../../shared/types'
import { api } from './api'
import RepoPicker from './screens/RepoPicker'
import SignIn from './screens/SignIn'
import Workspace from './screens/Workspace'

export interface WorkspaceSelection extends ProjectSelection {
  branches: BranchInfo[]
}

type Route =
  | { name: 'loading' }
  | { name: 'signin' }
  | { name: 'picker' }
  | { name: 'workspace'; sel: WorkspaceSelection }

export default function App(): JSX.Element {
  const [route, setRoute] = useState<Route>({ name: 'loading' })
  const [auth, setAuth] = useState<AuthState | null>(null)

  useEffect(() => {
    void api.getAuthState().then((state) => {
      setAuth(state)
      setRoute(state.signedIn ? { name: 'picker' } : { name: 'signin' })
    })
  }, [])

  if (route.name === 'loading') {
    return <div className="app-loading">Projector</div>
  }
  if (route.name === 'signin') {
    return (
      <SignIn
        auth={auth}
        onSignedIn={(state) => {
          setAuth(state)
          setRoute({ name: 'picker' })
        }}
      />
    )
  }
  if (route.name === 'picker') {
    return (
      <RepoPicker
        auth={auth!}
        onSignOut={() => {
          void api.signOut().then(async () => {
            setAuth(await api.getAuthState())
            setRoute({ name: 'signin' })
          })
        }}
        onOpen={(sel) => setRoute({ name: 'workspace', sel })}
      />
    )
  }
  return <Workspace sel={route.sel} onBack={() => setRoute({ name: 'picker' })} />
}
