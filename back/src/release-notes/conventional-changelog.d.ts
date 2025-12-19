/**
 * The slice of the `conventional-changelog` packages this module uses. They
 * ship no types of their own, and the DefinitelyTyped entries track other major
 * versions than the ones pinned here — declaring the three calls we make is
 * shorter than a mismatch that only surfaces at runtime.
 */

declare module 'conventional-commits-parser' {
  /** A parsed commit, in the shape the writer's templates read. */
  export interface ParsedCommit {
    type: string | null;
    scope: string | null;
    subject: string | null;
    header: string | null;
    body: string | null;
    footer: string | null;
    notes: Array<{ title: string; text: string }>;
    references: Array<{
      issue: string;
      prefix: string;
      owner: string | null;
      repository: string | null;
    }>;
    revert: Record<string, string | null> | null;
    [key: string]: unknown;
  }

  export function sync(message: string, options?: Record<string, unknown>): ParsedCommit;
}

declare module 'conventional-changelog-writer' {
  import type { Transform } from 'node:stream';

  /**
   * An object-mode transform: parsed commits in, Markdown chunks out. The
   * package's own CLI drives it as a stream, and so does everything built on it.
   */
  function writer(
    context: Record<string, unknown>,
    options: Record<string, unknown>,
  ): Transform;

  export = writer;
}

declare module 'conventional-changelog-conventionalcommits' {
  /** A commit type the preset knows, and the section it lands in. */
  interface CommitType {
    type: string;
    section?: string;
    hidden?: boolean;
  }

  interface Preset {
    parserOpts: Record<string, unknown>;
    writerOpts: Record<string, unknown>;
  }

  function createPreset(config?: Record<string, unknown>): Promise<Preset>;

  namespace createPreset {
    const DEFAULT_COMMIT_TYPES: readonly CommitType[];
  }

  export = createPreset;
}
