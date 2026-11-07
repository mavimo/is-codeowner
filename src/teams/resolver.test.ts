import { describe, expect, it } from 'vitest'
import { createOwnerResolver, type TeamClient } from './index.js'
import { createLimiter } from './limiter.js'

interface Fake extends TeamClient {
  calls: { member: number; children: number }
  maxInFlight: number
}

function fakeClient(
  teams: Record<string, { members?: string[]; children?: string[] }>,
  opts: { delay?: number; failWith?: Error } = {}
): Fake {
  let inFlight = 0
  const fake: Fake = {
    calls: { member: 0, children: 0 },
    maxInFlight: 0,
    async isTeamMember(org, slug, user) {
      fake.calls.member++
      inFlight++
      fake.maxInFlight = Math.max(fake.maxInFlight, inFlight)
      await new Promise((r) => setTimeout(r, opts.delay ?? 0))
      inFlight--
      if (opts.failWith) throw opts.failWith
      return teams[`${org}/${slug}`]?.members?.includes(user) ?? false
    },
    async listChildTeams(org, slug) {
      fake.calls.children++
      if (opts.failWith) throw opts.failWith
      return teams[`${org}/${slug}`]?.children ?? []
    }
  }
  return fake
}

const tree = {
  'acme/eng': { members: ['lead'], children: ['backend', 'frontend'] },
  'acme/backend': { members: ['alice'], children: ['db'] },
  'acme/db': { members: ['grace'] },
  'acme/frontend': { members: ['bob'] }
}

