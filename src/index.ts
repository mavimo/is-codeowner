import * as core from '@actions/core'
import { checkOwnership, type CheckDeps } from './check.js'
import { normalizeFiles } from './files.js'

export async function run(deps?: CheckDeps): Promise<void> {
  try {
    const user = core.getInput('user', { required: true }).trim().replace(/^@/, '')
    if (user === '') throw new Error('Input "user" must not be empty')
    const token = core.getInput('token')
    if (token) core.setSecret(token)

    const files = normalizeFiles(core.getInput('files'))
    const outcome = await checkOwnership(
      {
        user,
        files,
        codeowners: core.getInput('codeowners'),
        token,
        root: process.env.GITHUB_WORKSPACE || process.cwd()
      },
      deps
    )

    core.setOutput('result', String(outcome.result))
    core.setOutput('unowned-files', outcome.unownedFiles.join('\n'))
    core.setOutput('not-owned-files', outcome.notOwnedFiles.join('\n'))

    core.info(`CODEOWNERS source: ${outcome.source}`)
    if (files.length === 0) core.info('No files to check; result is true (vacuously).')
    core.info(
      `Checked ${files.length} file(s) for @${user}: ${outcome.result ? 'owner of all' : 'NOT owner of all'}`
    )
    for (const f of outcome.unownedFiles) core.info(`  unowned: ${f}`)
    for (const f of outcome.notOwnedFiles) core.info(`  not owned by @${user}: ${f}`)
  } catch (error) {
    core.setFailed(error instanceof Error ? error.message : String(error))
  }
}
