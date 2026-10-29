"use client";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { WhisparrConnections } from "./whisparr-connections.tsx";
import {
  api,
  ApiError,
  useApiGet,
  useSession,
  ErrorPanel,
  ForbiddenPanel,
  messageOf,
} from "./shared.tsx";
import { LimitsPanel, ReleaseStatusPanel } from "./limits.tsx";
import { AppearanceView } from "./appearance.tsx";
import type { IntegrationConfig, JudgmentProvider } from "../lib/contracts.ts";

type IntegrationInfo = {
  allowHttp: boolean;
  jellyfin: {
    url: string;
    externalUrl: string;
    serverId: string;
    libraryIds: string[];
    apiKeyConfigured: boolean;
  };
  providers: Record<string, { configured: boolean; source: string }>;
};
type ServiceStatus = {
  configured: boolean;
  serverName?: string;
  appName?: string;
  version?: string;
  error?: { code: string; message: string };
};

export function SettingsView() {
  const [section, setSection] = useState("connections");
  return (
    <section className="settings-page" aria-label="Settings">
      <header className="page-heading">
        <div>
          <h1 className="page-title">Settings</h1>
          <p className="page-description">Your services, clearly connected.</p>
        </div>
      </header>
      <nav className="settings-tabs" aria-label="Settings sections">
        {[
          ["connections", "Connections"],
          ["metadata", "Metadata providers"],
          ["appearance", "Appearance"],
          ["system", "System"],
        ].map(([id, label]) => (
          <button
            key={id}
            aria-pressed={section === id}
            onClick={() => setSection(id!)}
          >
            {label}
          </button>
        ))}
      </nav>
      <div hidden={section !== "connections"} className="settings-content">
        <HttpPolicy />
        <JellyfinConnection />
        <WhisparrConnections />
      </div>
      <div hidden={section !== "metadata"} className="settings-content">
        <MetadataSettings />
      </div>
      <div hidden={section !== "appearance"}>
        <AppearanceView embedded />
      </div>
      <div hidden={section !== "system"} className="settings-content">
        <LimitsPanel />
        <ReleaseStatusPanel />
      </div>
    </section>
  );
}

function HttpPolicy() {
  const info = useApiGet<IntegrationInfo>("/api/admin/integrations", []);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const update = async (allowHttp: boolean) => {
    setPending(true);
    setError(null);
    try {
      await api("/api/admin/integrations", {
        method: "PATCH",
        body: JSON.stringify({ allowHttp }),
      });
      info.reload();
      window.dispatchEvent(new Event("velvarr:network-changed"));
    } catch (error) {
      setError(messageOf(error));
    } finally {
      setPending(false);
    }
  };
  return (
    <section className="settings-policy">
      <div>
        <h2>Local network connections</h2>
        <p className="field-help">
          Allow unencrypted HTTP to trusted private addresses, Docker hosts, and
          local service names. Public addresses still require HTTPS.
        </p>
      </div>
      <label className="switch-label">
        <input
          type="checkbox"
          role="switch"
          className="check"
          checked={info.data?.allowHttp ?? false}
          disabled={pending || !info.data}
          onChange={(event) => void update(event.target.checked)}
        />
        Allow private HTTP
      </label>
      {error && <ErrorPanel message={error} />}
    </section>
  );
}

