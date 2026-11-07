import { describe, expect, it } from 'vitest'
import { findOwners, parseCodeowners } from './index.js'
import { compilePattern, matchesPattern, normalizePath } from './matcher.js'

// [pattern, path, expected]
type Case = [string, string, boolean]

const cases: Record<string, Case[]> = {
  'unanchored, no slash': [
    ['*.js', 'a.js', true],
    ['*.js', 'src/a.js', true],
    ['*.js', 'src/deep/er/a.js', true],
    ['*.js', 'a.jsx', false],
    ['*.js', 'a.js/b.txt', false],
    ['README.md', 'README.md', true],
    ['README.md', 'docs/README.md', true],
    ['README.md', 'README.md.bak', false],
    ['*', 'anything/at/all.txt', true]
  ],
  'leading slash anchors to root': [
    ['/README.md', 'README.md', true],
    ['/README.md', 'docs/README.md', false],
    ['/docs', 'docs/a.md', true],
    ['/docs', 'docs/sub/a.md', true],
    ['/docs', 'other/docs/a.md', false],
    ['/*', 'top.txt', true],
    ['/*', 'dir/file.txt', false],
    ['/*.md', 'a.md', true],
    ['/*.md', 'dir/a.md', false]
  ],
  'trailing slash (directories)': [
    ['docs/', 'docs/a.md', true],
    ['docs/', 'docs/sub/a.md', true],
    ['docs/', 'x/docs/a.md', true],
    ['docs/', 'x/y/docs/z/a.md', true],
    ['docs/', 'docs', false],
    ['docs/', 'mydocs/a.md', false],
    ['/build/logs/', 'build/logs/a.log', true],
    ['/build/logs/', 'build/logs/x/a.log', true],
    ['/build/logs/', 'src/build/logs/a.log', false],
    ['/build/logs/', 'build/logs', false],
    ['apps/', 'apps/a.js', true],
    ['apps/', 'src/apps/a.js', true]
  ],
  'dir vs /dir (no trailing slash)': [
    ['docs', 'docs/a.md', true],
    ['docs', 'x/docs/a.md', true],
    ['docs', 'docs', true],
    ['/docs', 'x/docs/a.md', false],
    ['docs', 'docsx/a.md', false]
  ],
  'slash in the middle anchors': [
    ['docs/getting-started.md', 'docs/getting-started.md', true],
    ['docs/getting-started.md', 'x/docs/getting-started.md', false],
    ['src/app', 'src/app/main.ts', true],
    ['src/app', 'x/src/app/main.ts', false]
  ],
  'single star never crosses a slash': [
    ['docs/*', 'docs/getting-started.md', true],
    ['docs/*', 'docs/build-app/troubleshooting.md', false],
    ['docs/*', 'x/docs/a.md', false],
    ['/docs/*', 'docs/a.md', true],
    ['/docs/*', 'docs/a/b.md', false],
    ['src/*/index.ts', 'src/a/index.ts', true],
    ['src/*/index.ts', 'src/a/b/index.ts', false],
    ['src/*/index.ts', 'src/index.ts', false],
    ['a*b', 'axxb', true],
    ['a*b', 'ab', true],
    ['a*b', 'a/b', false],
    ['*/b.txt', 'a/b.txt', true],
    ['*/b.txt', 'x/a/b.txt', false],
    ['docs/*/', 'docs/sub/a.md', true],
    ['docs/*/', 'docs/sub/deep/a.md', true],
    ['docs/*/', 'docs/a.md', false]
  ],
  'double star forms': [
    ['**/logs', 'logs/a.log', true],
    ['**/logs', 'build/logs/a.log', true],
    ['**/logs', 'a/b/logs/c/d.log', true],
    ['**/logs', 'logs', true],
    ['**/logs', 'mylogs/a.log', false],
    ['**/logs/', 'a/logs/x.log', true],
    ['**/logs/*.log', 'logs/a.log', true],
    ['**/logs/*.log', 'x/y/logs/a.log', true],
    ['**/logs/*.log', 'logs/sub/a.log', false],
    ['/**/logs', 'logs/a', true],
    ['foo/**', 'foo/a', true],
    ['foo/**', 'foo/a/b/c', true],
    ['foo/**', 'x/foo/a', false],
    ['foo/**', 'foo', false],
    ['/foo/**', 'foo/a/b', true],
    ['a/**/b', 'a/b', true],
    ['a/**/b', 'a/x/b', true],
    ['a/**/b', 'a/x/y/b', true],
    ['a/**/b', 'a/x/y/b/c', true],
    ['a/**/b', 'ab', false],
    ['a/**/b', 'x/a/b', false],
    ['a/**/b', 'a/xb', false],
    ['**', 'any/thing', true],
    ['**/*.md', 'a.md', true],
    ['**/*.md', 'a/b/c.md', true],
    ['a**b', 'axxb', true],
    ['a**b', 'a/b', false]
  ],
  'question mark': [
    ['?.js', 'a.js', true],
    ['?.js', 'ab.js', false],
    ['?.js', 'src/a.js', true],
    ['a?c', 'abc', true],
    ['a?c', 'a/c', false],
    ['a?c', 'ac', false]
  ],
  escapes: [
    ['\\#hash', '#hash', true],
    ['\\#hash', 'x/#hash', true],
    ['\\#hash', 'hash', false],
    ['my\\ file.txt', 'my file.txt', true],
    ['/my\\ dir/', 'my dir/a.txt', true],
    ['/my\\ dir/', 'my/dir/a.txt', false],
    ['a\\*b', 'a*b', true],
    ['a\\*b', 'axb', false],
    ['a\\?b', 'a?b', true],
    ['a\\?b', 'axb', false]
  ],
  'unsupported syntax is literal or never matches': [
    ['!*.js', 'a.js', false],
    ['!*.js', '!a.js', false],
    ['\\!important', '!important', true],
    ['[ab].js', 'a.js', false],
    ['[ab].js', '[ab].js', true],
    ['[a-z].js', 'q.js', false],
    ['[a-z].js', '[a-z].js', true],
    ['/', 'a', false],
    ['//', 'a', false]
  ],
  'regex metacharacters are literal': [
    ['a.b', 'a.b', true],
    ['a.b', 'axb', false],
    ['a+b', 'a+b', true],
    ['(x)', '(x)', true],
    ['a|b', 'a', false],
    ['a|b', 'a|b', true],
    ['$x^', '$x^', true],
    ['{a,b}', 'a', false],
    ['{a,b}', '{a,b}', true]
  ],
  'case sensitivity': [
    ['README.md', 'readme.md', false],
    ['/Docs/', 'docs/a.md', false],
    ['*.JS', 'a.js', false],
    ['*.JS', 'a.JS', true]
  ],
  'path normalization': [
    ['/docs/', './docs/a.md', true],
    ['/docs/', '/docs/a.md', true],
    ['/docs/', '././docs/a.md', true],
    ['/docs/', 'docs\\a.md', true],
    ['/docs/', '.\\docs\\sub\\a.md', true],
    ['docs/*', 'docs//a.md', true],
    ['*.js', 'src\\a.js', true],
    ['/docs/', '', false],
    ['*', '', false],
    ['*', '/', false]
  ]
}

