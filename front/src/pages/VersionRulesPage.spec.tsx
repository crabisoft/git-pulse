import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { VersionPreview, VersionRulePublic } from '@repo/shared';
import { VersionRulesPage } from './VersionRulesPage';

vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  api: {
    listVersionRules: vi.fn(),
    createVersionRule: vi.fn(),
    updateVersionRule: vi.fn(),
    deleteVersionRule: vi.fn(),
    previewVersionRule: vi.fn(),
  },
}));

const { api } = await import('../api');

function rule(over: Partial<VersionRulePublic> = {}): VersionRulePublic {
  return {
    id: 'vr-1',
    name: 'Spring actuator',
    environment: '^prod',
    repo: null,
    urlTemplate: '{environmentUrl}/actuator/info',
    format: 'json',
    template: '{build.version}',
    pattern: null,
    headers: {},
    authKind: 'none',
    authHeader: null,
    hasSecret: false,
    priority: 100,
    createdAt: '2026-08-01T09:00:00.000Z',
    updatedAt: '2026-08-01T09:00:00.000Z',
    ...over,
  };
}

/** Pasted rather than typed: userEvent reads braces as key descriptors. */
const RESPONSE = '{"build":{"version":"1.4.2","number":"87"}}';

function preview(over: Partial<VersionPreview> = {}): VersionPreview {
  return {
    tree: { build: { version: '1.4.2', number: '87' } },
    version: '1.4.2',
    reason: null,
    url: null,
    httpStatus: null,
    body: '{"build":{"version":"1.4.2","number":"87"}}',
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.listVersionRules).mockResolvedValue({
    items: [rule()],
    page: { total: 1, limit: 25, offset: 0, hasMore: false },
  });
  vi.mocked(api.previewVersionRule).mockResolvedValue(preview());
});

/** Opens the editor on the listed rule. */
async function openEditor(user: ReturnType<typeof userEvent.setup>) {
  render(<VersionRulesPage />);
  await user.click(await screen.findByRole('button', { name: 'common.edit' }));
}

describe('writing a template', () => {
  it('inserts the path of a clicked value', async () => {
    const user = userEvent.setup();
    await openEditor(user);

    const template = screen.getByDisplayValue('{build.version}');
    await user.clear(template);
    await user.click(screen.getByLabelText('versionRules.try.body'));
    await user.paste(RESPONSE);

    // The tree only exists once a response has been previewed.
    const value = await screen.findByRole('button', { name: '87' });
    await user.click(value);

    expect(template).toHaveValue('{build.number}');
  });

  it('inserts at the caret, so a template can be built by clicking', async () => {
    const user = userEvent.setup();
    await openEditor(user);

    const template = screen.getByDisplayValue('{build.version}');
    await user.clear(template);
    await user.click(screen.getByLabelText('versionRules.try.body'));
    await user.paste(RESPONSE);
    await user.click(await screen.findByRole('button', { name: '1.4.2' }));

    // A separator typed after the first placeholder, then the second value:
    // the whole point of writing where the caret is rather than at the end.
    await user.type(template, '-');
    await user.click(screen.getByRole('button', { name: '87' }));

    expect(template).toHaveValue('{build.version}-{build.number}');
  });
});

describe('the live preview', () => {
  it('shows what the template produced, against the pasted response', async () => {
    const user = userEvent.setup();
    await openEditor(user);
    await user.click(screen.getByLabelText('versionRules.try.body'));
    await user.paste(RESPONSE);

    // Scoped to the result: the same value is in the tree beside it, which is
    // the whole idea — one is what was read, the other is what it came from.
    expect(await screen.findByText('1.4.2', { selector: 'strong' })).toBeInTheDocument();
    // Pasting reaches no network beyond this call: no URL was read.
    await waitFor(() =>
      expect(vi.mocked(api.previewVersionRule).mock.calls[0][0]).not.toHaveProperty('url'),
    );
  });

  it('shows why nothing came out, rather than an empty field', async () => {
    vi.mocked(api.previewVersionRule).mockResolvedValue(
      preview({
        version: null,
        reason: { code: 'errors.version.pathMissing', params: { path: 'build.version' } },
      }),
    );
    const user = userEvent.setup();
    await openEditor(user);
    await user.click(screen.getByLabelText('versionRules.try.body'));
    await user.paste(RESPONSE);

    // The stub renders a key with its params, so the path it names travels too.
    expect(await screen.findByText(/errors\.version\.pathMissing/)).toBeInTheDocument();
  });
});

describe('saving', () => {
  it('keeps the stored secret when the field is left alone', async () => {
    vi.mocked(api.listVersionRules).mockResolvedValue({
      items: [rule({ authKind: 'bearer', hasSecret: true })],
      page: { total: 1, limit: 25, offset: 0, hasMore: false },
    });
    vi.mocked(api.updateVersionRule).mockResolvedValue(rule());
    const user = userEvent.setup();
    await openEditor(user);
    await user.click(screen.getByRole('button', { name: 'common.save' }));

    await waitFor(() => expect(api.updateVersionRule).toHaveBeenCalled());
    // An omitted secret is the only thing that says "keep the one you hold" —
    // an empty string is how the API is told to forget it.
    expect(vi.mocked(api.updateVersionRule).mock.calls[0][1]).not.toHaveProperty('secret');
  });
});