function JellyfinConnection() {
  const info = useApiGet<IntegrationInfo>("/api/admin/integrations", []);
  const status = useApiGet<ServiceStatus>("/api/admin/jellyfin", []);
  const [editing, setEditing] = useState(false);
  const [url, setUrl] = useState("");
  const [externalUrl, setExternalUrl] = useState("");
  const [key, setKey] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const begin = () => {
    setUrl(info.data?.jellyfin.url ?? "");
    setExternalUrl(info.data?.jellyfin.externalUrl ?? "");
    setKey("");
    setEditing(true);
  };
  const save = async (event: FormEvent) => {
    event.preventDefault();
    setPending(true);
    setMessage(null);
    try {
      await api("/api/admin/integrations", {
        method: "PATCH",
        body: JSON.stringify({
          jellyfinUrl: url,
          jellyfinExternalUrl: externalUrl,
          ...(key ? { jellyfinApiKey: key } : {}),
        }),
      });
      setKey("");
      setEditing(false);
      info.reload();
      status.reload();
      setMessage("Jellyfin connection saved.");
    } catch (error) {
      setMessage(messageOf(error));
    } finally {
      setPending(false);
    }
  };
  return (
    <section className="settings-group" aria-labelledby="jellyfin-heading">
      <div className="settings-group-heading">
        <div>
          <h2 id="jellyfin-heading">Jellyfin</h2>
          <p>Your media library, accounts, and playback.</p>
        </div>
        <button
          className="btn"
          onClick={status.reload}
          disabled={status.revalidating}
        >
          Check connection
        </button>
      </div>
      <div className="connection-instance">
        <div className="instance-heading">
          <div>
            <h3>{status.data?.serverName ?? "Media server"}</h3>
            <p className="connection-address">
              {info.data?.jellyfin.url ?? "Loading connection…"}
            </p>
          </div>
          <span
            className={
              "connection-state " +
              (status.data?.error || status.error
                ? "is-error"
                : status.data?.configured
                  ? "is-ok"
                  : "")
            }
          >
            {status.revalidating
              ? "Checking…"
              : status.data?.error || status.error
                ? "Connection failed"
                : status.data?.configured
                  ? "Connected"
                  : "Not configured"}
          </span>
          <button
            className="btn"
            disabled={!info.data}
            onClick={editing ? () => setEditing(false) : begin}
          >
            {editing ? "Cancel" : "Edit connection"}
          </button>
        </div>
        {status.data?.version && (
          <p className="instance-meta">
            Version {status.data.version} ·{" "}
            {info.data?.jellyfin.libraryIds.length ?? 0} selected libraries
          </p>
        )}
        {(status.data?.error || status.error) && (
          <ErrorPanel message={status.data?.error?.message ?? status.error!} />
        )}
        {editing && (
          <form
            className="instance-configuration"
            onSubmit={(event) => void save(event)}
          >
            <div className="setting-fields two-columns">
              <label className="label">
                Server URL
                <input
                  className="input"
                  type="url"
                  required
                  value={url}
                  onChange={(event) => setUrl(event.target.value)}
                />
              </label>
              <label className="label">
                Playback URL
                <input
                  className="input"
                  type="url"
                  required
                  value={externalUrl}
                  onChange={(event) => setExternalUrl(event.target.value)}
                />
              </label>
              <label className="label">
                API key
                <input
                  className="input"
                  type="password"
                  autoComplete="off"
                  value={key}
                  placeholder={
                    info.data?.jellyfin.apiKeyConfigured
                      ? "Leave blank to keep"
                      : "Required"
                  }
                  onChange={(event) => setKey(event.target.value)}
                />
              </label>
            </div>
            <p className="field-help">
              The playback URL is the address your browser can reach. Moving to
              another server address requires its API key again.
            </p>
            <button className="btn btn-accent" type="submit" disabled={pending}>
              {pending ? "Saving…" : "Save Jellyfin"}
            </button>
          </form>
        )}
      </div>
      {info.error && <ErrorPanel message={info.error} />}
      {message && (
        <p role="status" className="field-help">
          {message}
        </p>
      )}
    </section>
  );
}

// Shape of the settings response; credentials themselves are never returned.
type ProviderConfigRow = {
  configured: boolean;
  source: "stored" | "environment";
};
type CredentialProvider = "tpdb" | "tmdb" | "stashdb";
type JudgmentConfig = {
  provider: JudgmentProvider;
  url: string;
  model: string;
  configured: boolean;
  stored: boolean;
  error?: string;
};
type ProviderSettingsInfo = {
  providers: Record<CredentialProvider | "typesafe", ProviderConfigRow>;
  judgment: JudgmentConfig;
};
type ProviderSettingsPatch = Partial<
  Omit<NonNullable<IntegrationConfig["providers"]>, "judgmentProvider"> & {
    judgmentProvider: JudgmentProvider | "";
  }
