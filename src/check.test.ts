import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { checkOwnership, type CheckDeps, type CheckInput } from './check.js'
import { locateCodeowners } from './codeowners/index.js'
import type { TeamClient } from './teams/index.js'

let root: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'codeowner-'))
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

function fakeClient(
  members: Record<string, string[]>,
  children: Record<string, string[]> = {}
): TeamClient {
  return {
    isTeamMember: vi.fn((org: string, team: string, user: string) =>
      Promise.resolve((members[`${org}/${team}`] ?? []).includes(user))
    ),
    listChildTeams: vi.fn((org: string, team: string) =>
      Promise.resolve(children[`${org}/${team}`] ?? [])
    )
  }
}

function setup(client: TeamClient = fakeClient({})): {
  deps: CheckDeps
  createClient: ReturnType<typeof vi.fn>
} {
  const createClient = vi.fn(() => client)
  return { deps: { locate: locateCodeowners, createClient }, createClient }
}

const input = (over: Partial<CheckInput>): CheckInput => ({
  user: 'alice',
  files: [],
  codeowners: '',
  token: 't',
  root,
  ...over
})

function write(rel: string, content: string): void {
  const full = join(root, rel)
  mkdirSync(dirname(full), { recursive: true })
  writeFileSync(full, content)
}

describe('checkOwnership', () => {
  it.each(['.github/CODEOWNERS', 'CODEOWNERS', 'docs/CODEOWNERS'])('locates %s', async (loc) => {
    write(loc, '* @alice\n')
    const out = await checkOwnership(input({ files: ['a.ts'] }), setup().deps)
    expect(out).toMatchObject({ result: true, source: loc })
  })

  it('prefers inline codeowners over files on disk', async () => {
    write('CODEOWNERS', '* @bob\n')
    const out = await checkOwnership(
      input({ files: ['a.ts'], codeowners: '* @alice' }),
      setup().deps
    )
    expect(out).toMatchObject({ result: true, source: 'input' })
  })

  it('fails with a clear error when no CODEOWNERS exists', async () => {
    await expect(checkOwnership(input({ files: ['a'] }), setup().deps)).rejects.toThrow(
      /No CODEOWNERS file found/
    )
  })

  it('user-only owners never create the team client', async () => {
    const { deps, createClient } = setup()
    const out = await checkOwnership(
      input({ files: ['a.ts', 'b.md'], codeowners: '*.ts @Alice\n*.md @bob' }),
      deps
    )
    expect(out).toMatchObject({ result: false, notOwnedFiles: ['b.md'], unownedFiles: [] })
    expect(createClient).not.toHaveBeenCalled()
  })

  it('resolves team ownership lazily', async () => {
    const { deps, createClient } = setup(fakeClient({ 'acme/core': ['alice'] }))
    const out = await checkOwnership(input({ files: ['a.ts'], codeowners: '* @acme/core' }), deps)
    expect(out.result).toBe(true)
    expect(createClient).toHaveBeenCalledTimes(1)
    expect(createClient).toHaveBeenCalledWith('t')
  })

  it('resolves subteam membership via listChildTeams', async () => {
    const client = fakeClient({ 'acme/sub': ['alice'] }, { 'acme/parent': ['sub'] })
    const out = await checkOwnership(
      input({ files: ['a'], codeowners: '* @acme/parent' }),
      setup(client).deps
    )
    expect(out.result).toBe(true)
  })

  it('reports non-members of a team as not owned', async () => {
    const out = await checkOwnership(
      input({ files: ['a'], codeowners: '* @acme/core' }),
      setup(fakeClient({ 'acme/core': ['bob'] })).deps
    )
    expect(out).toMatchObject({ result: false, notOwnedFiles: ['a'] })
  })

  it('reports unowned files', async () => {
    const out = await checkOwnership(
      input({ files: ['a.ts', 'b.md'], codeowners: '*.ts @alice' }),
      setup().deps
    )
    expect(out).toMatchObject({ result: false, unownedFiles: ['b.md'], notOwnedFiles: [] })
  })

  it('handles a later empty rule (un-owns the file)', async () => {
    const out = await checkOwnership(
      input({ files: ['a.ts'], codeowners: '* @alice\n*.ts' }),
      setup().deps
    )
    expect(out.result).toBe(false)
    expect(out.unownedFiles.length + out.notOwnedFiles.length).toBe(1)
  })

  it('is vacuously true with no files', async () => {
    const out = await checkOwnership(input({ codeowners: '* @bob' }), setup().deps)
    expect(out).toMatchObject({ result: true, unownedFiles: [], notOwnedFiles: [] })
  })

  it('propagates team client errors', async () => {
    const client: TeamClient = {
      isTeamMember: () => Promise.reject(new Error('403 forbidden')),
      listChildTeams: () => Promise.resolve([])
    }
    await expect(
      checkOwnership(input({ files: ['a'], codeowners: '* @acme/core' }), setup(client).deps)
    ).rejects.toThrow(/403/)
  })
})
