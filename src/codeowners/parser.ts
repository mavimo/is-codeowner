/** A single CODEOWNERS rule. `owners` are kept as written (`@user`, `@org/team`, `a@b.com`). */
export interface Rule {
  pattern: string
  owners: string[]
  line: number
}

/**
 * Splits a line into whitespace-separated tokens. A backslash escapes the
 * next character (so `\ ` keeps a space inside a token and `\#` is not a
 * comment start); escapes are preserved verbatim in the token. An unescaped
 * `#` at the start of a token begins a comment that runs to end of line.
 */
function tokenize(line: string): string[] {
  const tokens: string[] = []
  let current = ''
  let inToken = false
  for (let i = 0; i < line.length; i++) {
    const ch = line.charAt(i)
    if (ch === '\\' && i + 1 < line.length) {
      current += ch + line.charAt(i + 1)
      inToken = true
      i++
    } else if (ch === ' ' || ch === '\t') {
      if (inToken) tokens.push(current)
      current = ''
      inToken = false
    } else if (ch === '#' && !inToken) {
      break
    } else {
      current += ch
      inToken = true
    }
  }
  if (inToken) tokens.push(current)
  return tokens
}

/** An owner is `@user`, `@org/team` or an email address. */
function isValidOwner(owner: string): boolean {
  if (owner.startsWith('@')) return owner.length > 1 && !owner.includes('@', 1)
  const at = owner.indexOf('@')
  return at > 0 && at < owner.length - 1 && owner.indexOf('@', at + 1) === -1
}

/**
 * Parses CODEOWNERS content into rules, in file order.
 *
 * Blank lines and comments are skipped. A pattern with no owners is kept
 * (`owners: []`) since it un-owns matching files. Like GitHub, lines with an
 * invalid owner are skipped. Section headers (`[Section]`, `^[Section]`) are a
 * GitLab feature and are not special-cased: they are plain (literal) patterns.
 */
export function parseCodeowners(content: string): Rule[] {
  const rules: Rule[] = []
  const lines = content.replace(/^\uFEFF/, '').split(/\r\n|\r|\n/)
  lines.forEach((text, index) => {
    const [pattern, ...owners] = tokenize(text)
    if (pattern === undefined) return
    if (!owners.every(isValidOwner)) return
    rules.push({ pattern, owners, line: index + 1 })
  })
  return rules
}