>;
type SaveProviderSettings = (body: ProviderSettingsPatch) => Promise<void>;
type ProviderCheckRow =
  | { provider: CredentialProvider; configured: false }
  | {
      provider: CredentialProvider;
      configured: true;
      verified: true;
      account: string;
    }
  | {
      provider: CredentialProvider;
      configured: true;
      verified: false;
      error: { code: string; message: string };
    };

const CREDENTIAL_ROWS = [
  {
    id: "tpdb",
    name: "TPDB",
    field: "tpdbApiToken",
    label: "API token",
    maxLength: 1024,
    description: "Movie metadata, performers, studios, and tags.",
  },
  {
    id: "tmdb",
    name: "TMDB",
    field: "tmdbReadToken",
    label: "API read access token",
    maxLength: 2048,
    description: "Movie metadata, keywords, cast, and recommendations.",
  },
  {
    id: "stashdb",
    name: "StashDB",
    field: "stashdbApiKey",
    label: "API key",
    maxLength: 512,
    description: "Scene metadata, performers, studios, and tags.",
  },
] as const;

const CONNECTION_STATE_CLASSES = {
  "Loading configuration…": "",
  "Checking…": "",
  "Unsaved changes": "",
  "Not configured": "",
  "Not checked": "",
  Connected: "is-ok",
  "Connection failed": "is-error",
  "Configuration error": "is-error",
} as const;
type ConnectionStateLabel = keyof typeof CONNECTION_STATE_CLASSES;

function ConnectionState({ state }: { state: ConnectionStateLabel }) {
  return (
    <span className={"connection-state " + CONNECTION_STATE_CLASSES[state]}>
      {state}
    </span>
  );
}

