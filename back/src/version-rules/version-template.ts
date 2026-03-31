import { XMLParser } from 'fast-xml-parser';
import type { CodedMessage, VersionFormat } from '@repo/shared';

/**
 * What reading a version out of a response produced.
 *
 * A failure carries a coded reason rather than a null: the whole point of the
 * feature is a version shown beside a deployed ref, and "we read nothing"
 * has to be distinguishable from "we read nothing *because the field moved*".
 * The reason travels to the rule editor, where it is the only thing telling the
 * author what to fix.
 */
export type VersionExtraction = { ok: true; version: string } | { ok: false; reason: CodedMessage };

/** What a rule needs to turn a response body into a version string. */
export interface ExtractionSpec {
  format: VersionFormat;
  /** Literal text and `{path}` placeholders. */
  template: string;
  /** Only for `text`: the regex whose named groups the template refers to. */
  pattern?: string | null;
}

/**
 * Reads the version a response states, following one rule.
 *
 * The three formats differ only in how a placeholder is looked up: `json` and
 * `xml` parse first and resolve paths against the tree, `text` runs a regex and
 * resolves named groups. Everything downstream — the template, the failures,
 * the refusal to emit a half-filled string — is shared, which is why a rule can
 * be re-pointed from one format to another without rewriting its template.
 */
export function extractVersion(body: string, spec: ExtractionSpec): VersionExtraction {
  if (spec.format === 'text') {
    const groups = matchGroups(body, spec.pattern);
    if (!groups.ok) return groups;
    return fillTemplate(spec.template, (name) =>
      name in groups.groups
        ? { ok: true, value: groups.groups[name] }
        : { ok: false, reason: { code: 'errors.version.groupMissing', params: { group: name } } },
    );
  }

  const parsed = parseBody(body, spec.format);
  if (!parsed.ok) return parsed;
  return fillTemplate(spec.template, (path) => resolvePath(parsed.value, path));
}

/**
 * Parses a body into the tree paths are resolved against.
 *
 * XML is normalised into the same shape JSON already has, so one path language
 * covers both — the alternative was XPath beside a JSON syntax, two languages
 * for the same job. Two normalisations make that possible:
 *
 * - **every element becomes an array**, whatever its cardinality. Left to its
 *   own devices the parser yields an object for a lone `<item>` and an array for
 *   two, so a path written against a response holding one item breaks the day a
 *   second appears — a trap that springs in production and never in testing.
 *   The uniform shape costs nothing here because `resolvePath` steps through a
 *   single-element array without being told to.
 * - **nothing is coerced**. A version is text: `1.0` read as a number comes back
 *   as `1`, and `07` as `7`.
 */
export function parseBody(
  body: string,
  format: 'json' | 'xml',
): { ok: true; value: unknown } | { ok: false; reason: CodedMessage } {
  if (format === 'json') {
    try {
      return { ok: true, value: JSON.parse(body) as unknown };
    } catch (e) {
      return { ok: false, reason: unparsable('json', e) };
    }
  }
  try {
    return { ok: true, value: xml.parse(body) as unknown };
  } catch (e) {
    return { ok: false, reason: unparsable('xml', e) };
  }
}

const xml = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@',
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  // Attributes excepted: they cannot repeat within an element, so wrapping them
  // would add an index to every path for a cardinality that cannot vary.
  isArray: (_name, _path, _isLeaf, isAttribute) => !isAttribute,
});

/**
 * Fills a template, or explains why it could not be.
 *
 * A placeholder that resolves to nothing fails the whole extraction instead of
 * being dropped. `1.4.2-undefined` and `1.4.2-` are both worse than no reading
 * at all: they are wrong quietly, and they would be written to the store and
 * shown beside a deployed ref as if they had been read.
 *
 * `{{` and `}}` stand for a literal brace, for the version strings that carry
 * one.
 */
export function fillTemplate(
  template: string,
  lookup: (path: string) => { ok: true; value: string } | { ok: false; reason: CodedMessage },
): VersionExtraction {
  let out = '';
  let i = 0;

  while (i < template.length) {
    const char = template[i];
    if ((char === '{' || char === '}') && template[i + 1] === char) {
      out += char;
      i += 2;
      continue;
    }
    if (char !== '{') {
      out += char;
      i += 1;
      continue;
    }

    const end = template.indexOf('}', i + 1);
    if (end === -1) {
      return fail('errors.version.templateUnclosed', { template });
    }
    const path = template.slice(i + 1, end).trim();
    if (!path) return fail('errors.version.templateEmptyPath', { template });

    const resolved = lookup(path);
    if (!resolved.ok) return resolved;
    out += resolved.value;
    i = end + 1;
  }

  return { ok: true, version: out };
}

