import { afterEach, describe, expect, it } from 'vitest';
import { setOpenCodeTransport } from './transport';
import {
  buildConfigPatch,
  buildMcpAddBody,
  configDraftFromConfig,
  disconnectMcpServer,
  filterProviderModels,
  parseMcpServers,
  parseProviderAuthMethods,
  parseProviderRows,
  providerConnectKind,
  putProviderApiKey,
  saveConfigPatch,
  splitCommandLine,
  validateConfigDraft,
} from './settings-data';

afterEach(() => setOpenCodeTransport(null));

const providerRaw = {
  all: [
    { id: 'zeta', name: 'Zeta', models: { 'z-1': { id: 'z-1', name: 'Z One' } } },
    {
      id: 'alpha',
      name: 'Alpha',
      models: { 'a/1': { id: 'a/1', name: 'A One' }, 'a/2': { name: 'A Two' } },
    },
    { id: 'beta', models: {} },
  ],
  default: { alpha: 'a/1' },
  connected: ['zeta'],
};

describe('parseProviderRows', () => {
  it('reads the {all, default, connected} shape with Record models', () => {
    const rows = parseProviderRows(providerRaw);
    expect(rows.map((r) => r.id)).toEqual(['zeta', 'alpha', 'beta']);
    expect(rows[0].connected).toBe(true);
    expect(rows[1].models).toEqual([
      { id: 'a/1', name: 'A One' },
      { id: 'a/2', name: 'A Two' },
    ]);
    expect(rows[2].name).toBe('beta');
  });

  it('returns [] for unexpected shapes', () => {
    expect(parseProviderRows(null)).toEqual([]);
    expect(parseProviderRows([])).toEqual([]);
    expect(parseProviderRows({ all: 3 })).toEqual([]);
  });

  it('filters models by id or name', () => {
    const models = parseProviderRows(providerRaw)[1].models;
    expect(filterProviderModels(models, 'two').map((m) => m.id)).toEqual(['a/2']);
    expect(filterProviderModels(models, '')).toHaveLength(2);
  });
});

describe('provider auth methods', () => {
  const auth = parseProviderAuthMethods({
    openai: [{ type: 'oauth', label: 'Browser' }, { type: 'api', label: 'Key' }],
    copilot: [{ type: 'oauth', label: 'Login' }],
  });

  it('classifies connect kinds', () => {
    expect(providerConnectKind('openai', auth)).toBe('api-key');
    expect(providerConnectKind('copilot', auth)).toBe('oauth-only');
    expect(providerConnectKind('deepinfra', auth)).toBe('api-key');
  });
});

describe('putProviderApiKey', () => {
  it('sends PUT /auth/:id with an api body and returns nothing', async () => {
    const calls: unknown[] = [];
    setOpenCodeTransport(async (args) => {
      calls.push(args);
      return true;
    });
    const out = await putProviderApiKey('p1', 'my provider', 'FAKE-TEST-VALUE');
    expect(out).toBeUndefined();
    expect(calls).toEqual([
      {
        pane_id: 'p1',
        method: 'PUT',
        path: '/auth/my%20provider',
        body: { type: 'api', key: 'FAKE-TEST-VALUE' },
      },
    ]);
  });
});

describe('mcp helpers', () => {
  it('parses the status map including failed errors', () => {
    expect(
      parseMcpServers({
        b: { status: 'failed', error: 'boom' },
        a: { status: 'connected' },
        c: { status: 'weird' },
      }),
    ).toEqual([
      { name: 'a', status: 'connected', error: undefined },
      { name: 'b', status: 'failed', error: 'boom' },
      { name: 'c', status: 'unknown', error: undefined },
    ]);
  });

  it('splits quoted command lines', () => {
    expect(splitCommandLine('npx -y  "my server" \'a b\' c')).toEqual([
      'npx',
      '-y',
      'my server',
      'a b',
      'c',
    ]);
    expect(splitCommandLine('   ')).toEqual([]);
  });

  it('builds local and remote add bodies and rejects bad input', () => {
    expect(buildMcpAddBody({ kind: 'local', name: 'fs', command: 'npx -y srv' })).toEqual({
      body: { name: 'fs', config: { type: 'local', command: ['npx', '-y', 'srv'], enabled: true } },
    });
    expect(buildMcpAddBody({ kind: 'remote', name: 'r', url: 'https://x.test/mcp' })).toEqual({
      body: { name: 'r', config: { type: 'remote', url: 'https://x.test/mcp', enabled: true } },
    });
    expect(buildMcpAddBody({ kind: 'local', name: '', command: 'x' })).toHaveProperty('error');
    expect(buildMcpAddBody({ kind: 'local', name: 'a b', command: 'x' })).toHaveProperty('error');
    expect(buildMcpAddBody({ kind: 'local', name: 'a', command: '  ' })).toHaveProperty('error');
    expect(buildMcpAddBody({ kind: 'remote', name: 'a', url: 'nope' })).toHaveProperty('error');
    expect(buildMcpAddBody({ kind: 'remote', name: 'a', url: 'ftp://x.test' })).toHaveProperty(
      'error',
    );
  });

  it('disconnect posts to the encoded name', async () => {
    const calls: unknown[] = [];
    setOpenCodeTransport(async (args) => {
      calls.push(args);
      return true;
    });
    await disconnectMcpServer('p1', 'a/b');
    expect(calls).toEqual([{ pane_id: 'p1', method: 'POST', path: '/mcp/a%2Fb/disconnect' }]);
  });
});

describe('config helpers', () => {
  const original = configDraftFromConfig({
    model: 'p/m',
    share: 'manual',
    autoupdate: true,
    ignored: 'x',
  });

  it('maps config to a draft', () => {
    expect(original).toEqual({ model: 'p/m', small_model: '', share: 'manual', autoupdate: 'true' });
    expect(configDraftFromConfig(null).share).toBe('');
    expect(configDraftFromConfig({ share: 'bogus' }).share).toBe('');
    expect(configDraftFromConfig({ autoupdate: 'notify' }).autoupdate).toBe('notify');
  });

  it('patches only changed, non-empty fields', () => {
    expect(buildConfigPatch(original, original)).toEqual({});
    expect(buildConfigPatch(original, { ...original, share: 'auto' })).toEqual({ share: 'auto' });
    expect(buildConfigPatch(original, { ...original, autoupdate: 'notify' })).toEqual({
      autoupdate: 'notify',
    });
    expect(buildConfigPatch(original, { ...original, autoupdate: 'false' })).toEqual({
      autoupdate: false,
    });
    expect(buildConfigPatch(original, { ...original, model: '', small_model: ' q/s ' })).toEqual({
      small_model: 'q/s',
    });
  });

  it('validates model refs', () => {
    expect(validateConfigDraft({ ...original, model: 'nomodel' }).model).toBeDefined();
    expect(validateConfigDraft({ ...original, small_model: 'a/' }).small_model).toBeDefined();
    expect(validateConfigDraft(original)).toEqual({});
  });

  it('saveConfigPatch PATCHes then re-reads /config', async () => {
    const calls: { method: string; path: string; body?: unknown }[] = [];
    setOpenCodeTransport(async (args) => {
      calls.push({ method: args.method, path: args.path, body: args.body });
      return args.method === 'GET' ? { share: 'auto' } : {};
    });
    const next = await saveConfigPatch('p1', { share: 'auto' });
    expect(next.share).toBe('auto');
    expect(calls).toEqual([
      { method: 'PATCH', path: '/config', body: { share: 'auto' } },
      { method: 'GET', path: '/config', body: undefined },
    ]);
  });
});
