import type { TeamClient } from './client.js'
import { createLimiter } from './limiter.js'

export interface OwnerResolver {
  isOwner(owners: string[], user: string): Promise<boolean>
}

/** GitHub allows teams nested up to 5 levels; keep a little headroom. */
const MAX_DEPTH = 10
const MAX_CONCURRENCY = 8

function memo<T>(cache: Map<string, Promise<T>>, key: string, load: () => Promise<T>): Promise<T> {
  let hit = cache.get(key)
  if (!hit) {
    hit = load()
    cache.set(key, hit)
    // Do not cache failures, so a later call can retry.
    hit.catch(() => cache.delete(key))
  }
  return hit
}

/**
 * Resolves true as soon as one promise is true. If none is true, rejects with the first
 * error (if any), so a failing owner never masks a match from another owner.
 */
function any(promises: Promise<boolean>[]): Promise<boolean> {
  return new Promise((resolve, reject) => {
    let pending = promises.length
    let firstError: { error: unknown } | undefined
    const settle = (): void => {
      if (--pending > 0) return
      if (firstError) reject(firstError.error)
      else resolve(false)
    }
    if (pending === 0) resolve(false)
    for (const p of promises) {
      p.then(
        (v) => (v ? resolve(true) : settle()),
        (error: unknown) => {
          firstError ??= { error }
          settle()
        }
      )
    }
  })
}

export function createOwnerResolver(client: TeamClient): OwnerResolver {
  const limit = createLimiter(MAX_CONCURRENCY)
  const members = new Map<string, Promise<boolean>>()
  const children = new Map<string, Promise<string[]>>()
  const teamResults = new Map<string, Promise<boolean>>()

  const direct = (org: string, team: string, user: string): Promise<boolean> =>
    memo(members, `${org}/${team}/${user}`, () => limit(() => client.isTeamMember(org, team, user)))

  const childrenOf = (org: string, team: string): Promise<string[]> =>
    memo(children, `${org}/${team}`, () => limit(() => client.listChildTeams(org, team)))

  /**
   * Breadth-first walk of the team tree. GitHub usually counts child-team members as
   * members of the parent team, but the membership endpoint is not guaranteed to report
   * that in every case, so we explicitly check descendants too. `visited` guards against
   * cycles and `MAX_DEPTH` bounds the walk.
   */
  async function inTeamTree(org: string, root: string, user: string): Promise<boolean> {
    const visited = new Set<string>([root])
    let level = [root]
    for (let depth = 0; level.length > 0 && depth <= MAX_DEPTH; depth++) {
      if (await any(level.map((team) => direct(org, team, user)))) return true
      if (depth === MAX_DEPTH) break
      const next: string[] = []
      for (const kids of await Promise.all(level.map((team) => childrenOf(org, team)))) {
        for (const kid of kids.map((k) => k.toLowerCase())) {
          if (!visited.has(kid)) {
            visited.add(kid)
            next.push(kid)
          }
        }
      }
      level = next
    }
    return false
  }

  function ownerMatches(owner: string, user: string): Promise<boolean> {
    const entry = owner.trim().toLowerCase()
    if (!entry.startsWith('@')) {
      // Email (or malformed) owner: can only match the user string literally.
      return Promise.resolve(entry !== '' && entry === user)
    }
    const name = entry.slice(1)
    const slash = name.indexOf('/')
    if (slash === -1) return Promise.resolve(name !== '' && name === user)
    const org = name.slice(0, slash)
    const team = name.slice(slash + 1)
    if (org === '' || team === '' || team.includes('/')) return Promise.resolve(false)
    return memo(teamResults, `${org}/${team}/${user}`, () => inTeamTree(org, team, user))
  }

  return {
    isOwner(owners, user) {
      const login = user.trim().replace(/^@/, '').toLowerCase()
      if (login === '') return Promise.resolve(false)
      return any(owners.map((o) => ownerMatches(o, login)))
    }
  }
}
