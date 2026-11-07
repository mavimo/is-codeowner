import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'

export interface LocatedCodeowners {
  /** Repo-relative path of the file that was found. */
  path: string
  content: string
}

/** The only valid locations, in GitHub's priority order. */
export const CODEOWNERS_LOCATIONS = ['.github/CODEOWNERS', 'CODEOWNERS', 'docs/CODEOWNERS'] as const

const MAX_CODEOWNERS_BYTES = 3 * 1024 * 1024

const MISSING = new Set(['ENOENT', 'ENOTDIR', 'EISDIR'])

/** Returns the first CODEOWNERS file found, or null. Other I/O errors propagate. */
export async function locateCodeowners(repoRoot: string): Promise<LocatedCodeowners | null> {
  for (const path of CODEOWNERS_LOCATIONS) {
    try {
      const full = join(repoRoot, path)
      const { size } = await stat(full)
      if (size > MAX_CODEOWNERS_BYTES) {
        throw new Error(`${path} is ${size} bytes; GitHub does not load CODEOWNERS files over 3 MB`)
      }
      const content = await readFile(full, 'utf8')
      return { path, content }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === undefined || !MISSING.has(code)) throw error
    }
  }
  return null
}
