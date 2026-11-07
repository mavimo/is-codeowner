import * as core from '@actions/core'
import { checkOwnership, type CheckDeps } from './check.js'
import { normalizeFiles } from './files.js'

export async function run(deps?: CheckDeps): Promise<void> {
  try {
    const user = core.getInput('user', { required: true }).trim().replace(/^@/, '')
    if (user === '') throw new Error('Input "user" must not be empty')
    const token = core.getInput('token')
    if (token) core.setSecret(token)

    // Explicit `files` input may be a JSON array; auto-detected files (CHANGED_FILES env,
    // set by action.yml) are always a plain newline list and never JSON-sniffed.
    const explicit = core.getInput('files')
    const detected = explicit.trim() === ''
    const files = detected
      ? normalizeFiles(process.env.CHANGED_FILES ?? '', false)
      : normalizeFiles(explicit)
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
    if (files.length === 0) {
      const msg = 'No files to check; result is true (vacuously).'
      if (detected)
        core.warning(`${msg} No changed files were detected; check fetch-depth and event type.`)
      else core.info(msg)
    }
    core.info(
      `Checked ${files.length} file(s) for @${user}: ${outcome.result ? 'owner of all' : 'NOT owner of all'}`
    )
    for (const f of outcome.unownedFiles) core.info(`  unowned: ${f}`)
    for (const f of outcome.notOwnedFiles) core.info(`  not owned by @${user}: ${f}`)
  } catch (error) {
    core.setFailed(error instanceof Error ? error.message : String(error))
  }
}
