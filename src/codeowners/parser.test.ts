import { describe, expect, it } from 'vitest'
import { parseCodeowners } from './index.js'

describe('parseCodeowners', () => {
  it('returns [] for empty content', () => {
    expect(parseCodeowners('')).toEqual([])
  })

  it('skips blank lines and comments, keeping 1-based line numbers', () => {
    const rules = parseCodeowners('# header\n\n   \n*.js @a\n  # indented comment\n/docs/ @b\n')
    expect(rules).toEqual([
      { pattern: '*.js', owners: ['@a'], line: 4 },
      { pattern: '/docs/', owners: ['@b'], line: 6 }
    ])
  })

  it('handles CRLF and CR line endings', () => {
    expect(parseCodeowners('*.js @a\r\n*.ts @b\r\n').map((r) => r.owners)).toEqual([['@a'], ['@b']])
    expect(parseCodeowners('*.js @a\r*.ts @b').map((r) => r.pattern)).toEqual(['*.js', '*.ts'])
  })

  it('strips a UTF-8 BOM', () => {
    expect(parseCodeowners('\uFEFF*.js @a')).toEqual([{ pattern: '*.js', owners: ['@a'], line: 1 }])
  })

  it('supports multiple owners of every kind', () => {
    const [rule] = parseCodeowners('/x @user @org/team dev@example.com')
    expect(rule?.owners).toEqual(['@user', '@org/team', 'dev@example.com'])
  })

  it('accepts tabs and repeated whitespace as separators', () => {
    expect(parseCodeowners('*.js\t\t@a   @b')[0]?.owners).toEqual(['@a', '@b'])
  })

  it('keeps patterns with no owners as owners: []', () => {
    expect(parseCodeowners('/apps/github')).toEqual([
      { pattern: '/apps/github', owners: [], line: 1 }
    ])
  })

  it('strips trailing inline comments', () => {
    expect(parseCodeowners('*.js @a # js owner')[0]?.owners).toEqual(['@a'])
    expect(parseCodeowners('*.js #nothing')[0]?.owners).toEqual([])
  })

  it('keeps an escaped # at the start of a pattern', () => {
    expect(parseCodeowners('\\#file @a')).toEqual([{ pattern: '\\#file', owners: ['@a'], line: 1 }])
  })

  it('keeps escaped spaces inside the pattern', () => {
    expect(parseCodeowners('/my\\ dir/file.txt @a')).toEqual([
      { pattern: '/my\\ dir/file.txt', owners: ['@a'], line: 1 }
    ])
  })

  it('an escaped space does not split; a lone trailing backslash is kept', () => {
    expect(parseCodeowners('foo\\ @a')[0]?.pattern).toBe('foo\\ @a')
    expect(parseCodeowners('foo\\')[0]?.pattern).toBe('foo\\')
  })

  it.each([
    ['plain word', '*.js notanowner'],
    ['bare @', '*.js @'],
    ['two @ in a handle', '*.js @a@b'],
    ['email without domain', '*.js a@'],
    ['email without local part', '*.js @'],
    ['email with two @', '*.js a@b@c']
  ])('skips lines with an invalid owner (%s)', (_name, line) => {
    expect(parseCodeowners(line)).toEqual([])
  })

  it('does not skip valid lines around an invalid one', () => {
    expect(parseCodeowners('*.a @a\n*.b bad\n*.c @c').map((r) => r.line)).toEqual([1, 3])
  })

  it('treats section headers as plain literal patterns (GitLab syntax unsupported)', () => {
    expect(parseCodeowners('[Docs] @a')).toEqual([{ pattern: '[Docs]', owners: ['@a'], line: 1 }])
    expect(parseCodeowners('^[Docs]')).toEqual([{ pattern: '^[Docs]', owners: [], line: 1 }])
  })

  it('keeps negation patterns as rules (they simply never match)', () => {
    expect(parseCodeowners('!*.js @a')[0]?.pattern).toBe('!*.js')
  })
})
