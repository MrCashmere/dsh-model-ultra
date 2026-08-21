/**
 * Ambient module shims for DSH framework packages that are resolved by the
 * runtime (from the profile's node_modules) but are not installed as dev
 * dependencies here — they are not publicly published with a resolvable
 * dependency graph, so `tsc` cannot see them. The static bundle leaves them
 * external at build time; these declarations only satisfy the type checker.
 */

declare module '@deepseek-ai/dsh-typert-protocol' {
  /** Base class for a Host Typert Remote service. */
  export class TypertRemoteService {
    constructor(ctx: unknown, serviceKey: string, options?: Record<string, unknown>)
  }
}