/**
 * Whether a template would read anything at all.
 *
 * A template without a placeholder is a constant: it matches every response,
 * including the ones that stopped answering what the rule was written for, and
 * reports the same version for ever. Refused when a rule is written rather than
 * discovered later on a dashboard that has been lying quietly — the same stance
 * `assertContributes` takes on a classification rule that captures nothing.
 */
export function templateReadsSomething(template: string): boolean {
  let placeholders = 0;
  const filled = fillTemplate(template, () => {
    placeholders += 1;
    return { ok: true, value: '' };
  });
  return filled.ok && placeholders > 0;
}

/**
 * The value a path names, as text.
 *
 * The path language is deliberately small — descend `a.b`, index `items[0]`,
 * select `components[name=back]`, and the XML spellings `@attr` and `#text`.
 * Small because it is written by clicking a node in the response tree far more
 * often than by hand, and because the alternative — JSONPath, whose filter
 * expressions several implementations evaluate through the JS engine — turns a
 * string typed into a form into code this process runs.
 *
 * Three tolerances keep a path from depending on cardinality it cannot know:
 * a key steps through a single-element array, `[0]` on a lone value yields that
 * value, and an element carrying attributes yields its `#text`. Ambiguity is
 * never resolved silently: a key applied to several elements says so and names
 * the count, because picking the first would be a coin toss reported as a fact.
 */
export function resolvePath(
  root: unknown,
  path: string,
): { ok: true; value: string } | { ok: false; reason: CodedMessage } {
  const steps = parsePath(path);
  if (!steps) return fail('errors.version.pathUnreadable', { path });

  let node: unknown = root;
  for (const step of steps) {
    const next = apply(node, step);
    if (next.kind === 'missing') return fail('errors.version.pathMissing', { path });
    if (next.kind === 'ambiguous') {
      return fail('errors.version.pathAmbiguous', { path, count: next.count });
    }
    node = next.value;
  }

  const text = toText(node);
  if (text.kind === 'missing') return fail('errors.version.pathMissing', { path });
  if (text.kind === 'ambiguous') {
    return fail('errors.version.pathAmbiguous', { path, count: text.count });
  }
  if (text.kind === 'notAValue') return fail('errors.version.pathNotAValue', { path });
  return { ok: true, value: text.value };
}

// ─── The path language ───────────────────────────────────────────────

type Step =
  | { kind: 'key'; name: string }
  | { kind: 'index'; index: number }
  | { kind: 'where'; key: string; value: string };

/**
 * Parses a path into its steps, or null when it is malformed.
 *
 * Hand-written rather than a regex per step: a predicate value is arbitrary text
 * — `components[name=spring.boot]` holds the separator the path splits on — so
 * splitting on `.` before understanding brackets loses the value.
 */
export function parsePath(path: string): Step[] | null {
  const steps: Step[] = [];
  let i = 0;
  let first = true;

  while (i < path.length) {
    if (!first) {
      // Segments are separated by a dot, except before a bracket: `a[0][1]` and
      // `a[0].b` are both spelled the way one would expect.
      if (path[i] === '.') i += 1;
      else if (path[i] !== '[') return null;
    }
    first = false;

    const start = i;
    while (i < path.length && path[i] !== '.' && path[i] !== '[') i += 1;
    const name = path.slice(start, i);
    if (name) {
      if (name.includes(']') || name.includes('=')) return null;
      steps.push({ kind: 'key', name });
    } else if (path[i] !== '[') {
      // An empty segment — a leading, doubled or trailing dot — with no bracket
      // to justify it. Refused here rather than skipped, which would also leave
      // this loop consuming nothing and spinning.
      return null;
    }

    while (path[i] === '[') {
      const end = path.indexOf(']', i);
      if (end === -1) return null;
      const inner = path.slice(i + 1, end);
      i = end + 1;

      if (/^\d+$/.test(inner)) {
        steps.push({ kind: 'index', index: Number(inner) });
        continue;
      }
      const equals = inner.indexOf('=');
      if (equals <= 0) return null;
      steps.push({
        kind: 'where',
        key: inner.slice(0, equals).trim(),
        value: inner.slice(equals + 1).trim(),
      });
    }
  }

  return steps.length > 0 ? steps : null;
}

type Found =
  | { kind: 'found'; value: unknown }
  | { kind: 'missing' }
  | { kind: 'ambiguous'; count: number };

function apply(node: unknown, step: Step): Found {
  if (step.kind === 'key') return byKey(node, step.name);
  if (step.kind === 'index') return byIndex(node, step.index);
  return byPredicate(node, step.key, step.value);
}

