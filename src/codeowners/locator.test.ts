import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { locateCodeowners } from './index.js'

let root: string

async function put(rel: string, content: string): Promise<void> {
  const full = join(root, rel)
  await mkdir(join(full, '..'), { recursive: true })
  await writeFile(full, content)
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'codeowners-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('locateCodeowners', () => {
  it('returns null when none is found', async () => {
    expect(await locateCodeowners(root)).toBeNull()
  })

  it.each([['.github/CODEOWNERS'], ['CODEOWNERS'], ['docs/CODEOWNERS']])(
    'finds %s',
    async (path) => {
      await put(path, '* @a')
      expect(await locateCodeowners(root)).toEqual({ path, content: '* @a' })
    }
  )

  it('prefers .github over root and docs', async () => {
    await put('docs/CODEOWNERS', 'docs')
    await put('CODEOWNERS', 'root')
    await put('.github/CODEOWNERS', 'github')
    expect(await locateCodeowners(root)).toEqual({ path: '.github/CODEOWNERS', content: 'github' })
  })

  it('prefers root over docs', async () => {
    await put('docs/CODEOWNERS', 'docs')
    await put('CODEOWNERS', 'root')
    expect(await locateCodeowners(root)).toEqual({ path: 'CODEOWNERS', content: 'root' })
  })

  it('does not search arbitrary subfolders', async () => {
    await put('src/CODEOWNERS', 'nope')
    await put('.github/sub/CODEOWNERS', 'nope')
    await put('docs/sub/CODEOWNERS', 'nope')
    expect(await locateCodeowners(root)).toBeNull()
  })

  it('skips a directory named CODEOWNERS and continues', async () => {
    await mkdir(join(root, '.github', 'CODEOWNERS'), { recursive: true })
    await put('docs/CODEOWNERS', 'docs')
    expect(await locateCodeowners(root)).toEqual({ path: 'docs/CODEOWNERS', content: 'docs' })
  })

  it('skips when a parent path is a file (ENOTDIR)', async () => {
    await put('docs', 'a file, not a dir')
    expect(await locateCodeowners(root)).toBeNull()
  })

  it('returns an empty file as found', async () => {
    await put('CODEOWNERS', '')
    expect(await locateCodeowners(root)).toEqual({ path: 'CODEOWNERS', content: '' })
  })

  it('propagates unexpected I/O errors', async () => {
    await expect(locateCodeowners('bad\0path')).rejects.toThrow()
  })
})
