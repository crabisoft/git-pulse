import { describe, expect, it } from 'vitest';
import {
  extractVersion,
  fillTemplate,
  parsePath,
  resolvePath,
  templateReadsSomething,
} from './version-template';

/** The version a spec produced, or the code that says why it produced none. */
const read = (body: string, template: string, format: 'json' | 'xml' | 'text' = 'json', pattern?: string) => {
  const result = extractVersion(body, { format, template, pattern });
  return result.ok ? result.version : result.reason.code;
};

describe('extractVersion, over JSON', () => {
  const body = JSON.stringify({ build: { version: '1.4.2', number: '87' } });

  it('reads the value a path names', () => {
    expect(read(body, '{build.version}')).toBe('1.4.2');
  });

  it('assembles several paths with the literal text between them', () => {
    expect(read(body, 'v{build.version} (build {build.number})')).toBe('v1.4.2 (build 87)');
  });

  it('fails rather than interpolating a hole', () => {
    // The case the whole design turns on: `1.4.2-undefined` would be written to
    // the store and shown beside a deployed ref as if it had been read.
    expect(read(body, '{build.version}-{build.commit}')).toBe('errors.version.pathMissing');
  });

  it('refuses to render a node as a version', () => {
    expect(read(body, '{build}')).toBe('errors.version.pathNotAValue');
  });

  it('reads a number or a boolean as the text it was written as', () => {
    expect(read(JSON.stringify({ major: 3, dirty: false }), '{major}-{dirty}')).toBe('3-false');
  });

  it('never coerces the text it was given', () => {
    // `1.0` parsed as a number comes back as `1`, and `07` as `7`. A version is
    // text, and the two spellings are different versions.
    expect(read(JSON.stringify({ v: '1.0', build: '07' }), '{v}+{build}')).toBe('1.0+07');
  });

  it('says so when the body is not JSON at all', () => {
    expect(read('<info/>', '{build.version}')).toBe('errors.version.unparsable');
  });
});

describe('paths into an array', () => {
  const body = JSON.stringify({
    components: [
      { name: 'front', version: '2.0' },
      { name: 'back', version: '1.4.2' },
    ],
  });

  it('indexes by position', () => {
    expect(read(body, '{components[0].version}')).toBe('2.0');
  });

  it('selects by content, which position cannot promise', () => {
    // An index is right until the day the array is reordered; the predicate is
    // the reason the language has one at all.
    expect(read(body, '{components[name=back].version}')).toBe('1.4.2');
  });

  it('reports the count when a key is applied to several elements', () => {
    const result = extractVersion(body, { format: 'json', template: '{components.version}' });
    expect(result).toEqual({
      ok: false,
      reason: { code: 'errors.version.pathAmbiguous', params: { path: 'components.version', count: 2 } },
    });
  });

  it('finds nothing when the predicate matches nothing', () => {
    expect(read(body, '{components[name=api].version}')).toBe('errors.version.pathMissing');
  });

  it('finds nothing past the end of the array', () => {
    expect(read(body, '{components[7].version}')).toBe('errors.version.pathMissing');
  });
});

describe('extractVersion, over XML', () => {
  it('reads a nested element', () => {
    const body = '<info><build><version>1.4.2</version></build></info>';
    expect(read(body, '{info.build.version}', 'xml')).toBe('1.4.2');
  });

  it('reads an attribute', () => {
    expect(read('<project version="1.4.2"/>', '{project.@version}', 'xml')).toBe('1.4.2');
  });

  it('reads the text of an element that also carries attributes', () => {
    // Without the `#text` tolerance this path would break the day somebody adds
    // an attribute to an element that never had one.
    const body = '<version scm="git">1.4.2</version>';
    expect(read(body, '{version}', 'xml')).toBe('1.4.2');
    expect(read(body, '{version.@scm}', 'xml')).toBe('git');
  });

  it('reads the same path whether the element repeats or not', () => {
    // The trap this parsing exists to remove: left alone, a parser yields an
    // object for one `<module>` and an array for two, so a path written against
    // a response holding one breaks in production and never in testing.
    const one = '<modules><module><version>1.4.2</version></module></modules>';
    const two =
      '<modules><module><version>1.4.2</version></module><module><version>9.9</version></module></modules>';
    expect(read(one, '{modules.module[0].version}', 'xml')).toBe('1.4.2');
    expect(read(two, '{modules.module[0].version}', 'xml')).toBe('1.4.2');
    // And the shorthand keeps working while there is only one to mean.
    expect(read(one, '{modules.module.version}', 'xml')).toBe('1.4.2');
  });

  it('selects a repeated element by one of its children', () => {
    const body =
      '<components><component><name>front</name><version>2.0</version></component>' +
      '<component><name>back</name><version>1.4.2</version></component></components>';
    expect(read(body, '{components.component[name=back].version}', 'xml')).toBe('1.4.2');
  });

  it('addresses a namespaced element by the name the document spells', () => {
    const body = '<ns:info xmlns:ns="urn:x"><ns:version>1.4.2</ns:version></ns:info>';
    expect(read(body, '{ns:info.ns:version}', 'xml')).toBe('1.4.2');
  });

  it('ignores the declaration ahead of the document', () => {
    const body = '<?xml version="1.0" encoding="UTF-8"?><info><version>1.4.2</version></info>';
    expect(read(body, '{info.version}', 'xml')).toBe('1.4.2');
  });
});

