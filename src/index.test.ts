import * as core from '@actions/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { run } from './index.js'

vi.mock('@actions/core')

describe('run', () => {
  afterEach(() => vi.resetAllMocks())

  it('sets the result output', async () => {
    await run()
    expect(core.setOutput).toHaveBeenCalledWith('result', 'false')
  })

  it('fails the action when an error is thrown', async () => {
    vi.mocked(core.setOutput).mockImplementation(() => {
      throw new Error('boom')
    })
    await run()
    expect(core.setFailed).toHaveBeenCalledWith('boom')
  })

  it('stringifies non-Error throwables', async () => {
    vi.mocked(core.setOutput).mockImplementation(() => {
      throw 'oops'
    })
    await run()
    expect(core.setFailed).toHaveBeenCalledWith('oops')
  })
})