describe('createOwnerResolver', () => {
  it('returns false for empty owners', async () => {
    const r = createOwnerResolver(fakeClient(tree))
    expect(await r.isOwner([], 'alice')).toBe(false)
  })

  it('returns false for empty user', async () => {
    const r = createOwnerResolver(fakeClient(tree))
    expect(await r.isOwner(['@alice'], '  ')).toBe(false)
  })

  it('matches @login case-insensitively', async () => {
    const r = createOwnerResolver(fakeClient({}))
    expect(await r.isOwner(['@Alice'], 'aLiCe')).toBe(true)
    expect(await r.isOwner(['@alice'], '@alice')).toBe(true)
    expect(await r.isOwner(['@bob'], 'alice')).toBe(false)
    expect(await r.isOwner(['@'], 'alice')).toBe(false)
  })

  it('matches direct team member', async () => {
    const r = createOwnerResolver(fakeClient(tree))
    expect(await r.isOwner(['@acme/eng'], 'lead')).toBe(true)
  })

  it('matches sub-team member', async () => {
    const r = createOwnerResolver(fakeClient(tree))
    expect(await r.isOwner(['@acme/eng'], 'alice')).toBe(true)
  })

  it('matches grandchild team member', async () => {
    const r = createOwnerResolver(fakeClient(tree))
    expect(await r.isOwner(['@acme/eng'], 'grace')).toBe(true)
  })

  it('does not match sibling or parent members for a child team', async () => {
    const r = createOwnerResolver(fakeClient(tree))
    expect(await r.isOwner(['@acme/backend'], 'bob')).toBe(false)
    expect(await r.isOwner(['@acme/backend'], 'lead')).toBe(false)
  })

  it('normalizes team and org case', async () => {
    const r = createOwnerResolver(fakeClient(tree))
    expect(await r.isOwner(['@Acme/ENG'], 'Grace')).toBe(true)
  })

  it('handles unknown teams as non-members', async () => {
    const r = createOwnerResolver(fakeClient(tree))
    expect(await r.isOwner(['@acme/nope'], 'alice')).toBe(false)
  })

  it('rejects malformed team entries', async () => {
    const client = fakeClient(tree)
    const r = createOwnerResolver(client)
    expect(await r.isOwner(['@/eng', '@acme/', '@acme/a/b'], 'alice')).toBe(false)
    expect(client.calls.member).toBe(0)
  })

  it('handles email owners without crashing', async () => {
    const client = fakeClient(tree)
    const r = createOwnerResolver(client)
    expect(await r.isOwner(['a@b.com', ''], 'alice')).toBe(false)
    expect(await r.isOwner(['A@B.com'], 'a@b.com')).toBe(true)
    expect(client.calls.member).toBe(0)
  })

  it('combines mixed owners (any match wins)', async () => {
    const r = createOwnerResolver(fakeClient(tree))
    expect(await r.isOwner(['@zed', 'x@y.z', '@acme/frontend'], 'bob')).toBe(true)
  })

  it('terminates on cycles', async () => {
    const client = fakeClient({
      'acme/a': { children: ['b'] },
      'acme/b': { children: ['a', 'c'] },
      'acme/c': { members: ['carl'], children: ['a'] }
    })
    const r = createOwnerResolver(client)
    expect(await r.isOwner(['@acme/a'], 'carl')).toBe(true)
    expect(await r.isOwner(['@acme/a'], 'nobody')).toBe(false)
  })

  it('caps depth on very deep trees', async () => {
    const deep: Record<string, { members?: string[]; children?: string[] }> = {}
    for (let i = 0; i < 30; i++) deep[`acme/t${i}`] = { children: [`t${i + 1}`] }
    deep['acme/t29'] = { members: ['deep'] }
    const client = fakeClient(deep)
    const r = createOwnerResolver(client)
    expect(await r.isOwner(['@acme/t0'], 'deep')).toBe(false)
    expect(client.calls.member).toBeLessThanOrEqual(12)
  })

  it('memoizes across repeated calls', async () => {
    const client = fakeClient(tree)
    const r = createOwnerResolver(client)
    for (let i = 0; i < 1000; i++) await r.isOwner(['@acme/eng'], 'nobody')
    expect(client.calls.member).toBe(4)
    expect(client.calls.children).toBe(4)
  })

  it('shares child lists and memberships between different root teams', async () => {
    const client = fakeClient(tree)
    const r = createOwnerResolver(client)
    await r.isOwner(['@acme/eng'], 'nobody')
    const before = { ...client.calls }
    await r.isOwner(['@acme/backend'], 'nobody')
    expect(client.calls).toEqual(before)
  })

  it('dedupes concurrent in-flight lookups', async () => {
    const client = fakeClient(tree, { delay: 5 })
    const r = createOwnerResolver(client)
    const results = await Promise.all(
      Array.from({ length: 200 }, () => r.isOwner(['@acme/eng'], 'nobody'))
    )
    expect(results.every((x) => !x)).toBe(true)
    expect(client.calls.member).toBe(4)
    expect(client.calls.children).toBe(4)
  })

  it('bounds concurrency', async () => {
    const many: Record<string, { members?: string[]; children?: string[] }> = {
      'acme/root': { children: Array.from({ length: 50 }, (_, i) => `c${i}`) }
    }
    const client = fakeClient(many, { delay: 2 })
    const r = createOwnerResolver(client)
    expect(await r.isOwner(['@acme/root'], 'nobody')).toBe(false)
    expect(client.maxInFlight).toBeLessThanOrEqual(8)
    expect(client.calls.member).toBe(51)
  })

  it('propagates 403 errors with the original message', async () => {
    const err = new Error('Resource not accessible by integration')
    const r = createOwnerResolver(fakeClient(tree, { failWith: err }))
    await expect(r.isOwner(['@acme/eng'], 'alice')).rejects.toBe(err)
  })

  it('does not cache failures', async () => {
    let fail = true
    const client: TeamClient = {
      async isTeamMember() {
        if (fail) throw new Error('boom')
        return true
      },
      async listChildTeams() {
        return []
      }
    }
    const r = createOwnerResolver(client)
    await expect(r.isOwner(['@acme/x'], 'u')).rejects.toThrow('boom')
    fail = false
    expect(await r.isOwner(['@acme/x'], 'u')).toBe(true)
  })
})

describe('createLimiter', () => {
  it('runs queued tasks in order and propagates rejections', async () => {
    const limit = createLimiter(1)
    const order: number[] = []
    const a = limit(async () => {
      order.push(1)
      return 1
    })
    const b = limit(async () => {
      order.push(2)
      throw new Error('x')
    })
    const c = limit(async () => {
      order.push(3)
      return 3
    })
    expect(await a).toBe(1)
    await expect(b).rejects.toThrow('x')
    expect(await c).toBe(3)
    expect(order).toEqual([1, 2, 3])
  })
})
