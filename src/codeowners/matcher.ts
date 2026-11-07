import type { Rule } from './parser.js'

/**
 * Glob matching is implemented without regular expressions. Patterns come from
 * a (possibly untrusted) repository file, and a regex built from many `*` or
 * `**` can backtrack catastrophically. The two-pointer algorithms below never
 * backtrack more than one wildcard, so cost is O(pattern * path).
 */

/** One glob character: a literal, `?` (any one character) or `*` (any run, no `/`). */
type GlobItem = { kind: 'lit'; ch: string } | { kind: 'any1' } | { kind: 'star' }
/** A segment glob, or ANY_DIRS meaning "zero or more path segments" (`**`). */
type Token = GlobItem[] | typeof ANY_DIRS

const ANY_DIRS = Symbol('any-dirs')
const ONE_SEGMENT: GlobItem[] = [{ kind: 'star' }]

/** A compiled pattern, or null if it can never match. */
export type Matcher = (normalizedPath: string) => boolean

const cache = new Map<string, Matcher | null>()

/** Normalizes a repo-relative path: drops leading `./` and `/`, collapses `//`. Backslashes are kept: git always reports `/`, and `\` is a legal filename char on Linux. */
export function normalizePath(filePath: string): string {
  let p = filePath.replace(/\/{2,}/g, '/')
  while (p.startsWith('./')) p = p.slice(2)
  return p.replace(/^\/+/, '').replace(/\/+$/, '')
}

function parseSegment(glob: string): GlobItem[] {
  const items: GlobItem[] = []
  const chars = Array.from(glob)
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i] as string
    if (ch === '\\' && i + 1 < chars.length) {
      items.push({ kind: 'lit', ch: chars[++i] as string })
    } else if (ch === '*') {
      if (items[items.length - 1]?.kind !== 'star') items.push({ kind: 'star' })
    } else if (ch === '?') {
      items.push({ kind: 'any1' })
    } else {
      // `[ ]`, `!` and everything else are literal: GitHub does not support them
      items.push({ kind: 'lit', ch })
    }
  }
  return items
}

function hasWildcard(items: GlobItem[]): boolean {
  return items.some((item) => item.kind !== 'lit')
}

/** Matches one path segment against a segment glob (iterative, single-star backtracking). */
function matchSegment(items: GlobItem[], segment: string): boolean {
  const chars = Array.from(segment)
  let gi = 0
  let ci = 0
  let starG = -1
  let starC = 0
  while (ci < chars.length) {
    const item = items[gi]
    if (item?.kind === 'star') {
      starG = gi++
      starC = ci
    } else if (item && (item.kind === 'any1' || item.ch === chars[ci])) {
      gi++
      ci++
    } else if (starG >= 0) {
      gi = starG + 1
      ci = ++starC
    } else {
      return false
    }
  }
  while (items[gi]?.kind === 'star') gi++
  return gi === items.length
}

/** Matches path segments against tokens; ANY_DIRS is the only multi-segment wildcard. */
function matchTokens(tokens: Token[], segments: string[]): boolean {
  let ti = 0
  let si = 0
  let starT = -1
  let starS = 0
  while (si < segments.length) {
    const token = tokens[ti]
    if (token === ANY_DIRS) {
      starT = ti++
      starS = si
    } else if (token && matchSegment(token, segments[si] as string)) {
      ti++
      si++
    } else if (starT >= 0) {
      ti = starT + 1
      si = ++starS
    } else {
      return false
    }
  }
  while (tokens[ti] === ANY_DIRS) ti++
  return ti === tokens.length
}

/**
 * Compiles a CODEOWNERS pattern into a matcher for normalized paths, or null
 * if the pattern can never match (leading `!`, or empty).
 *
 * Semantics (gitignore-like, as documented by GitHub):
 * - leading `/` or a `/` in the middle anchors the pattern to the repo root;
 *   otherwise it matches at any depth
 * - trailing `/` matches a directory and everything beneath it (not a file of that name)
 * - a pattern naming a directory without wildcard in its last segment
 *   (`/docs`, `apps`) also matches everything beneath it
 * - a last segment with a wildcard (`docs/*`, `*.js`) matches only that level
 * - `**` as a whole segment matches any number of directories; a trailing
 *   `**` matches everything inside; consecutive `**` collapse into one
 */
export function compilePattern(pattern: string): Matcher | null {
  if (pattern.startsWith('!')) return null
  let glob = pattern
  const anchoredByLeadingSlash = glob.startsWith('/')
  if (anchoredByLeadingSlash) glob = glob.replace(/^\/+/, '')
  const dirOnly = glob.endsWith('/') && !glob.endsWith('\\/')
  if (dirOnly) glob = glob.replace(/\/+$/, '')
  if (glob === '') return null

  const anchored = anchoredByLeadingSlash || glob.includes('/')
  const rawSegments = glob.split('/')
  const tokens: Token[] = anchored ? [] : [ANY_DIRS]
  let lastIsLiteral = false
  rawSegments.forEach((raw, i) => {
    const last = i === rawSegments.length - 1
    if (raw === '**') {
      // trailing `**` needs at least one segment inside
      if (last) tokens.push(ONE_SEGMENT)
      tokens.push(ANY_DIRS)
      lastIsLiteral = false
      return
    }
    const items = parseSegment(raw)
    tokens.push(items)
    lastIsLiteral = !hasWildcard(items)
  })
  if (dirOnly) tokens.push(ONE_SEGMENT, ANY_DIRS)
  else if (lastIsLiteral) tokens.push(ANY_DIRS)

  const collapsed = tokens.filter((t, i) => !(t === ANY_DIRS && tokens[i - 1] === ANY_DIRS))
  return (path) => matchTokens(collapsed, path.split('/'))
}

function matcherFor(pattern: string): Matcher | null {
  let m = cache.get(pattern)
  if (m === undefined) {
    m = compilePattern(pattern)
    cache.set(pattern, m)
  }
  return m
}

/** True if `pattern` matches the file at `filePath`. */
export function matchesPattern(pattern: string, filePath: string): boolean {
  const matcher = matcherFor(pattern)
  if (!matcher) return false
  const p = normalizePath(filePath)
  return p !== '' && matcher(p)
}

/**
 * Returns the owners of `filePath`: the last matching rule wins. `null` when
 * no rule matches, `[]` when the winning rule lists no owners.
 */
export function findOwners(rules: Rule[], filePath: string): string[] | null {
  for (let i = rules.length - 1; i >= 0; i--) {
    const rule = rules[i]
    if (rule && matchesPattern(rule.pattern, filePath)) return [...rule.owners]
  }
  return null
}
