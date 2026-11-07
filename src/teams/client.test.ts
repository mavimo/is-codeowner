import { beforeEach, describe, expect, it, vi } from 'vitest'

const getMembership = vi.fn()
const listChild = vi.fn()
const paginate = vi.fn()
const getOctokit = vi.fn()

vi.mock('@actions/github', () => ({ getOctokit: (...args: unknown[]) => getOctokit(...args) }))

import { createOctokitTeamClient } from './index.js'

function httpError(status: number, message = 'err'): Error {
  return Object.assign(new Error(message), { status })
}

beforeEach(() => {
  vi.resetAllMocks()
  getOctokit.mockReturnValue({
    rest: { teams: { getMembershipForUserInOrg: getMembership, listChildInOrg: listChild } },
    paginate
  })
})

describe('createOctokitTeamClient', () => {
  it('creates octokit with the token', () => {
    createOctokitTeamClient('tok')
    expect(getOctokit).toHaveBeenCalledWith('tok')
  })

  describe('isTeamMember', () => {
    it('is true for active membership', async () => {
      getMembership.mockResolvedValue({ data: { state: 'active' } })
      expect(await createOctokitTeamClient('t').isTeamMember('acme', 'eng', 'alice')).toBe(true)
      expect(getMembership).toHaveBeenCalledWith({
        org: 'acme',
        team_slug: 'eng',
        username: 'alice'
      })
    })

    it('is false for pending membership', async () => {
      getMembership.mockResolvedValue({ data: { state: 'pending' } })
      expect(await createOctokitTeamClient('t').isTeamMember('acme', 'eng', 'alice')).toBe(false)
    })

    it('is false on 404', async () => {
      getMembership.mockRejectedValue(httpError(404))
      expect(await createOctokitTeamClient('t').isTeamMember('acme', 'eng', 'alice')).toBe(false)
    })

    it.each([401, 403])('maps %i to an actionable error', async (status) => {
      getMembership.mockRejectedValue(httpError(status, 'denied'))
      const p = createOctokitTeamClient('t').isTeamMember('acme', 'eng', 'alice')
      await expect(p).rejects.toThrow(/read:org/)
      await expect(p).rejects.toThrow(/GITHUB_TOKEN/)
      await expect(p).rejects.toThrow(/acme\/eng/)
      await expect(p).rejects.toThrow(new RegExp(`HTTP ${status}`))
    })

    it('wraps other errors with context and cause', async () => {
      const cause = httpError(502, 'bad gateway')
      getMembership.mockRejectedValue(cause)
      const err = await createOctokitTeamClient('t')
        .isTeamMember('acme', 'eng', 'alice')
        .catch((e: Error) => e)
      expect(err).toBeInstanceOf(Error)
      expect((err as Error).message).toMatch(/acme\/eng.*HTTP 502.*bad gateway/)
      expect((err as Error).cause).toBe(cause)
    })

    it('handles non-Error rejections without status', async () => {
      getMembership.mockRejectedValue('weird')
      await expect(createOctokitTeamClient('t').isTeamMember('a', 'b', 'c')).rejects.toThrow(
        /Failed to .*: weird/
      )
    })

    it('ignores non-numeric status', async () => {
      getMembership.mockRejectedValue({ status: 'x' })
      await expect(createOctokitTeamClient('t').isTeamMember('a', 'b', 'c')).rejects.toThrow(
        /Failed to/
      )
    })
  })

  describe('listChildTeams', () => {
    it('returns slugs using pagination', async () => {
      paginate.mockResolvedValue([{ slug: 'a' }, { slug: 'b' }])
      expect(await createOctokitTeamClient('t').listChildTeams('acme', 'eng')).toEqual(['a', 'b'])
      expect(paginate).toHaveBeenCalledWith(listChild, {
        org: 'acme',
        team_slug: 'eng',
        per_page: 100
      })
    })

    it('returns [] on 404', async () => {
      paginate.mockRejectedValue(httpError(404))
      expect(await createOctokitTeamClient('t').listChildTeams('acme', 'eng')).toEqual([])
    })

    it('maps 403 to an actionable error', async () => {
      paginate.mockRejectedValue(httpError(403, 'nope'))
      await expect(createOctokitTeamClient('t').listChildTeams('acme', 'eng')).rejects.toThrow(
        /read:org/
      )
    })

    it('wraps rate limit / 5xx errors with context', async () => {
      paginate.mockRejectedValue(httpError(500, 'oops'))
      await expect(createOctokitTeamClient('t').listChildTeams('acme', 'eng')).rejects.toThrow(
        /list child teams of acme\/eng \(HTTP 500\): oops/
      )
    })
  })
})
