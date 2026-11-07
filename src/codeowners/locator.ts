import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

export interface LocatedCodeowners {
  /** Repo-relative path of the file that was found. */
  path: string
  content: string
}

/** The only valid locations, in GitHub's priority order. */
export const CODEOWNERS_LOCATIONS = ['.github/CODEOWNERS', 'CODEOWNERS', 'docs/CODEOWNERS'] as const

const MISSING = new Set(['ENOENT', 'ENOTDIR', 'EISDIR'])

/** Returns the first CODEOWNERS file found, or null. Other I/O errors propagate. */
export async function locateCodeowners(repoRoot: string): Promise<LocatedCodeowners | null> {
  for (const path of CODEOWNERS_LOCATIONS) {
    try {
      const content = await readFile(join(repoRoot, path), 'utf8')
      return { path, content }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === undefined || !MISSING.has(code)) throw error
    }
  }
  return null
}
