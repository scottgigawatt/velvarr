"use client";

/*
 * Admin settings page: integration forms, Jellyfin/Whisparr status cards
 * and metadata provider credentials. Routed by Shell (?view=settings);
 * administrator accounts only.
 */

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useReducer,
  useState,
  type FormEvent,
} from "react";
import type {
  CredentialProvider,
  ProviderCheck,
  IntegrationConfig,
  JudgmentProvider,
} from "../lib/contracts.ts";
import {
  ApiError,
  api,
  ErrorPanel,
  ForbiddenPanel,
  messageOf,
  useSession,
} from "./shared.tsx";
import { LimitsPanel, ReleaseStatusPanel } from "./limits.tsx";
import { ConnectionsSettings } from "./connection-settings.tsx";
import {
  ConnectionState,
  SettingsServiceHeading,
  useEditorFocusReturn,
  useSettingsOperations,
  type ConnectionStateLabel,
  type RunSettingsOperation as RunProviderOperation,
  type SettingsOperations,
} from "./settings-service.tsx";
import {
  initJudgmentEditor,
  judgmentCheckDisabledReason,
  judgmentEditorSettings,
  providerSettingsActions,
  reduceJudgmentEditor,
} from "../lib/judgment-editor.ts";
import {
  canClearCredential,
  canTestCredential,
  connectionState,
} from "../lib/provider-settings.ts";
import {
  applyCredentialSave,
  credentialCardBusy,
  credentialEditorView,
  initCredentialCard,
  reduceCredentialCard,
} from "../lib/credential-card.ts";

/* ---------- Settings: integrations, Whisparr, providers ---------- */

export function SettingsView() {
  const [forbidden, setForbidden] = useState(false);
  const [section, setSection] = useState("connections");
  const operations = useSettingsOperations();
  // Stable identity keeps service checks from restarting on parent renders.
  const forbid = useCallback(() => setForbidden(true), []);
  if (forbidden) return <ForbiddenPanel />;

  return (
    <section className="settings-page" aria-label="Settings">
      <div className="page-heading">
        <div>
          <h1 className="page-title">Settings</h1>
          <p className="page-description">
            Connect your services and make Velvarr yours.
          </p>
        </div>
      </div>
      <nav className="settings-tabs" aria-label="Settings sections">
        {[
          ["connections", "Connections"],
          ["metadata", "Metadata providers"],
          ["system", "System"],
        ].map(([id, label]) => (
          <button
            key={id}
            type="button"
            aria-pressed={section === id}
            onClick={() => setSection(id!)}
          >
            {label}
          </button>
        ))}
      </nav>
      <div hidden={section !== "connections"}>
        <div className="settings-content">
          <ConnectionsSettings onForbidden={forbid} {...operations} />
        </div>
      </div>
      <div hidden={section !== "metadata"}>
        <div className="settings-content">
          <MetadataSettings {...operations} />
        </div>
      </div>
      <div hidden={section !== "system"}>
        <div className="settings-content">
          <LimitsPanel />
          <ReleaseStatusPanel />
        </div>
      </div>
    </section>
  );
}

// Shape of the settings response; credentials themselves are never returned.
type ProviderConfigRow = {
  configured: boolean;
  source: "stored" | "environment";
};
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
type SaveProviderSettings = (
  body: ProviderSettingsPatch,
) => Promise<ProviderSettingsInfo>;

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
    id: "stashdb",
    name: "StashDB",
    field: "stashdbApiKey",
    label: "API key",
    maxLength: 512,
    description: "Scene metadata, performers, studios, and tags.",
  },
] as const;

