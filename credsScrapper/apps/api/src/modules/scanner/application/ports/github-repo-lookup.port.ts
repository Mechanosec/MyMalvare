// Resolves a repo's numeric GitHub id from its owner/name, for a repo a
// user just submitted for authorization and that has never been through
// GH Archive discovery yet. Public repo metadata only, no credential of
// any kind involved - unrelated to KeyValidatorPort's "test a found
// secret" concern.
export abstract class GithubRepoLookupPort {
  abstract resolveRepoId(owner: string, name: string): Promise<number | null>;
}