describe('extractVersion, over text', () => {
  it('fills the template from the named groups', () => {
    const body = 'Application build 87, version 1.4.2\n';
    expect(read(body, '{v}+{b}', 'text', 'build (?<b>\\d+), version (?<v>[\\d.]+)')).toBe('1.4.2+87');
  });

  it('covers a body that is neither JSON nor XML', () => {
    // What the mode is for: an endpoint answering the version and nothing else.
    expect(read('1.4.2\n', '{v}', 'text', '(?<v>[\\d.]+)')).toBe('1.4.2');
  });

  it('says the pattern found nothing rather than reading an empty version', () => {
    expect(read('service unavailable', '{v}', 'text', 'version (?<v>[\\d.]+)')).toBe(
      'errors.version.noMatch',
    );
  });

  it('fails on a group the pattern does not define', () => {
    expect(read('1.4.2', '{build}', 'text', '(?<v>[\\d.]+)')).toBe('errors.version.groupMissing');
  });

  it('fails on an optional group that did not participate', () => {
    // Absent, not empty: interpolating it would silently shorten the version.
    expect(read('1.4.2', '{v}-{b}', 'text', '(?<v>[\\d.]+)(-(?<b>\\d+))?')).toBe(
      'errors.version.groupMissing',
    );
  });

  it('needs a pattern at all', () => {
    expect(read('1.4.2', '{v}', 'text')).toBe('errors.version.patternMissing');
  });

  it('reports an unreadable pattern instead of throwing', () => {
    expect(read('1.4.2', '{v}', 'text', '([')).toBe('errors.version.patternUnreadable');
  });
});

describe('fillTemplate', () => {
  const found = (value: string) => () => ({ ok: true as const, value });

  it('keeps a template holding no placeholder as it is', () => {
    expect(fillTemplate('static', found('x'))).toEqual({ ok: true, version: 'static' });
  });

  it('takes a doubled brace for a literal one', () => {
    expect(fillTemplate('{{{a}}}', found('1.4.2'))).toEqual({ ok: true, version: '{1.4.2}' });
  });

  it('refuses an unclosed placeholder', () => {
    expect(fillTemplate('{a', found('x'))).toMatchObject({
      reason: { code: 'errors.version.templateUnclosed' },
    });
  });

  it('refuses a placeholder naming nothing', () => {
    expect(fillTemplate('{ }', found('x'))).toMatchObject({
      reason: { code: 'errors.version.templateEmptyPath' },
    });
  });

  it('trims the path, so a placeholder written with room around it resolves', () => {
    const paths: string[] = [];
    fillTemplate('{ build.version }', (path) => {
      paths.push(path);
      return { ok: true, value: '1.4.2' };
    });
    expect(paths).toEqual(['build.version']);
  });
});

describe('templateReadsSomething', () => {
  it('accepts a template that names a path', () => {
    expect(templateReadsSomething('v{build.version}')).toBe(true);
  });

  it('rejects a constant, which would report the same version for ever', () => {
    expect(templateReadsSomething('1.4.2')).toBe(false);
  });

  it('rejects escaped braces, which name nothing either', () => {
    expect(templateReadsSomething('{{build.version}}')).toBe(false);
  });

  it('rejects a malformed template', () => {
    expect(templateReadsSomething('{build.version')).toBe(false);
  });
});

describe('parsePath', () => {
  it('reads descent, index and predicate', () => {
    expect(parsePath('a.b[0][name=x]')).toEqual([
      { kind: 'key', name: 'a' },
      { kind: 'key', name: 'b' },
      { kind: 'index', index: 0 },
      { kind: 'where', key: 'name', value: 'x' },
    ]);
  });

  it('keeps a predicate value holding the separator the path splits on', () => {
    // Why the parser is hand-written: splitting on `.` first loses this.
    expect(parsePath('deps[name=spring.boot].version')).toEqual([
      { kind: 'key', name: 'deps' },
      { kind: 'where', key: 'name', value: 'spring.boot' },
      { kind: 'key', name: 'version' },
    ]);
  });

  it('addresses a root array', () => {
    expect(parsePath('[0].version')).toEqual([
      { kind: 'index', index: 0 },
      { kind: 'key', name: 'version' },
    ]);
  });

  it.each(['', 'a..b', 'a.', '.a', 'a[', 'a[]', 'a[=x]', 'a]b'])('refuses %o', (path) => {
    expect(parsePath(path)).toBeNull();
  });
});

describe('resolvePath', () => {
  it('reports an unreadable path as such, not as a missing one', () => {
    // The two are fixed differently: one is a typo in the rule, the other is a
    // response that stopped carrying the field.
    expect(resolvePath({ a: 1 }, 'a..b')).toMatchObject({
      reason: { code: 'errors.version.pathUnreadable' },
    });
  });

  it('finds nothing under a scalar', () => {
    expect(resolvePath({ version: '1.4.2' }, 'version.build')).toMatchObject({
      reason: { code: 'errors.version.pathMissing' },
    });
  });

  it('finds nothing rather than inheriting a prototype member', () => {
    expect(resolvePath({}, 'constructor')).toMatchObject({
      reason: { code: 'errors.version.pathMissing' },
    });
  });

  it('reads an empty string as the value it is', () => {
    expect(resolvePath({ version: '' }, 'version')).toEqual({ ok: true, value: '' });
  });
});
