export interface Inputs {
  user: string
  files: string[]
  codeowners: string
  token: string
}

/** Split a newline-separated input into trimmed, non-empty entries. */
export function parseList(raw: string): string[] {
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
}
