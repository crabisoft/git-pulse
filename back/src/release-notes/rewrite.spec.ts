import { describe, expect, it } from 'vitest';
import { REWRITE_SYSTEM, buildRewritePrompt, languageInstruction, readRewritten } from './rewrite';

describe('rewrite instructions', () => {
  it('forbids inventing before it asks for anything else', () => {
    // The order is the instruction: a model that keeps only the first rule must
    // still keep the one that matters.
    const first = REWRITE_SYSTEM.indexOf('1.');
    const rest = REWRITE_SYSTEM.indexOf('2.');
    expect(REWRITE_SYSTEM.slice(first, rest)).toContain('Never state anything the input does not');
  });

  it('asks for the links to survive', () => {
    expect(REWRITE_SYSTEM).toContain('Keep every Markdown link exactly as written');
  });

  it('names the target language when one is asked for', () => {
    expect(languageInstruction('fr')).toContain('fr');
  });

  it('takes the language from the commits when none is asked for', () => {
    // Not "English", and not the reader's interface either: a release note
    // reports what a repository's history says, in the words it says it.
    const instruction = languageInstruction(undefined);
    expect(instruction).toContain('commit messages themselves');
    expect(instruction).toContain('Do not translate');
    expect(instruction).toContain('do not follow the language of these instructions');
  });

  it('tells the model the same thing in its standing rules', () => {
    // Said twice on purpose: the instruction travels with one request, and a
    // model that skims the user turn still has the rule above it.
    expect(REWRITE_SYSTEM).toContain('language of the notes comes from the entries');
  });

  it('sends the notes verbatim, after the instruction', () => {
    const markdown = '## repo — v1...v2\n\n- **auth**: reset a password';
    const prompt = buildRewritePrompt(markdown, 'fr');
    expect(prompt).toContain(markdown);
    expect(prompt.indexOf('fr')).toBeLessThan(prompt.indexOf(markdown));
  });
});

describe('readRewritten', () => {
  it('keeps plain Markdown as it is', () => {
    expect(readRewritten('## Release\n\n- a change')).toBe('## Release\n\n- a change');
  });

  it('unwraps a fence around the whole answer', () => {
    expect(readRewritten('```markdown\n## Release\n\n- a change\n```')).toBe(
      '## Release\n\n- a change',
    );
  });

  it('unwraps a fence carrying no language', () => {
    expect(readRewritten('```\n## Release\n```')).toBe('## Release');
  });

  it('keeps a fence that wraps a code sample inside the notes', () => {
    // The outer pair here is the sample's own, not a wrapper: unwrapping would
    // silently drop the prose around it.
    const answer = '```sh\nmake dev\n```\n\n## Release\n\n- a change\n\n```sh\nmake prod\n```';
    expect(readRewritten(answer)).toBe(answer);
  });

  it('trims the surrounding blank lines a model leaves behind', () => {
    expect(readRewritten('\n\n## Release\n\n')).toBe('## Release');
  });
});