describe('matchesPattern (table driven)', () => {
  for (const [group, groupCases] of Object.entries(cases)) {
    describe(group, () => {
      it.each(groupCases)('pattern %j vs path %j -> %s', (pattern, path, expected) => {
        expect(matchesPattern(pattern, path)).toBe(expected)
      })
    })
  }
})

describe('normalizePath', () => {
  it.each([
    ['a/b', 'a/b'],
    ['./a/b', 'a/b'],
    ['/a/b', 'a/b'],
    ['a\\b\\c', 'a/b/c'],
    ['a//b', 'a/b'],
    ['a/b/', 'a/b'],
    ['./', ''],
    ['', '']
  ])('%j -> %j', (input, output) => {
    expect(normalizePath(input)).toBe(output)
  })
})

describe('compilePattern', () => {
  it('returns null for patterns that cannot match', () => {
    expect(compilePattern('!x')).toBeNull()
    expect(compilePattern('/')).toBeNull()
  })

  it('returns a matcher function otherwise', () => {
    expect(compilePattern('*.js')?.('a.js')).toBe(true)
  })
})

describe('findOwners', () => {
  const rules = parseCodeowners(`
# GitHub docs example
* @global-owner1 @global-owner2
*.js @js-owner
*.go docs@example.com
*.txt @octo-org/octocat
/build/logs/ @doctocat
docs/* docs@example.com
apps/ @octocat
/docs/ @doctocat
/apps/ @octocat
/apps/github
`)

  it.each([
    ['README.md', ['@global-owner1', '@global-owner2']],
    ['src/app.js', ['@js-owner']],
    ['main.go', ['docs@example.com']],
    ['deep/dir/notes.txt', ['@octo-org/octocat']],
    ['build/logs/today.log', ['@doctocat']],
    ['docs/getting-started.md', ['@doctocat']],
    ['docs/build-app/troubleshooting.md', ['@doctocat']],
    ['apps/foo/bar.rb', ['@octocat']],
    ['src/apps/foo.rb', ['@octocat']],
    ['apps/github/index.js', []],
    ['apps/github', []]
  ])('owners of %s', (path, expected) => {
    expect(findOwners(rules, path)).toEqual(expected)
  })

  it('returns null when nothing matches', () => {
    expect(findOwners(parseCodeowners('/docs/ @a'), 'src/x.ts')).toBeNull()
    expect(findOwners([], 'x')).toBeNull()
  })

  it('the last matching rule wins, regardless of specificity', () => {
    const r = parseCodeowners('/docs/api/ @specific\n/docs/ @general\n')
    expect(findOwners(r, 'docs/api/x.md')).toEqual(['@general'])
    const r2 = parseCodeowners('/docs/ @general\n/docs/api/ @specific\n')
    expect(findOwners(r2, 'docs/api/x.md')).toEqual(['@specific'])
    expect(findOwners(r2, 'docs/other.md')).toEqual(['@general'])
  })

  it('a later duplicate pattern replaces the earlier owner', () => {
    const r = parseCodeowners('/apps/github @a\n/apps/github @doctocat\n')
    expect(findOwners(r, 'apps/github/x')).toEqual(['@doctocat'])
  })

  it('an ownerless later rule un-owns files and non-matching later rules do not', () => {
    const r = parseCodeowners('* @a\n*.md\n/zzz @b\n')
    expect(findOwners(r, 'README.md')).toEqual([])
    expect(findOwners(r, 'x.ts')).toEqual(['@a'])
  })

  it('a negation rule never matches and so never overrides', () => {
    const r = [...parseCodeowners('* @a'), { pattern: '!*.md', owners: ['@b'], line: 2 }]
    expect(findOwners(r, 'README.md')).toEqual(['@a'])
  })

  it('returns a copy of the owners', () => {
    const r = parseCodeowners('* @a')
    findOwners(r, 'x')?.push('@mutated')
    expect(findOwners(r, 'x')).toEqual(['@a'])
  })

  it('normalizes the queried path', () => {
    const r = parseCodeowners('/src/ @a')
    expect(findOwners(r, './src/x.ts')).toEqual(['@a'])
    expect(findOwners(r, 'src\\x.ts')).toEqual(['@a'])
    expect(findOwners(r, '/src/x.ts')).toEqual(['@a'])
  })

  it('works with CRLF input end-to-end', () => {
    const r = parseCodeowners('* @a\r\n/docs/ @b\r\n')
    expect(findOwners(r, 'docs/x')).toEqual(['@b'])
  })
})

