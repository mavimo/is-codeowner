import { describe, expect, it } from 'vitest'
import { parseList } from './inputs.js'

describe('parseList', () => {
  it('trims entries and drops blank lines', () => {
    expect(parseList(' a.ts\r\n\n  b/c.ts  \n')).toEqual(['a.ts', 'b/c.ts'])
  })

  it('returns an empty list for empty input', () => {
    expect(parseList('')).toEqual([])
  })
})
