import type { BranchInfo, RepoInfo } from '../shared/types'

const API = 'https://api.github.com'

async function gh<T>(token: string, pathname: string): Promise<T> {
  const res = await fetch(`${API}${pathname}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'projector-app'
    }
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`GitHub API ${res.status} for ${pathname}${body ? `: ${body.slice(0, 200)}` : ''}`)
  }
  return (await res.json()) as T
}

export async function getUser(token: string): Promise<{ login: string; avatarUrl?: string }> {
  const u = await gh<{ login: string; avatar_url?: string }>(token, '/user')
  return { login: u.login, avatarUrl: u.avatar_url }
}

interface RawRepo {
  id: number
  name: string
  full_name: string
  description: string | null
  private: boolean
  default_branch: string
  pushed_at: string | null
  owner: { login: string }
}

export async function listRepos(token: string): Promise<RepoInfo[]> {
  const repos: RawRepo[] = []
  for (let page = 1; page <= 3; page++) {
    const batch = await gh<RawRepo[]>(
      token,
      `/user/repos?per_page=100&page=${page}&sort=pushed&affiliation=owner,collaborator,organization_member`
    )
    repos.push(...batch)
    if (batch.length < 100) break
  }
  return repos.map((r) => ({
    id: r.id,
    owner: r.owner.login,
    name: r.name,
    fullName: r.full_name,
    description: r.description ?? '',
    private: r.private,
    defaultBranch: r.default_branch,
    pushedAt: r.pushed_at ?? ''
  }))
}

export async function listBranches(token: string, owner: string, repo: string): Promise<BranchInfo[]> {
  const out: BranchInfo[] = []
  for (let page = 1; page <= 3; page++) {
    const batch = await gh<Array<{ name: string; commit?: { sha: string } }>>(
      token,
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/branches?per_page=100&page=${page}`
    )
    out.push(...batch.map((b) => ({ name: b.name, commitSha: b.commit?.sha ?? '' })))
    if (batch.length < 100) break
  }
  return out
}
