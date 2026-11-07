import {
  findOwners,
  locateCodeowners,
  parseCodeowners,
  type LocatedCodeowners
} from './codeowners/index.js'
import { createOctokitTeamClient, createOwnerResolver, type TeamClient } from './teams/index.js'

export interface CheckInput {
  user: string
  files: string[]
  /** Inline CODEOWNERS content; when blank, the file is located under `root`. */
  codeowners: string
  token: string
  root: string
}

export interface CheckDeps {
  locate: (root: string) => Promise<LocatedCodeowners | null>
  createClient: (token: string) => TeamClient
}

export interface CheckResult {
  /**
   * True iff no file is unowned and every owned file has the user as an owner.
   * With zero files this is vacuously true: nothing to check, nothing violated.
   */
  result: boolean
  unownedFiles: string[]
  notOwnedFiles: string[]
  source: string
}

const defaultDeps: CheckDeps = { locate: locateCodeowners, createClient: createOctokitTeamClient }

/** Defers creating the Octokit client until a team lookup is actually needed. */
function lazyClient(create: () => TeamClient): TeamClient {
  let client: TeamClient | undefined
  const get = (): TeamClient => (client ??= create())
  return {
    isTeamMember: (org, team, user) => get().isTeamMember(org, team, user),
    listChildTeams: (org, team) => get().listChildTeams(org, team)
  }
}

export async function checkOwnership(
  input: CheckInput,
  deps: CheckDeps = defaultDeps
): Promise<CheckResult> {
  let content: string
  let source: string
  if (input.codeowners.trim() !== '') {
    content = input.codeowners
    source = 'input'
  } else {
    const located = await deps.locate(input.root)
    if (!located) {
      throw new Error(
        `No CODEOWNERS file found in ${input.root} (looked in .github/CODEOWNERS, CODEOWNERS, docs/CODEOWNERS). ` +
          'Run actions/checkout first or pass the "codeowners" input.'
      )
    }
    content = located.content
    source = located.path
  }

  const rules = parseCodeowners(content)
  const resolver = createOwnerResolver(lazyClient(() => deps.createClient(input.token)))

  const unownedFiles: string[] = []
  const notOwnedFiles: string[] = []
  for (const file of input.files) {
    const owners = findOwners(rules, file)
    if (owners === null) unownedFiles.push(file)
    else if (!(await resolver.isOwner(owners, input.user))) notOwnedFiles.push(file)
  }

  return {
    result: unownedFiles.length === 0 && notOwnedFiles.length === 0,
    unownedFiles,
    notOwnedFiles,
    source
  }
}