function MetadataSettings() {
  const { refreshSession } = useSession();
  const [info, setInfo] = useState<ProviderSettingsInfo | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);

  const load = useCallback(() => {
    setLoadError(null);
    api<ProviderSettingsInfo>("/api/admin/integrations")
      .then(setInfo)
      .catch((error) => {
        if (error instanceof ApiError && error.status === 403)
          setForbidden(true);
        else setLoadError(messageOf(error));
      });
  }, []);
  useEffect(load, [load]);

  const save: SaveProviderSettings = async (body) => {
    // Metadata and AI settings share one stored configuration. Serialize all
    // writes without resetting another card's draft.
    if (savingRef.current)
      throw new Error("Wait for the current save to finish.");
    savingRef.current = true;
    setSaving(true);
    try {
      const data = await api<ProviderSettingsInfo>("/api/admin/integrations", {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      setInfo(data);
      setLoadError(null);
      refreshSession().catch(() => undefined);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  if (forbidden) return <ForbiddenPanel />;
  return (
    <>
      {loadError && (
        <ErrorPanel
          title="Provider configuration read failed"
          message={loadError}
          onRetry={load}
        />
      )}
      {CREDENTIAL_ROWS.map((row) => (
        <ProviderCredentialCard
          key={row.id}
          {...row}
          config={info?.providers[row.id]}
          saving={saving}
          onSave={save}
        />
      ))}
      <JudgmentCard
        config={info?.judgment}
        keyConfig={info?.providers.typesafe}
        saving={saving}
        onSave={save}
      />
    </>
  );
}

function ProviderCredentialCard({
  id,
  name,
  field,
  label,
  maxLength,
  description,
  config,
  saving,
  onSave,
}: {
  config?: ProviderConfigRow;
  saving: boolean;
  onSave: SaveProviderSettings;
} & (typeof CREDENTIAL_ROWS)[number]) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [check, setCheck] = useState<ProviderCheckRow | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);

  const verify = useCallback(async () => {
    setChecking(true);
    setCheck(null);
    setCheckError(null);
    try {
      setCheck(await api<ProviderCheckRow>("/api/admin/providers/" + id));
    } catch (error) {
      if (error instanceof ApiError && error.status === 403) setForbidden(true);
      else setCheckError(messageOf(error));
    } finally {
      setChecking(false);
    }
  }, [id]);
  useEffect(() => {
    void verify();
  }, [verify]);

  function cancel() {
    setDraft("");
    setSaveError(null);
    setEditing(false);
  }

  async function apply(clear = false) {
    setSaveError(null);
    setSaved(null);
    try {
      // A blank edit keeps the current credential; removal is explicit.
      if (clear || draft.trim()) {
        await onSave({ [field]: clear ? "" : draft.trim() });
        setSaved(
          clear
            ? "Stored credential cleared. Environment settings apply."
            : "Credential saved.",
        );
      }
      setDraft("");
      setEditing(false);
      if (clear || draft.trim()) await verify();
    } catch (error) {
      if (error instanceof ApiError && error.status === 403) setForbidden(true);
      else setSaveError(messageOf(error));
    }
  }

  // Checks read persisted credentials; a replacement draft is not yet verified.
  const unsaved = editing && draft.trim() !== "";
  const error =
    checkError ??
    (check?.configured && !check.verified ? check.error.message : null);
  const busy = saving || checking || forbidden;
  const connectionState: ConnectionStateLabel = (() => {
    if (checking) return "Checking…";
    if (unsaved) return "Unsaved changes";
    if (error) return "Connection failed";
    if (check?.configured && check.verified) return "Connected";
    if (!config) return "Loading configuration…";
    return config.configured ? "Not checked" : "Not configured";
  })();
  return (
    <section
      className="panel p-5 settings-service"
      aria-labelledby={"provider-heading-" + id}
    >
      <div className="settings-service-summary">
        <div className="settings-service-heading">
          <h2 id={"provider-heading-" + id}>{name}</h2>
          <p>{description}</p>
        </div>
        <div className="settings-service-buttons">
          <button
            type="button"
            className="btn"
            disabled={busy || !config || unsaved}
            title={
              unsaved
                ? "Save or cancel your changes before checking the connection."
                : undefined
            }
            onClick={() => void verify()}
          >
            Check connection
          </button>
          {!editing && (
            <button
              type="button"
              className="btn"
              disabled={busy || !config}
              aria-expanded={false}
              aria-controls={"provider-editor-" + id}
              onClick={() => {
                setSaved(null);
                setEditing(true);
              }}
            >
              Edit
            </button>
          )}
        </div>
      </div>
      <div className="settings-service-status" aria-live="polite">
        <ConnectionState state={connectionState} />
        {!unsaved && check?.configured && check.verified && (
          <span className="text-muted">{check.account}</span>
        )}
        {config?.configured && (
          <span className="chip">
            {config.source === "stored"
              ? "Stored credential"
              : "From environment"}
          </span>
        )}
      </div>
      {editing && (
        <form
          id={"provider-editor-" + id}
          className="settings-service-editor"
          onSubmit={(event) => {
            event.preventDefault();
            if (!busy && config) void apply();
          }}
        >
          <label className="label" htmlFor={"provider-" + id}>
            {name} {label}
          </label>
          <input
            id={"provider-" + id}
            className="input mt-2"
            type="password"
            autoComplete="off"
            maxLength={maxLength}
            disabled={busy || !config}
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value);
              setSaveError(null);
            }}
            placeholder={
              config?.configured
                ? "Leave blank to keep the current credential"
                : "Enter credential"
            }
          />
          <p className="mt-2 text-sm text-muted">
            Saved credentials are encrypted and take precedence over the
            environment. Connection checks use the saved credential or
            environment fallback.
          </p>
          <div className="settings-service-buttons mt-4">
            <button
              type="submit"
              className="btn btn-accent"
              disabled={busy || !config}
            >
              Save
            </button>
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={cancel}
            >
              Cancel
            </button>
            {config?.source === "stored" && (
              <button
                type="button"
                className="btn"
                disabled={busy}
                onClick={() => void apply(true)}
              >
                Clear stored credential
              </button>
            )}
          </div>
        </form>
      )}
      {saved && (
        <p className="mt-3 text-sm text-muted" role="status">
          {saved}
        </p>
      )}
      {saveError && (
        <div className="mt-3">
          <ErrorPanel
            title={"Saving " + name + " credential failed"}
            message={saveError}
          />
        </div>
      )}
      {error && !unsaved && (
        <div className="mt-3">
          <ErrorPanel
            title={name + " connection check failed"}
            message={error}
            onRetry={busy ? undefined : () => void verify()}
          />
        </div>
      )}
      {forbidden && (
        <p className="mt-3 text-sm text-muted">
          An administrator account is required to edit and verify credentials.
        </p>
      )}
    </section>
  );
}

