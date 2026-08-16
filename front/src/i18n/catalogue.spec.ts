import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * That the API and the catalogue still agree.
 *
 * The API never sends a sentence: it sends a code and the values that go in it,
 * and the sentence is chosen here. Nothing checks that pairing at compile time,
 * and nothing checks it at runtime either — i18next answers a missing message
 * with the key itself and leaves a placeholder it was given nothing for exactly
 * as it found it. Both failures reach the screen looking like something a
 * reader did wrong: `errors.collect.versions`, or `could not be reached:
 * {{reason}}`.
 *
 * The suites either side cannot see it. The back asserts the params it emits,
 * the front stubs `t` to return its key, and both are right about their own
 * half. So this reads the emitting sites out of the back and holds them against
 * the catalogue.
 *
 * Only the sites naming their params in place can be read this way; one that
 * builds them elsewhere is skipped rather than guessed at.
 */

/** Vitest runs from the package root, and the API is its sibling. */
const BACK = join(process.cwd(), '..', 'back', 'src');
const LOCALES = join(process.cwd(), 'src', 'i18n', 'locales');

const LANGUAGES = ['en', 'fr'] as const;

type Site = { code: string; params: string[]; where: string };

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts') ? [path] : [];
  });
}

/**
 * The names an object literal supplies, or null when it supplies them in a way
 * this cannot read — a spread, a computed key, a call that returns them.
 */
function paramNames(node: ts.Expression | undefined): string[] | null {
  if (!node || !ts.isObjectLiteralExpression(node)) return null;
  const names: string[] = [];
  for (const property of node.properties) {
    if (ts.isSpreadAssignment(property)) return null;
    const { name } = property;
    if (!name || !(ts.isIdentifier(name) || ts.isStringLiteral(name))) return null;
    names.push(name.text);
  }
  return names;
}

/** Every `errors.*` the API can answer with, with what it hands the message. */
function emittingSites(): Site[] {
  const sites: Site[] = [];

  for (const file of sourceFiles(BACK)) {
    const source = ts.createSourceFile(
      file,
      readFileSync(file, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
    );
    const where = (node: ts.Node) =>
      `${file.slice(BACK.length + 1)}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}`;
    // A prefix, not a code: `startsWith('errors.compare.')` asks which family an
    // error belongs to, and no message answers to it.
    const isCode = (node: ts.Node): node is ts.StringLiteralLike =>
      ts.isStringLiteralLike(node) && node.text.startsWith('errors.') && !node.text.endsWith('.');

    const visit = (node: ts.Node) => {
      // `{ code: 'errors.x', params: { … } }` — a reason, or a warning filed by
      // a collection run.
      if (ts.isObjectLiteralExpression(node)) {
        const code = node.properties.find(
          (p): p is ts.PropertyAssignment =>
            ts.isPropertyAssignment(p) && p.name.getText(source) === 'code',
        );
        if (code && isCode(code.initializer)) {
          const params = node.properties.find(
            (p): p is ts.PropertyAssignment =>
              ts.isPropertyAssignment(p) && p.name.getText(source) === 'params',
          );
          const named = params ? paramNames(params.initializer) : [];
          if (named) sites.push({ code: code.initializer.text, params: named, where: where(node) });
        }
      }

      // `new CodedException('errors.x', status, { … })`, and the helpers that
      // take the code first and the values last.
      if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
        const args = node.arguments ?? ([] as unknown as ts.NodeArray<ts.Expression>);
        const [first] = args;
        if (first && isCode(first)) {
          const last = args[args.length - 1];
          const named = last === first ? [] : paramNames(last);
          if (named) sites.push({ code: first.text, params: named, where: where(node) });
        }
      }

      ts.forEachChild(node, visit);
    };
    visit(source);
  }

  return sites;
}

function flatten(value: unknown, path = '', into = new Map<string, string>()): Map<string, string> {
  if (typeof value === 'string') into.set(path, value);
  else if (value && typeof value === 'object') {
    for (const [key, nested] of Object.entries(value)) {
      flatten(nested, path ? `${path}.${key}` : key, into);
    }
  }
  return into;
}

function placeholders(message: string): string[] {
  return [...message.matchAll(/{{(\w+)}}/g)].map((match) => match[1]);
}

const catalogue = new Map(
  LANGUAGES.map((language) => [
    language,
    flatten(JSON.parse(readFileSync(join(LOCALES, `${language}.json`), 'utf8'))),
  ]),
);
const sites = emittingSites();

describe('the message catalogue', () => {
  it('was read at all', () => {
    // A path that stopped resolving would leave every assertion below with
    // nothing to disagree about, and the suite would pass on an empty room.
    expect(sites.length).toBeGreaterThan(50);
    for (const language of LANGUAGES) expect(catalogue.get(language)!.size).toBeGreaterThan(500);
  });

  it.each(LANGUAGES)('answers in %s to every code the API sends', (language) => {
    const messages = catalogue.get(language)!;
    const orphans = sites.filter((site) => !messages.has(site.code));
    expect(orphans.map((site) => `${site.code} (${site.where})`)).toEqual([]);
  });

  it.each(LANGUAGES)('asks in %s for nothing the sender leaves out', (language) => {
    const messages = catalogue.get(language)!;
    // The other way round is not a fault: a site is free to carry a value for
    // a message that does not read it — `id` on a "not found" says which one to
    // whoever is reading a log, and the sentence is better without it.
    const short = sites.flatMap((site) => {
      const message = messages.get(site.code);
      if (!message) return [];
      return placeholders(message)
        .filter((hole) => !site.params.includes(hole))
        .map((hole) => `${site.code} wants {{${hole}}}, ${site.where} sends [${site.params}]`);
    });
    expect(short).toEqual([]);
  });

  it('says the same thing in both languages', () => {
    const [reference, ...others] = LANGUAGES.map((language) => catalogue.get(language)!);
    for (const other of others) {
      expect([...other.keys()].sort()).toEqual([...reference.keys()].sort());
      const differing = [...reference].filter(
        ([key, message]) =>
          placeholders(message).sort().join() !== placeholders(other.get(key) ?? '').sort().join(),
      );
      expect(differing.map(([key]) => key)).toEqual([]);
    }
  });
});
