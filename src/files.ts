/**
 * Normalize the `files` input: accepts a newline-separated list or, when the trimmed
 * input starts with `[`, a JSON array of strings. Entries are trimmed, blanks dropped
 * and duplicates removed (first occurrence wins).
 */
export function normalizeFiles(raw: string): string[] {
  const text = raw.trim()
  let entries: string[]
  if (text.startsWith('[')) {
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      throw new Error('Input "files" looks like a JSON array but could not be parsed')
    }
    if (
      !Array.isArray(parsed) ||
      !parsed.every((item): item is string => typeof item === 'string')
    ) {
      throw new Error('Input "files" must be a JSON array of strings')
    }
    entries = parsed
  } else {
    entries = text.split(/\r?\n/)
  }
  const seen = new Set<string>()
  for (const entry of entries) {
    const file = entry.trim()
    if (file !== '') seen.add(file)
  }
  return [...seen]
}
