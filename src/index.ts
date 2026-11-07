import * as core from '@actions/core'

export async function run(): Promise<void> {
  try {
    core.setOutput('result', 'false')
  } catch (error) {
    core.setFailed(error instanceof Error ? error.message : String(error))
  }
}
