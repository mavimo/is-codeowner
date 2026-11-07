import { getOctokit } from '@actions/github'

/** Thin abstraction over Octokit so the resolver can be tested with a fake. */
export interface TeamClient {
  /** DIRECT, active membership only. Returns false on 404. */
  isTeamMember(org: string, teamSlug: string, user: string): Promise<boolean>
  /** Slugs of the direct child teams. Returns [] on 404. */
  listChildTeams(org: string, teamSlug: string): Promise<string[]>
}

function statusOf(error: unknown): number | undefined {
  if (typeof error === 'object' && error !== null && 'status' in error) {
    const status = (error as { status: unknown }).status
    return typeof status === 'number' ? status : undefined
  }
  return undefined
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isRateLimit(error: unknown, status: number | undefined): boolean {
  if (status === 429) return true
  if (status !== 403) return false
  const headers = (error as { response?: { headers?: Record<string, string | undefined> } })
    .response?.headers
  return (
    headers?.['retry-after'] !== undefined ||
    headers?.['x-ratelimit-remaining'] === '0' ||
    /rate limit/i.test(messageOf(error))
  )
}

function mapError(error: unknown, what: string): Error {
  const status = statusOf(error)
  if (isRateLimit(error, status)) {
    return new Error(
      `GitHub API rate limit hit while trying to ${what} (HTTP ${status}): ${messageOf(error)}. ` +
        'Wait and re-run the workflow, or use a token with a higher rate limit.',
      { cause: error }
    )
  }
  if (status === 401 || status === 403) {
    return new Error(
      `Unable to ${what} (HTTP ${status}): ${messageOf(error)}. ` +
        'Reading GitHub team membership requires a token with the `read:org` scope ' +
        '(a classic PAT with read:org, a fine-grained PAT with organization "Members" read ' +
        'permission, or a GitHub App token with the same permission). ' +
        'The default GITHUB_TOKEN cannot read organization team membership.',
      { cause: error }
    )
  }
  return new Error(
    `Failed to ${what}${status === undefined ? '' : ` (HTTP ${status})`}: ${messageOf(error)}`,
    {
      cause: error
    }
  )
}

export function createOctokitTeamClient(token: string): TeamClient {
  const octokit = getOctokit(token)

  return {
    async isTeamMember(org, teamSlug, user) {
      try {
        const { data } = await octokit.rest.teams.getMembershipForUserInOrg({
          org,
          team_slug: teamSlug,
          username: user
        })
        // A pending invitation is not a membership.
        return data.state === 'active'
      } catch (error) {
        if (statusOf(error) === 404) return false
        throw mapError(error, `check membership of ${user} in team ${org}/${teamSlug}`)
      }
    },

    async listChildTeams(org, teamSlug) {
      try {
        const children = await octokit.paginate(octokit.rest.teams.listChildInOrg, {
          org,
          team_slug: teamSlug,
          per_page: 100
        })
        return children.map((team) => team.slug)
      } catch (error) {
        if (statusOf(error) === 404) return []
        throw mapError(error, `list child teams of ${org}/${teamSlug}`)
      }
    }
  }
}