describe('review regressions', () => {
  it.each(<Case[]>[
    ['?.txt', '😀.txt', true],
    ['a?b', 'a😀b', true],
    ['a?b', 'a😀😀b', false],
    ['**/', 'README', false],
    ['**/', 'dir/README', true],
    ['foo/**/', 'foo/x', false],
    ['foo/**/', 'foo/sub/x', true],
    ['**/**/b', 'b', true],
    ['a/**/**/b', 'a/b', true],
    ['a/**/**/b', 'a/x/y/b', true],
    ['*.js', 'x.js/y', false],
    ['a/***/b', 'a/x/b', true],
    ['a/***/b', 'a/x/y/b', false]
  ])('pattern %j vs path %j -> %s', (pattern, path, expected) => {
    expect(matchesPattern(pattern, path)).toBe(expected)
  })

  it('does not backtrack catastrophically on repeated ** segments', () => {
    const pattern = Array(25).fill('**').join('/') + '/zzz'
    const path = Array(30).fill('a').join('/') + '/q'
    const start = Date.now()
    expect(matchesPattern(pattern, path)).toBe(false)
    expect(Date.now() - start).toBeLessThan(1000)
  })

  it('does not backtrack catastrophically on many * in one segment', () => {
    const pattern = '*a'.repeat(15) + 'b'
    const start = Date.now()
    expect(matchesPattern(pattern, 'a'.repeat(60))).toBe(false)
    expect(Date.now() - start).toBeLessThan(1000)
  })
})