function byKey(node: unknown, name: string): Found {
  if (Array.isArray(node)) {
    // The tolerance that lets one path serve both cardinalities. Beyond one
    // element there is nothing to tolerate: the author has to say which.
    if (node.length === 1) return byKey(node[0], name);
    return node.length === 0 ? { kind: 'missing' } : { kind: 'ambiguous', count: node.length };
  }
  if (!isRecord(node)) return { kind: 'missing' };
  // Own properties only. `in` would resolve `constructor` and `__proto__`
  // against every response ever parsed, which is a path that reads something
  // the document does not contain.
  return Object.prototype.hasOwnProperty.call(node, name)
    ? { kind: 'found', value: node[name] }
    : { kind: 'missing' };
}

function byIndex(node: unknown, index: number): Found {
  if (Array.isArray(node)) {
    return index < node.length ? { kind: 'found', value: node[index] } : { kind: 'missing' };
  }
  // A path picked from a response holding one element reads `[0]`; the same
  // path must keep working against a shape that never wrapped it.
  return index === 0 ? { kind: 'found', value: node } : { kind: 'missing' };
}

function byPredicate(node: unknown, key: string, value: string): Found {
  const candidates = Array.isArray(node) ? node : [node];
  const match = candidates.find((candidate) => {
    const held = byKey(candidate, key);
    if (held.kind !== 'found') return false;
    const text = toText(held.value);
    return text.kind === 'value' && text.value === value;
  });
  return match === undefined ? { kind: 'missing' } : { kind: 'found', value: match };
}

type Text =
  | { kind: 'value'; value: string }
  | { kind: 'missing' }
  | { kind: 'ambiguous'; count: number }
  | { kind: 'notAValue' };

/**
 * A node read as text.
 *
 * `#text` is what makes `{project.version}` work whether or not the element
 * carries attributes: with one, the parser nests the text under that key, and a
 * path written against a response without attributes would otherwise break the
 * day someone adds one.
 */
function toText(node: unknown): Text {
  if (node === null || node === undefined) return { kind: 'missing' };
  if (typeof node === 'string') return { kind: 'value', value: node };
  if (typeof node === 'number' || typeof node === 'boolean') {
    return { kind: 'value', value: String(node) };
  }
  if (Array.isArray(node)) {
    if (node.length === 1) return toText(node[0]);
    return node.length === 0 ? { kind: 'missing' } : { kind: 'ambiguous', count: node.length };
  }
  if (isRecord(node) && '#text' in node) return toText(node['#text']);
  return { kind: 'notAValue' };
}

function isRecord(node: unknown): node is Record<string, unknown> {
  return typeof node === 'object' && node !== null && !Array.isArray(node);
}

// ─── Text mode ───────────────────────────────────────────────────────

/**
 * The named groups a `text` rule's pattern captures.
 *
 * The escape hatch for what is neither JSON nor XML — a body holding `1.4.2`
 * and a newline, an HTML page with the version in a meta tag. It is the same
 * engine the classification rules run on, so an author who has written one of
 * those has nothing new to learn.
 */
function matchGroups(
  body: string,
  pattern: string | null | undefined,
): { ok: true; groups: Record<string, string> } | { ok: false; reason: CodedMessage } {
  if (!pattern) return { ok: false, reason: { code: 'errors.version.patternMissing' } };
  let regex: RegExp;
  try {
    regex = new RegExp(pattern);
  } catch {
    return { ok: false, reason: { code: 'errors.version.patternUnreadable', params: { pattern } } };
  }

  const match = regex.exec(body);
  if (!match) return { ok: false, reason: { code: 'errors.version.noMatch', params: { pattern } } };
  return {
    ok: true,
    // An optional group that did not participate is absent rather than empty,
    // so the template fails on it instead of interpolating a hole.
    groups: Object.fromEntries(
      Object.entries(match.groups ?? {}).filter(([, v]) => v !== undefined),
    ) as Record<string, string>,
  };
}

// ─── Failures ────────────────────────────────────────────────────────

/** Typed as the failure alone, so it serves every result shape in this file. */
function fail(
  code: string,
  params: Record<string, string | number>,
): { ok: false; reason: CodedMessage } {
  return { ok: false, reason: { code, params } };
}

/**
 * Truncated: a proxy answering an HTML error page would otherwise put the whole
 * page in a field the rule editor renders, and in the logs behind it.
 */
function unparsable(format: 'json' | 'xml', e: unknown): CodedMessage {
  const detail = e instanceof Error ? e.message : String(e);
  return { code: 'errors.version.unparsable', params: { format, detail: detail.slice(0, 200) } };
}
