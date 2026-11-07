/**
 * Normalize the `files` input: accepts a newline-separated list or, when the trimmed
 * input starts with `[`, a JSON array of strings. Entries are trimmed, blanks dropped
 * and duplicates removed (first occurrence wins). Pass `allowJson=false` for auto-detected
 * lists, where a file name such as `[id]/page.tsx` or `["x"]` must never be sniffed as JSON.
 */
export function normalizeFiles(raw: string, allowJson = true): string[] {
  const text = raw.trim()
  let entries: string[]
  if (allowJson && text.startsWith('[')) {
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
