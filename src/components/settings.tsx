"use client";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { WhisparrConnections } from "./whisparr-connections.tsx";
import {
  api,
  ApiError,
  useApiGet,
  useSession,
  ErrorPanel,
  messageOf,
} from "./shared.tsx";
import { LimitsPanel, ReleaseStatusPanel } from "./limits.tsx";
import { AppearanceView } from "./appearance.tsx";
import type { JudgmentProvider } from "../lib/contracts.ts";

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
        <section className="settings-group">
          <div className="settings-group-heading">
            <div>
              <h2>Metadata providers</h2>
              <p>Each catalog has its own credentials and connection check.</p>
            </div>
          </div>
          <ProviderRow
            id="tpdb"
            name="TPDB"
            field="tpdbApiToken"
            description="Movie metadata, performers, studios, and tags."
          />
          <ProviderRow
            id="tmdb"
            name="TMDB"
            field="tmdbReadToken"
            description="Movie metadata, keywords, cast, and recommendations."
          />
          <ProviderRow
            id="stashdb"
            name="StashDB"
            field="stashdbApiKey"
            description="Scene metadata, performers, studios, and tags."
          />
        </section>
        <JudgmentCard />
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

function ProviderRow({
  id,
  name,
  field,
  description,
}: {
  id: string;
  name: string;
  field: string;
  description: string;
}) {
  const { refreshSession } = useSession();
  const info = useApiGet<IntegrationInfo>("/api/admin/integrations", []);
  const [credential, setCredential] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [connected, setConnected] = useState<boolean | null>(null);
  const configured = info.data?.providers[id]?.configured ?? false;
  const save = async (clear = false) => {
    setPending(true);
    setMessage(null);
    setConnected(null);
    try {
      await api("/api/admin/integrations", {
        method: "PATCH",
        body: JSON.stringify({ [field]: clear ? "" : credential }),
      });
      setCredential("");
      info.reload();
      void refreshSession().catch(() => undefined);
      setMessage(
        clear
          ? "Stored credential cleared. Environment credentials still apply."
          : "Credential saved. Check the connection to verify it.",
      );
    } catch (error) {
      setMessage(messageOf(error));
    } finally {
      setPending(false);
    }
  };
  const check = async () => {
    setPending(true);
    setMessage(null);
    setConnected(null);
    try {
      const provider = await api<{
        verified?: boolean;
        configured: boolean;
        error?: { message: string };
      }>("/api/admin/providers/" + id);
      setConnected(provider.verified ?? false);
      setMessage(
        provider.verified
          ? "Connection verified."
          : (provider.error?.message ?? "No credential configured."),
      );
    } catch (error) {
      setConnected(false);
      setMessage(messageOf(error));
    } finally {
      setPending(false);
    }
  };
  useEffect(() => {
    if (configured) void check();
  }, [configured]);
  return (
    <article className="provider-row">
      <div className="provider-summary">
        <div>
          <h3>{name}</h3>
          <p className="field-help">{description}</p>
        </div>
        <span
          className={
            "connection-state " +
            (connected === true
              ? "is-ok"
              : connected === false
                ? "is-error"
                : "")
          }
        >
          {connected === true
            ? "Connected"
            : connected === false
              ? "Check failed"
              : configured
                ? "Credential saved"
                : "Not configured"}
        </span>
      </div>
      <div className="provider-controls">
        <label className="label" htmlFor={id + "-credential"}>
          {name === "TMDB" ? "API read access token" : "API key"}
          <input
            id={id + "-credential"}
            className="input"
            type="password"
            autoComplete="off"
            value={credential}
            disabled={pending}
            placeholder={
              configured
                ? "Leave blank to keep the current credential"
                : "Enter credential"
            }
            onChange={(event) => setCredential(event.target.value)}
          />
        </label>
        <div className="setting-actions">
          <button
            className="btn btn-accent"
            disabled={pending || !credential.trim()}
            onClick={() => void save()}
          >
            Save
          </button>
          <button
            className="btn"
            disabled={pending || !configured}
            onClick={() => void check()}
          >
            Check connection
          </button>
          {info.data?.providers[id]?.source === "stored" && (
            <button
              className="btn"
              disabled={pending}
              onClick={() => void save(true)}
            >
              Clear stored key
            </button>
          )}
        </div>
      </div>
      {message && (
        <p className="field-help" role="status">
          {message}
        </p>
      )}
    </article>
  );
}
function JudgmentCard() {
  const [apiKey, setApiKey] = useState("");
  const [keyConfigured, setKeyConfigured] = useState(false);
  const [provider, setProvider] = useState<JudgmentProvider>("none");
  const [url, setUrl] = useState("http://localhost:11434");
  const [model, setModel] = useState("nimble");
  const [configured, setConfigured] = useState(false);
  const [stored, setStored] = useState(false);
  const [pending, setPending] = useState(false);
  const [ready, setReady] = useState(false);
  const [forbidden, setForbidden] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      const { judgment, providers } = await api<{
        providers: { typesafe: { configured: boolean } };
        judgment: {
          provider: JudgmentProvider;
          url: string;
          model: string;
          configured: boolean;
          stored: boolean;
          error?: string;
        };
      }>("/api/admin/integrations");
      setKeyConfigured(providers.typesafe.configured);
      setProvider(
        !judgment.configured && !judgment.stored ? "none" : judgment.provider,
      );
      setUrl(judgment.url);
      setModel(judgment.model);
      setConfigured(judgment.configured);
      setStored(judgment.stored);
      if (judgment.error) setMessage(judgment.error);
      setReady(true);
    } catch (error) {
      if (error instanceof ApiError && error.status === 403) setForbidden(true);
      setMessage(messageOf(error));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  const save = async (clear = false) => {
    setPending(true);
    setMessage(null);
    try {
      await api("/api/admin/integrations", {
        method: "PATCH",
        body: JSON.stringify(
          clear
            ? { judgmentProvider: "", ollamaUrl: "", ollamaModel: "" }
            : provider !== "ollama"
              ? {
                  judgmentProvider: provider,
                  ...(provider === "typesafe" && apiKey
                    ? { typesafeApiKey: apiKey }
                    : {}),
                }
              : {
                  judgmentProvider: provider,
                  ollamaUrl: url,
                  ollamaModel: model,
                },
        ),
      });
      setApiKey("");
      await load();
      setMessage(
        "Settings saved. Test the connection to verify the selected model.",
      );
    } catch (error) {
      setMessage(messageOf(error));
    } finally {
      setPending(false);
    }
  };
  const check = async () => {
    setPending(true);
    setMessage(null);
    try {
      const result = await api<{
        provider: JudgmentProvider;
        connected: boolean;
        error?: string;
      }>("/api/admin/judgment/check", { method: "POST", body: "{}" });
      setMessage(
        result.connected
          ? `${result.provider === "ollama" ? "Ollama" : "TypeSafe"} answered a decision successfully.`
          : (result.error ?? "Connection failed."),
      );
    } catch (error) {
      setMessage(messageOf(error));
    } finally {
      setPending(false);
    }
  };
  return (
    <section className="settings-group">
      <h2 className="font-semibold">AI-assisted matching</h2>
      <p className="mt-1 text-sm text-muted">
        Choose TypeSafe or your own Ollama decision model for title review, tag
        suggestions, and related-title ranking. Similarity still requires
        administrator review and never grants playback access.
      </p>
      {forbidden ? (
        <p className="mt-3 text-sm text-muted">
          An administrator account is required to configure the model.
        </p>
      ) : (
        <div className="mt-4 space-y-3">
          <label className="label" htmlFor="judgment-provider">
            Provider
          </label>
          <select
            id="judgment-provider"
            className="input max-w-md"
            disabled={!ready || pending}
            value={provider}
            onChange={(e) => setProvider(e.target.value as JudgmentProvider)}
          >
            <option value="none">Standard matching (no AI)</option>
            <option value="typesafe">TypeSafe</option>
            <option value="ollama">Ollama (local)</option>
          </select>
          {provider === "ollama" ? (
            <>
              <label className="label" htmlFor="ollama-url">
                Ollama URL
              </label>
              <input
                id="ollama-url"
                className="input max-w-md"
                type="url"
                disabled={!ready || pending}
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
              <label className="label" htmlFor="ollama-model">
                Decision model
              </label>
              <input
                id="ollama-model"
                className="input max-w-md"
                disabled={!ready || pending}
                value={model}
                onChange={(e) => setModel(e.target.value)}
              />
              <p className="text-sm text-muted">
                Requires Ollama 0.35 or later and a downloaded decision model
                such as nimble or tev1. From Docker Desktop on a Mac, use
                http://host.docker.internal:11434 and allow private HTTP in
                Connections.
              </p>
            </>
          ) : provider === "none" ? (
            <p className="field-help">
              Use ordinary matching without calling an AI service.
            </p>
          ) : (
            <div className="setting-fields">
              <label className="label" htmlFor="typesafe-key">
                TypeSafe API key
              </label>
              <input
                id="typesafe-key"
                className="input"
                type="password"
                autoComplete="off"
                value={apiKey}
                placeholder={
                  keyConfigured
                    ? "Leave blank to keep the saved key"
                    : "Enter your TypeSafe API key"
                }
                onChange={(event) => setApiKey(event.target.value)}
                disabled={pending}
              />
              <p className="field-help">
                Optional. Without a key, ordinary matching remains available.
              </p>
              {keyConfigured && (
                <button
                  className="btn"
                  disabled={pending}
                  onClick={async () => {
                    setPending(true);
                    try {
                      await api("/api/admin/integrations", {
                        method: "PATCH",
                        body: JSON.stringify({ typesafeApiKey: "" }),
                      });
                      await load();
                    } catch (error) {
                      setMessage(messageOf(error));
                    } finally {
                      setPending(false);
                    }
                  }}
                >
                  Clear stored TypeSafe key
                </button>
              )}
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <button
              className="btn btn-accent"
              disabled={
                !ready ||
                pending ||
                (provider === "ollama" && (!url.trim() || !model.trim()))
              }
              onClick={() => void save()}
            >
              Save settings
            </button>
            <button
              className="btn"
              disabled={!ready || pending || !configured}
              onClick={() => void check()}
            >
              Test saved connection
            </button>
            {stored ? (
              <button
                className="btn"
                disabled={!ready || pending}
                onClick={() => void save(true)}
              >
                Use environment settings
              </button>
            ) : null}
          </div>
        </div>
      )}
      {message ? (
        <p className="mt-3 text-sm text-muted" role="status">
          {message}
        </p>
      ) : null}
    </section>
  );
}
