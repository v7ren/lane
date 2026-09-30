import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  CONFIG_AUTOUPDATE_VALUES,
  CONFIG_SHARE_VALUES,
  buildConfigPatch,
  emptyConfigDraft,
  errorMessage,
  loadConfigDraft,
  saveConfigPatch,
  validateConfigDraft,
  type ConfigDraft,
} from '../../lib/opencode/settings-data';
import { FieldInput, FieldLabel, FieldSelect, SettingsSection } from './settings-ui';

interface Props {
  /** OpenCode pane whose server is managed; null when no OpenCode agent is selected. */
  paneId: string | null;
}

const AUTOUPDATE_LABELS: Record<(typeof CONFIG_AUTOUPDATE_VALUES)[number], string> = {
  true: 'On',
  false: 'Off',
  notify: 'Notify only',
};

export function ConfigSection({ paneId }: Props) {
  const [original, setOriginal] = useState<ConfigDraft>(emptyConfigDraft);
  const [draft, setDraft] = useState<ConfigDraft>(emptyConfigDraft);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    if (!paneId) return;
    setLoading(true);
    setError(null);
    try {
      const next = await loadConfigDraft(paneId);
      setOriginal(next);
      setDraft(next);
      setLoaded(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [paneId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!paneId) {
    return (
      <SettingsSection title="Config" description="OpenCode server configuration.">
        <div
          data-testid="config-no-pane"
          className="rounded-xl border border-pm-border bg-pm-panel p-4 text-sm text-pm-muted"
        >
          Select an OpenCode agent to edit its config.
        </div>
      </SettingsSection>
    );
  }

  const validation = validateConfigDraft(draft);
  const patch = buildConfigPatch(original, draft);
  const changed = Object.keys(patch).length > 0;
  const invalid = Object.keys(validation).length > 0;

  const update = <K extends keyof ConfigDraft>(key: K, value: ConfigDraft[K]) => {
    setSaved(false);
    setDraft((prev) => ({ ...prev, [key]: value }));
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!changed || invalid || saving) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const next = await saveConfigPatch(paneId, patch);
      setOriginal(next);
      setDraft(next);
      setSaved(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <SettingsSection
      title="Config"
      description="A few safe OpenCode settings. Only fields you change are sent. Values cannot be cleared from here."
    >
      {loading && !loaded && <p className="text-xs text-pm-muted">Loading config…</p>}
      {loaded && (
        <form
          onSubmit={(e) => void submit(e)}
          className="space-y-4 rounded-xl border border-pm-border bg-pm-panel p-4"
          data-testid="config-form"
        >
          <div>
            <FieldLabel>Default model</FieldLabel>
            <FieldInput
              data-testid="config-model"
              aria-label="Default model"
              value={draft.model}
              placeholder="provider/model"
              onChange={(e) => update('model', e.target.value)}
            />
            {validation.model && (
              <p data-testid="config-model-error" className="mt-1 text-xs text-red-400">
                {validation.model}
              </p>
            )}
          </div>
          <div>
            <FieldLabel>Small model</FieldLabel>
            <FieldInput
              data-testid="config-small-model"
              aria-label="Small model"
              value={draft.small_model}
              placeholder="provider/model"
              onChange={(e) => update('small_model', e.target.value)}
            />
            {validation.small_model && (
              <p data-testid="config-small-model-error" className="mt-1 text-xs text-red-400">
                {validation.small_model}
              </p>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <FieldLabel>Sharing</FieldLabel>
              <FieldSelect
                data-testid="config-share"
                aria-label="Sharing"
                value={draft.share}
                onChange={(e) => {
                  const v = CONFIG_SHARE_VALUES.find((x) => x === e.target.value);
                  update('share', v ?? '');
                }}
              >
                <option value="">Not set</option>
                {CONFIG_SHARE_VALUES.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </FieldSelect>
            </div>
            <div>
              <FieldLabel>Auto-update</FieldLabel>
              <FieldSelect
                data-testid="config-autoupdate"
                aria-label="Auto-update"
                value={draft.autoupdate}
                onChange={(e) => {
                  const v = CONFIG_AUTOUPDATE_VALUES.find((x) => x === e.target.value);
                  update('autoupdate', v ?? '');
                }}
              >
                <option value="">Not set</option>
                {CONFIG_AUTOUPDATE_VALUES.map((v) => (
                  <option key={v} value={v}>
                    {AUTOUPDATE_LABELS[v]}
                  </option>
                ))}
              </FieldSelect>
            </div>
          </div>
          {error && (
            <p role="alert" data-testid="config-error" className="text-xs text-red-400">
              {error}
            </p>
          )}
          {saved && (
            <p role="status" data-testid="config-saved" className="text-xs text-emerald-400">
              Saved.
            </p>
          )}
          <button
            type="submit"
            data-testid="config-save"
            disabled={!changed || invalid || saving}
            className="rounded-lg border border-pm-border px-3 py-2 text-sm hover:bg-pm-border/40 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </form>
      )}
      {!loaded && error && (
        <p role="alert" data-testid="config-error" className="text-xs text-red-400">
          {error}
        </p>
      )}
    </SettingsSection>
  );
}
