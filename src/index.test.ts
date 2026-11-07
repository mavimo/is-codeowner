import * as core from '@actions/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CheckDeps } from './check.js'
import { run } from './index.js'

vi.mock('@actions/core')

const deps: CheckDeps = {
  locate: () => Promise.resolve(null),
  createClient: () => ({
    isTeamMember: () => Promise.resolve(false),
    listChildTeams: () => Promise.resolve([])
  })
}

function inputs(values: Record<string, string>): void {
  vi.mocked(core.getInput).mockImplementation((name) => values[name] ?? '')
}

const outputs = (): Record<string, string> =>
  Object.fromEntries(vi.mocked(core.setOutput).mock.calls.map(([k, v]) => [k, v as string]))

describe('run', () => {
  beforeEach(() =>
    inputs({
      user: 'alice',
      token: 'tok',
      files: 'a.ts\nb.md\nc.go',
      codeowners: '*.ts @alice\n*.md @bob'
    })
  )
  afterEach(() => vi.resetAllMocks())

  it('sets all outputs', async () => {
    await run(deps)
    expect(outputs()).toEqual({
      result: 'false',
      'unowned-files': 'c.go',
      'not-owned-files': 'b.md'
    })
    expect(core.setFailed).not.toHaveBeenCalled()
    expect(core.setSecret).toHaveBeenCalledWith('tok')
  })

  it('returns true with empty outputs when the user owns everything', async () => {
    inputs({ user: '@Alice', files: '["a.ts"]', codeowners: '*.ts @alice' })
    await run(deps)
    expect(outputs()).toEqual({ result: 'true', 'unowned-files': '', 'not-owned-files': '' })
  })

  it('is vacuously true with no files', async () => {
    inputs({ user: 'alice', files: '', codeowners: '* @bob' })
    await run(deps)
    expect(outputs().result).toBe('true')
    expect(core.info).toHaveBeenCalledWith(expect.stringContaining('vacuously'))
  })

  it('fails when CODEOWNERS is missing', async () => {
    inputs({ user: 'alice', files: 'a' })
    await run(deps)
    expect(core.setFailed).toHaveBeenCalledWith(expect.stringContaining('No CODEOWNERS file found'))
    expect(core.setOutput).not.toHaveBeenCalled()
  })

  it('fails on empty user', async () => {
    inputs({ user: ' @ ' })
    await run(deps)
    expect(core.setFailed).toHaveBeenCalledWith('Input "user" must not be empty')
  })

  it('fails on invalid files JSON', async () => {
    inputs({ user: 'alice', files: '[oops', codeowners: '* @a' })
    await run(deps)
    expect(core.setFailed).toHaveBeenCalledWith(expect.stringContaining('JSON'))
  })

  it('stringifies non-Error throwables', async () => {
    vi.mocked(core.getInput).mockImplementation(() => {
      throw 'oops'
    })
    await run(deps)
    expect(core.setFailed).toHaveBeenCalledWith('oops')
  })
})
