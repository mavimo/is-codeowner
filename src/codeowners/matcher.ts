import type { Rule } from './parser.js'

const cache = new Map<string, RegExp | null>()

/** Normalizes a repo-relative path: `\` -> `/`, drops leading `./` and `/`, collapses `//`. */
export function normalizePath(filePath: string): string {
  let p = filePath.replace(/\\/g, '/').replace(/\/{2,}/g, '/')
  while (p.startsWith('./')) p = p.slice(2)
  return p.replace(/^\/+/, '').replace(/\/+$/, '')
}

function escapeRegex(ch: string): string {
  return ch.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')
}

/**
 * Converts one glob segment to regex source.
 * `*` -> any chars except `/`, `?` -> one char except `/`, `\x` -> literal x.
 * `[ ]` and everything else are literal (GitHub does not support ranges).
 */
function segmentToRegex(glob: string): string {
  let out = ''
  for (let i = 0; i < glob.length; i++) {
    const ch = glob.charAt(i)
    if (ch === '\\' && i + 1 < glob.length) {
      out += escapeRegex(glob.charAt(++i))
    } else if (ch === '*') {
      while (glob.charAt(i + 1) === '*') i++
      out += '[^/]*'
    } else if (ch === '?') {
      out += '[^/]'
    } else {
      out += escapeRegex(ch)
    }
  }
  return out
}

function hasWildcard(glob: string): boolean {
  return /(^|[^\\])(\\\\)*[*?]/.test(glob)
}

/**
 * Compiles a CODEOWNERS pattern into a RegExp matched against a normalized
 * path, or null if the pattern can never match (leading `!`, or empty).
 *
 * Semantics (gitignore-like, as documented by GitHub):
 * - leading `/` or a `/` in the middle anchors the pattern to the repo root;
 *   otherwise it matches at any depth
 * - trailing `/` matches a directory and everything beneath it
 * - a pattern naming a directory without wildcard in its last segment
 *   (`/docs`, `apps`) also matches everything beneath it
 * - a last segment with a wildcard (`docs/*`, `*.js`) matches only that level
 * - `**` as a whole segment matches any number of directories
 */
export function compilePattern(pattern: string): RegExp | null {
  if (pattern.startsWith('!')) return null
  let glob = pattern
  const anchoredByLeadingSlash = glob.startsWith('/')
  if (anchoredByLeadingSlash) glob = glob.replace(/^\/+/, '')
  const dirOnly = glob.endsWith('/') && !glob.endsWith('\\/')
  if (dirOnly) glob = glob.replace(/\/+$/, '')
  if (glob === '') return null

  const anchored = anchoredByLeadingSlash || glob.includes('/')
  const segments = glob.split('/')
  let body = ''
  segments.forEach((seg, i) => {
    const last = i === segments.length - 1
    if (seg === '**') {
      // non-trailing: any number of directories (or none); trailing: anything inside
      body += last ? '.*' : '(?:[^/]+/)*'
      return
    }
    body += segmentToRegex(seg) + (last ? '' : '/')
  })

  const lastSeg = segments[segments.length - 1] ?? ''
  let suffix = ''
  if (lastSeg === '**') suffix = ''
  else if (dirOnly) suffix = '/.*'
  else if (!hasWildcard(lastSeg)) suffix = '(?:/.*)?'
  const prefix = anchored ? '^' : '^(?:.*/)?'
  return new RegExp(`${prefix}${body}${suffix}$`, 's')
}

function regexFor(pattern: string): RegExp | null {
  let re = cache.get(pattern)
  if (re === undefined) {
    re = compilePattern(pattern)
    cache.set(pattern, re)
  }
  return re
}

/** True if `pattern` matches the file at `filePath`. */
export function matchesPattern(pattern: string, filePath: string): boolean {
  const re = regexFor(pattern)
  if (!re) return false
  const p = normalizePath(filePath)
  return p !== '' && re.test(p)
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