function MetadataSettings({ saving, runOperation }: SettingsOperations) {
  const { refreshSession } = useSession();
  const [info, setInfo] = useState<ProviderSettingsInfo | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);

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

  const save: SaveProviderSettings = (body) =>
    runOperation(async () => {
      // All metadata/AI saves and probes use one queue. A probe always reads
      // persisted settings, and a failed operation cannot block the next one.
      const data = await api<ProviderSettingsInfo>("/api/admin/integrations", {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      setInfo(data);
      setLoadError(null);
      refreshSession().catch(() => undefined);
      return data;
    });

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
          runOperation={runOperation}
          onSave={save}
        />
      ))}
      <JudgmentCard
        config={info?.judgment}
        keyConfig={info?.providers.typesafe}
        saving={saving}
        runOperation={runOperation}
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
  runOperation,
}: {
  config?: ProviderConfigRow;
  saving: boolean;
  onSave: SaveProviderSettings;
  runOperation: RunProviderOperation;
} & (typeof CREDENTIAL_ROWS)[number]) {
  const [editor, dispatch] = useReducer(
    reduceCredentialCard,
    undefined,
    initCredentialCard,
  );
  const inputRef = useRef<HTMLInputElement>(null);
  const { editRef, noticeRef } = useEditorFocusReturn(editor.editing);
  // Deleting a stored credential is destructive, so the click first opens this
  // confirmation; the id must be unique — this card renders once per provider.
  const clearRef = useRef<HTMLDialogElement>(null);
  const clearTitleId = useId();
  useEffect(() => {
    if (editor.editing) inputRef.current?.focus();
  }, [editor.editing]);

  const verify = useCallback(async () => {
    dispatch({ type: "checking" });
    try {
      dispatch({
        type: "checked",
        check: await runOperation(() =>
          api<ProviderCheck>("/api/admin/providers/" + id),
        ),
      });
    } catch (error) {
      if (error instanceof ApiError && error.status === 403)
        dispatch({ type: "forbidden" });
      else dispatch({ type: "checkFailed", message: messageOf(error) });
    }
  }, [id, runOperation]);
  useEffect(() => {
    void verify();
  }, [verify]);

  function cancel() {
    dispatch({ type: "cancel" });
  }

  async function apply(clear = false) {
    const { saved } = await applyCredentialSave({
      draft: editor.draft,
      clear,
      configured: config?.configured,
      name,
      label,
      performSave: (value) => onSave({ [field]: value }).then(() => undefined),
      dispatch,
      failureOf: (error) => ({
        forbidden: error instanceof ApiError && error.status === 403,
        message: messageOf(error),
      }),
    });
    if (saved) await verify();
  }

  // Checks read persisted credentials; a replacement draft is not yet verified.
  const unsaved = editor.editing && editor.draft.trim() !== "";
  const error =
    editor.checkError ??
    (editor.check?.configured && !editor.check.verified
      ? editor.check.error.message
      : null);
  const busy = credentialCardBusy(editor, saving);
  const actions = {
    canCheck: canTestCredential({
      draft: editor.draft,
      pending: saving || editor.forbidden,
      checking: editor.checking,
      configured: config?.configured,
    }),
    canEdit: !busy && Boolean(config),
    canClear: canClearCredential({ source: config?.source, pending: busy }),
  };
  // Transient busy states are announced by the live status row instead.
  const checkDisabledReason = !actions.canCheck
    ? unsaved
      ? "Save or cancel your changes before checking the connection."
      : config?.configured === false
        ? "Add a key to check the connection."
        : null
    : null;
  const state = connectionState({
    draft: editor.editing ? editor.draft : "",
    checking: editor.checking,
    check: editor.check,
    requestError: editor.checkError,
  });
  const stateLabels = {
    unsaved: "Unsaved changes",
    checking: "Checking…",
    connected: "Connected",
    failed: "Connection failed",
    not_configured: "Not configured",
    unknown: "Not checked",
  } as const;
  const connectionStateLabel: ConnectionStateLabel = stateLabels[state];
  return (
    <section className="panel p-5" aria-labelledby={"provider-heading-" + id}>
      <SettingsServiceHeading
        id={"provider-heading-" + id}
        title={name}
        description={description}
      >
        <button
          type="button"
          className="btn"
          disabled={!actions.canCheck}
          aria-describedby={
            checkDisabledReason ? "check-help-" + id : undefined
          }
          onClick={() => void verify()}
        >
          Check connection
        </button>
        {!editor.editing && (
          <button
            type="button"
            ref={editRef}
            className="btn"
            disabled={!actions.canEdit}
            onClick={() => dispatch({ type: "edit" })}
          >
            Edit
          </button>
        )}
      </SettingsServiceHeading>
      {checkDisabledReason && (
        <p id={"check-help-" + id} className="mt-3 text-sm text-muted">
          {checkDisabledReason}
        </p>
      )}
      <div className="settings-service-status" aria-live="polite">
        <ConnectionState state={connectionStateLabel} />
        {!unsaved && editor.check?.configured && editor.check.verified && (
          <span className="text-muted">{editor.check.account}</span>
        )}
        {config?.configured && (
          <span className="chip">
            {config.source === "stored"
              ? "Stored credential"
              : "From environment"}
          </span>
        )}
      </div>
      {editor.editing &&
        credentialEditorView({
          id,
          name,
          label,
          maxLength,
          configured: config?.configured,
          state: editor,
          canEdit: actions.canEdit,
          busy,
          inputRef,
          onDraftChange: (value) => dispatch({ type: "draft", value }),
          onCancel: cancel,
          onSubmit: (event) => {
            event.preventDefault();
            if (!busy && config) void apply();
          },
        })}
      {editor.editing && config?.source === "stored" && (
        <>
          {/* Deleting the stored credential is destructive, so the action
              lives in its own row below the form and asks first. */}
          <div className="settings-destructive-row">
            <button
              type="button"
              className="btn btn-danger"
              disabled={!actions.canClear}
              onClick={() => clearRef.current?.showModal()}
            >
              Clear stored credential
            </button>
          </div>
          <dialog
            ref={clearRef}
            className="bulk-dialog"
            aria-labelledby={clearTitleId}
          >
            <div className="p-5">
              <h3 id={clearTitleId} className="font-semibold">
                Clear the stored {name} credential?
              </h3>
              <p className="mt-2 text-sm text-muted">
                The encrypted credential is deleted from storage. {name} then
                falls back to the environment settings, and connection checks
                use that fallback.
              </p>
              <div className="mt-4 flex justify-end gap-2">
                <button
                  type="button"
                  className="btn"
                  onClick={() => clearRef.current?.close()}
                >
                  Keep credential
                </button>
                <button
                  type="button"
                  className="btn btn-danger"
                  disabled={!actions.canClear}
                  onClick={() => {
                    clearRef.current?.close();
                    void apply(true);
                  }}
                >
                  Clear credential
                </button>
              </div>
            </div>
          </dialog>
        </>
      )}
      {editor.saved && (
        <p
          ref={noticeRef}
          className="mt-3 text-sm text-muted"
          role="status"
          tabIndex={-1}
        >
          {editor.saved}
        </p>
      )}
      {editor.saveError && (
        <div className="mt-3">
          <ErrorPanel
            title={"Saving " + name + " credential failed"}
            message={editor.saveError}
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
      {editor.forbidden && (
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
  runOperation,
}: {
  config?: JudgmentConfig;
  keyConfig?: ProviderConfigRow;
  saving: boolean;
  onSave: SaveProviderSettings;
  runOperation: RunProviderOperation;
}) {
  const [editor, dispatch] = useReducer(
    reduceJudgmentEditor,
    undefined,
    initJudgmentEditor,
  );
  const [editing, setEditing] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [forbidden, setForbidden] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const selectRef = useRef<HTMLSelectElement>(null);
  const { editRef, noticeRef } = useEditorFocusReturn(editing);
  // Both actions below delete stored settings, so each click first opens a
  // confirmation dialog (unique ids: dialogs resolve aria-labelledby by id).
  const clearKeyRef = useRef<HTMLDialogElement>(null);
  const useEnvRef = useRef<HTMLDialogElement>(null);
  const clearKeyTitleId = useId();
  const useEnvTitleId = useId();
  const { provider, url, model } = editor.draft;
  const checking = editor.check?.state === "checking";
  const connected = editor.check?.state === "connected";
  const busy = saving || checking || forbidden;
  const actions = providerSettingsActions(editor, {
    ready: Boolean(config),
    pending: saving || forbidden,
    configured: Boolean(config?.configured),
  });
  const savedProvider = config && judgmentEditorSettings(config).provider;
  useEffect(() => {
    if (!config) return;
    const settings = judgmentEditorSettings(config);
    if (
      settings.provider !== editor.saved.provider ||
      settings.url !== editor.saved.url ||
      settings.model !== editor.saved.model
    ) {
      dispatch({ type: "loaded", settings });
    }
  }, [config, editor.saved]);
  useEffect(() => {
    if (editing) selectRef.current?.focus();
  }, [editing]);
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
  const checkDisabledReason = judgmentCheckDisabledReason(
    config,
    unsaved,
    setupMessage,
  );

  function begin() {
    if (!config) return;
    dispatch({ type: "cancel" });
    setApiKey("");
    setSaveError(null);
    setEditing(true);
  }

  function cancel() {
    setApiKey("");
    setSaveError(null);
    dispatch({ type: "cancel" });
    setEditing(false);
  }

  async function apply(
    body: ProviderSettingsPatch,
    success: string,
    verify = false,
  ) {
    setSaveError(null);
    try {
      const data = await onSave(body);
      setApiKey("");
      dispatch({
        type: "saved",
        settings: judgmentEditorSettings(data.judgment),
        notice: success,
      });
      setEditing(false);
      // Probe only after persistence succeeds: the endpoint reads saved settings,
      // not the draft. A failed probe must not turn a successful save into an error.
      if (verify && data.judgment.configured) await check();
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
        : "Settings saved.",
      !standard,
    );
  }

  async function check() {
    dispatch({ type: "checking" });
    try {
      const result = await runOperation(() =>
        api<{
          provider: JudgmentProvider;
          connected: boolean;
          error?: string;
        }>("/api/admin/judgment/check", { method: "POST", body: "{}" }),
      );
      dispatch({
        type: "checked",
        result: result.connected
          ? { connected: true, provider: result.provider }
          : { connected: false, message: result.error ?? "Connection failed." },
      });
    } catch (error) {
      if (error instanceof ApiError && error.status === 403) setForbidden(true);
      dispatch({
        type: "checked",
        result: { connected: false, message: messageOf(error) },
      });
    }
  }

  const connectionState: ConnectionStateLabel = (() => {
    if (checking) return "Checking…";
    if (unsaved) return "Unsaved changes";
    if (config?.error) return "Configuration error";
    if (editor.check?.state === "failed") return "Connection failed";
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
      {checkDisabledReason && (
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
      aria-describedby={checkDisabledReason ? "judgment-check-help" : undefined}
      onClick={() => void check()}
    >
      {checking ? "Checking…" : "Check connection"}
    </button>
  );

  return (
    <section className="panel p-5" aria-labelledby="judgment-heading">
      <SettingsServiceHeading
        id="judgment-heading"
        title="AI-assisted matching"
      >
        {!editing && (
          <>
            {!standard && checkButton}
            <button
              type="button"
              ref={editRef}
              className="btn"
              disabled={busy || !config}
              onClick={begin}
            >
              Edit
            </button>
          </>
        )}
      </SettingsServiceHeading>
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
                ref={selectRef}
                className="input"
                disabled={busy}
                value={provider}
                onChange={(event) => {
                  dispatch({
                    type: "edit",
                    patch: { provider: event.target.value as JudgmentProvider },
                  });
                  setSaveError(null);
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
                      onChange={(event) =>
                        dispatch({
                          type: "edit",
                          patch: { url: event.target.value },
                        })
                      }
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
                      onChange={(event) =>
                        dispatch({
                          type: "edit",
                          patch: { model: event.target.value },
                        })
                      }
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
                disabled={!actions.save}
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
            </div>
          </div>
        </form>
      )}
      {editing &&
        ((provider === "typesafe" && keyConfig?.source === "stored") ||
          config?.stored) && (
          <>
            {/* Both actions delete stored settings, so they live in their own
                row below the form and each asks first. */}
            <div className="settings-destructive-row">
              {provider === "typesafe" && keyConfig?.source === "stored" && (
                <button
                  type="button"
                  className="btn btn-danger"
                  disabled={busy}
                  onClick={() => clearKeyRef.current?.showModal()}
                >
                  Clear stored credential
                </button>
              )}
              {config?.stored && (
                <button
                  type="button"
                  className="btn btn-danger"
                  disabled={busy}
                  onClick={() => useEnvRef.current?.showModal()}
                >
                  Use environment settings
                </button>
              )}
            </div>
            <dialog
              ref={clearKeyRef}
              className="bulk-dialog"
              aria-labelledby={clearKeyTitleId}
            >
              <div className="p-5">
                <h3 id={clearKeyTitleId} className="font-semibold">
                  Clear the stored TypeSafe credential?
                </h3>
                <p className="mt-2 text-sm text-muted">
                  The stored key is deleted from storage. Environment settings
                  apply; without a key, standard matching remains active.
                </p>
                <div className="mt-4 flex justify-end gap-2">
                  <button
                    type="button"
                    className="btn"
                    onClick={() => clearKeyRef.current?.close()}
                  >
                    Keep credential
                  </button>
                  <button
                    type="button"
                    className="btn btn-danger"
                    disabled={busy}
                    onClick={() => {
                      clearKeyRef.current?.close();
                      void apply(
                        { typesafeApiKey: "" },
                        "Stored TypeSafe credential cleared. Environment settings apply.",
                      );
                    }}
                  >
                    Clear credential
                  </button>
                </div>
              </div>
            </dialog>
            <dialog
              ref={useEnvRef}
              className="bulk-dialog"
              aria-labelledby={useEnvTitleId}
            >
              <div className="p-5">
                <h3 id={useEnvTitleId} className="font-semibold">
                  Use environment settings?
                </h3>
                <p className="mt-2 text-sm text-muted">
                  The stored AI settings are deleted. The provider, URL and
                  model then come from the environment. Check the saved
                  connection afterwards to verify the selected model.
                </p>
                <div className="mt-4 flex justify-end gap-2">
                  <button
                    type="button"
                    className="btn"
                    onClick={() => useEnvRef.current?.close()}
                  >
                    Keep AI settings
                  </button>
                  <button
                    type="button"
                    className="btn btn-danger"
                    disabled={busy}
                    onClick={() => {
                      useEnvRef.current?.close();
                      void apply(
                        {
                          judgmentProvider: "",
                          ollamaUrl: "",
                          ollamaModel: "",
                        },
                        "Using environment settings. Check the saved connection to verify the selected model.",
                      );
                    }}
                  >
                    Use environment settings
                  </button>
                </div>
              </div>
            </dialog>
          </>
        )}
      {editor.notice && !unsaved && (
        <p
          ref={noticeRef}
          className="mt-3 text-sm text-muted"
          role="status"
          tabIndex={-1}
        >
          {editor.notice}
        </p>
      )}
      {editor.check && !unsaved && (
        <p
          className="judgment-check mt-2"
          data-state={editor.check.state}
          role="status"
        >
          {editor.check.state === "checking"
            ? "Checking the saved connection…"
            : editor.check.state === "connected"
              ? `${editor.check.provider === "ollama" ? "Ollama" : "TypeSafe"} answered a decision successfully.`
              : editor.check.message}
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