/** Metadata credentials stay separate from the optional AI provider. */
function JudgmentCard({
  config,
  keyConfig,
  saving,
  onSave,
}: {
  config?: JudgmentConfig;
  keyConfig?: ProviderConfigRow;
  saving: boolean;
  onSave: SaveProviderSettings;
}) {
  const [editing, setEditing] = useState(false);
  const [provider, setProvider] = useState<JudgmentProvider>("none");
  const [url, setUrl] = useState("");
  const [model, setModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [checking, setChecking] = useState(false);
  const [connected, setConnected] = useState<boolean | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const busy = saving || checking || forbidden;
  // With no configured or explicitly selected backend, present standard
  // matching. An explicit "none" save also overrides environment credentials.
  const savedProvider =
    config && !config.configured && !config.stored && !config.error
      ? "none"
      : config?.provider;
  const displayedProvider = editing ? provider : savedProvider;
  const standard = displayedProvider === "none";
  const providerName = standard
    ? "Standard matching"
    : displayedProvider === "ollama"
      ? "Ollama"
      : "TypeSafe";
  const displayedUrl = editing ? url.trim() : config?.url;
  const displayedModel = editing ? model.trim() : config?.model;
  const unsaved =
    editing &&
    Boolean(config) &&
    (provider !== savedProvider ||
      (provider === "typesafe"
        ? apiKey.trim() !== ""
        : provider === "ollama" &&
          (url.trim() !== config?.url || model.trim() !== config?.model)));
  const setupMessage =
    displayedProvider === "ollama"
      ? "Enter your Ollama URL and model, then save to check the connection."
      : "Enter your TypeSafe API key, then save to check the connection.";
  const checkDisabledReason = !config
    ? "Loading saved configuration."
    : unsaved || !config.configured
      ? setupMessage
      : config.error;

  function begin() {
    if (!config) return;
    setProvider(savedProvider ?? "none");
    setUrl(config.url);
    setModel(config.model);
    setApiKey("");
    setMessage(null);
    setSaveError(null);
    setEditing(true);
  }

  function cancel() {
    setApiKey("");
    setSaveError(null);
    setEditing(false);
  }

  async function apply(
    body: ProviderSettingsPatch,
    success: string,
    verify = false,
  ) {
    setSaveError(null);
    setMessage(null);
    try {
      await onSave(body);
      setApiKey("");
      setConnected(null);
      setEditing(false);
      // Probe only after persistence succeeds: the endpoint reads saved settings,
      // not the draft. A failed probe must not turn a successful save into an error.
      if (verify) await check();
      else setMessage(success);
    } catch (error) {
      if (error instanceof ApiError && error.status === 403) setForbidden(true);
      else setSaveError(messageOf(error));
    }
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (busy || !config) return;
    await apply(
      provider === "ollama"
        ? {
            judgmentProvider: provider,
            ollamaUrl: url.trim(),
            ollamaModel: model.trim(),
          }
        : {
            judgmentProvider: provider,
            ...(provider === "typesafe" && apiKey.trim()
              ? { typesafeApiKey: apiKey.trim() }
              : {}),
          },
      standard
        ? "Standard matching saved. AI-assisted matching is disabled."
        : "",
      !standard,
    );
  }

  async function check() {
    setChecking(true);
    setMessage(null);
    try {
      const result = await api<{
        provider: JudgmentProvider;
        connected: boolean;
        error?: string;
      }>("/api/admin/judgment/check", { method: "POST", body: "{}" });
      setConnected(result.connected);
      setMessage(
        result.connected
          ? `${result.provider === "ollama" ? "Ollama" : "TypeSafe"} answered a decision successfully.`
          : (result.error ?? "Connection failed."),
      );
    } catch (error) {
      if (error instanceof ApiError && error.status === 403) setForbidden(true);
      setConnected(false);
      setMessage(messageOf(error));
    } finally {
      setChecking(false);
    }
  }

  const connectionState: ConnectionStateLabel = (() => {
    if (checking) return "Checking…";
    if (unsaved) return "Unsaved changes";
    if (config?.error) return "Configuration error";
    if (connected === false) return "Connection failed";
    if (connected) return "Connected";
    return config?.configured ? "Not checked" : "Not configured";
  })();
  const status = (
    <div className="settings-service-status" aria-live="polite">
      {config && !standard && <ConnectionState state={connectionState} />}
      {!editing && (
        <span className={config && !standard ? "text-muted" : "chip"}>
          {config
            ? standard
              ? "Standard matching (no AI)"
              : providerName
            : "Loading configuration…"}
        </span>
      )}
    </div>
  );

  const details = (
    <>
      {status}
      {!editing && (
        <p className="mt-3 text-sm text-muted">
          {displayedProvider === "ollama"
            ? (displayedUrl || "URL not set") +
              " · " +
              (displayedModel || "Model not set")
            : "TypeSafe key: " +
              (keyConfig?.configured
                ? keyConfig.source === "stored"
                  ? "Stored"
                  : "From environment"
                : "Not configured")}
        </p>
      )}
      {!editing && checkDisabledReason && (
        <p id="judgment-check-help" className="mt-3 text-sm text-muted">
          {checkDisabledReason}
        </p>
      )}
      {config?.error && !unsaved && (
        <div className="mt-3">
          <ErrorPanel
            title="Judgment configuration error"
            message={config.error}
          />
        </div>
      )}
    </>
  );

  const checkButton = (
    <button
      type="button"
      className="btn"
      disabled={busy || Boolean(checkDisabledReason)}
      title={checkDisabledReason}
      aria-describedby={
        !editing && checkDisabledReason ? "judgment-check-help" : undefined
      }
      onClick={() => void check()}
    >
      {checking ? "Checking…" : "Check connection"}
    </button>
  );

  return (
    <section
      className="panel p-5 settings-service"
      aria-labelledby="judgment-heading"
    >
      <div className="settings-service-summary">
        <div className="settings-service-heading">
          <h2 id="judgment-heading">AI-assisted matching</h2>
        </div>
        {!editing && (
          <div className="settings-service-buttons">
            {!standard && checkButton}
            <button
              type="button"
              className="btn"
              disabled={busy || !config}
              aria-expanded={false}
              aria-controls="judgment-editor"
              onClick={begin}
            >
              Edit
            </button>
          </div>
        )}
      </div>
      {!editing &&
        (standard ? (
          <>
            {status}
            <p className="mt-3 text-sm text-muted">
              Use standard matching without calling an AI service.
            </p>
          </>
        ) : (
          <div className="mt-3">{details}</div>
        ))}
      {editing && (
        <form
          id="judgment-editor"
          className="settings-service-editor"
          onSubmit={(event) => void save(event)}
        >
          <div className="space-y-3">
            <label className="label" htmlFor="judgment-provider">
              Provider
            </label>
            <div className="settings-select max-w-md">
              <select
                id="judgment-provider"
                className="input"
                disabled={busy}
                value={provider}
                onChange={(event) => {
                  setProvider(event.target.value as JudgmentProvider);
                  setSaveError(null);
                  setMessage(null);
                }}
              >
                <option value="none">Standard matching (no AI)</option>
                <option value="typesafe">TypeSafe</option>
                <option value="ollama">Ollama</option>
              </select>
            </div>
            {standard ? (
              <p className="text-sm text-muted">
                Use standard matching without calling an AI service.
              </p>
            ) : (
              <>
                {details}
                {provider === "typesafe" ? (
                  <>
                    <label className="label" htmlFor="typesafe-key">
                      TypeSafe API key
                    </label>
                    <input
                      id="typesafe-key"
                      className="input"
                      type="password"
                      autoComplete="off"
                      maxLength={512}
                      disabled={busy}
                      value={apiKey}
                      onChange={(event) => setApiKey(event.target.value)}
                      placeholder={
                        keyConfig?.configured
                          ? "Leave blank to keep the current credential"
                          : "Enter your TypeSafe API key"
                      }
                    />
                    <p className="text-sm text-muted">
                      Optional. Without a key, standard matching remains active.
                    </p>
                  </>
                ) : (
                  <>
                    <label className="label" htmlFor="ollama-url">
                      Ollama URL
                    </label>
                    <input
                      id="ollama-url"
                      className="input"
                      type="url"
                      required
                      disabled={busy}
                      value={url}
                      onChange={(event) => setUrl(event.target.value)}
                    />
                    <label className="label" htmlFor="ollama-model">
                      Decision model
                    </label>
                    <input
                      id="ollama-model"
                      className="input"
                      required
                      disabled={busy}
                      value={model}
                      onChange={(event) => setModel(event.target.value)}
                    />
                    <p className="text-sm text-muted">
                      Use a reachable Ollama server with a decision model such
                      as nimble or tev1.
                    </p>
                  </>
                )}
                <p className="text-sm text-muted">
                  Tag suggestions send search terms to {providerName}. Matches
                  still require administrator review.
                </p>
              </>
            )}
            <div className="settings-service-buttons">
              <button
                type="submit"
                className="btn btn-accent"
                disabled={
                  busy ||
                  (provider === "ollama" && (!url.trim() || !model.trim()))
                }
              >
                Save
              </button>
              <button
                type="button"
                className="btn"
                disabled={busy}
                onClick={cancel}
              >
                Cancel
              </button>
              {!standard && checkButton}
              {provider === "typesafe" && keyConfig?.source === "stored" && (
                <button
                  type="button"
                  className="btn"
                  disabled={busy}
                  onClick={() =>
                    void apply(
                      { typesafeApiKey: "" },
                      "Stored TypeSafe credential cleared. Environment settings apply.",
                    )
                  }
                >
                  Clear stored credential
                </button>
              )}
              {!standard && config?.stored && (
                <button
                  type="button"
                  className="btn"
                  disabled={busy}
                  onClick={() =>
                    void apply(
                      { judgmentProvider: "", ollamaUrl: "", ollamaModel: "" },
                      "Using environment settings. Check the saved connection to verify the selected model.",
                    )
                  }
                >
                  Use environment settings
                </button>
              )}
            </div>
          </div>
        </form>
      )}
      {message && !unsaved && (
        <p className="mt-3 text-sm text-muted" role="status">
          {message}
        </p>
      )}
      {saveError && (
        <div className="mt-3">
          <ErrorPanel title="Saving AI settings failed" message={saveError} />
        </div>
      )}
      {forbidden && (
        <p className="mt-3 text-sm text-muted">
          An administrator account is required to configure the model.
        </p>
      )}
    </section>
  );
}
