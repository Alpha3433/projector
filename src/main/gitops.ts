import fs from 'fs'
import path from 'path'
import { simpleGit, type SimpleGit } from 'simple-git'

function authConfig(token?: string): string[] {
  if (!token) return []
  // Per-command -c config keeps the token out of .git/config on disk.
  const basic = Buffer.from(`x-access-token:${token}`).toString('base64')
  return [`http.extraheader=AUTHORIZATION: basic ${basic}`]
}

export interface SyncOptions {
  dir: string
  owner: string
  repo: string
  branch: string
  token?: string
  onLine?: (text: string) => void
}

/**
 * Ensure `dir` contains a clone of the repo with `branch` checked out and
 * reset to the remote tip. The clone is Projector's private cache, so a
 * forced checkout/reset is safe and keeps state predictable.
 * Resolves with the full sha of the checked-out HEAD.
 */
export async function syncRepo({ dir, owner, repo, branch, token, onLine }: SyncOptions): Promise<string> {
  const url = `https://github.com/${owner}/${repo}.git`
  const config = authConfig(token)

  if (!fs.existsSync(path.join(dir, '.git'))) {
    fs.mkdirSync(path.dirname(dir), { recursive: true })
    onLine?.(`Cloning ${owner}/${repo} (this can take a moment on large repos)…`)
    // Blobless partial clone: GitHub supports it and it dramatically speeds
    // up large repos; missing blobs are fetched on demand at checkout.
    await simpleGit({ config }).clone(url, dir, ['--filter=blob:none'])
  }

  const git: SimpleGit = simpleGit({ baseDir: dir, config })
  onLine?.('Fetching latest from origin…')
  await git.fetch(['origin', '--prune'])
  onLine?.(`Checking out ${branch}…`)
  await git.checkout(['-f', '-B', branch, `origin/${branch}`])
  const head = (await git.revparse(['HEAD'])).trim()
  onLine?.(`Now at ${head.slice(0, 7)} on ${branch}`)
  return head
}
