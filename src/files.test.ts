import { describe, expect, it } from 'vitest'
import { normalizeFiles } from './files.js'

describe('normalizeFiles', () => {
  it('trims, drops blanks and dedupes newline lists', () => {
    expect(normalizeFiles(' a.ts \r\n\n b.ts\na.ts\n')).toEqual(['a.ts', 'b.ts'])
  })
  it('returns [] for empty input', () => {
    expect(normalizeFiles('  \n ')).toEqual([])
  })
  it('accepts a JSON array', () => {
    expect(normalizeFiles('["a.ts", " b.ts ", "", "a.ts"]')).toEqual(['a.ts', 'b.ts'])
  })
  it('rejects invalid JSON', () => {
    expect(() => normalizeFiles('[a.ts')).toThrow(/could not be parsed/)
  })
  it('rejects non-string JSON entries', () => {
    expect(() => normalizeFiles('[1, 2]')).toThrow(/array of strings/)
  })
  it('rejects a JSON value that is not an array', () => {
    expect(() => normalizeFiles('[1]')).toThrow(/array of strings/)
  })
})
