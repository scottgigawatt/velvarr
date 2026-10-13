"use client";

import { useCallback, useEffect, useState } from "react";
import type { WhisparrConnection, WhisparrDelivery } from "../lib/contracts.ts";
import { api, ErrorPanel, messageOf } from "./shared.tsx";

type Connection = Omit<WhisparrConnection, "apiKey"> & {
  apiKey: string;
  apiKeyConfigured?: boolean;
};
type Status = {
  version?: string;
  configured?: boolean;
  error?: { code: string; message: string };
  checkedAt?: string;
  url?: string;
  rootFolders?: { id: number; path: string }[];
  profiles?: { id: number; name: string }[];
};
const defaultDelivery = (root: string): WhisparrDelivery => ({
  enabled: false,
  rootFolderPath: root,
  qualityProfileId: 1,
  searchOnAdd: false,
});

/** Each connection owns its roots, credentials, and Jellyfin path correspondence. */
export function WhisparrConnections() {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [ready, setReady] = useState(false);
  const [pending, setPending] = useState(false);
  const [checkingId, setCheckingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [status, setStatus] = useState<Record<string, Status>>({});
  const load = useCallback(() => {
    api<{ connections: Omit<Connection, "apiKey">[] }>(
      "/api/admin/whisparr/connections",
    )
      .then((d) => {
        setConnections(d.connections.map((c) => ({ ...c, apiKey: "" })));
        setReady(true);
        void api<{ instances: (Status & { instanceId: string })[] }>(
          "/api/admin/whisparr/statuses",
        )
          .then((result) =>
            setStatus(
              Object.fromEntries(
                result.instances.map((item) => [
                  item.instanceId,
                  { ...item, checkedAt: new Date().toISOString() },
                ]),
              ),
            ),
          )
          .catch((error) => setError(messageOf(error)));
      })
      .catch((e) => setError(messageOf(e)));
  }, []);
  useEffect(load, [load]);
  useEffect(() => {
    window.addEventListener("velvarr:connections-changed", load);
    return () =>
      window.removeEventListener("velvarr:connections-changed", load);
  }, [load]);
  const patch = (i: number, value: Partial<Connection>) =>
    setConnections((cs) =>
      cs.map((c, j) => (i === j ? { ...c, ...value } : c)),
    );
  const save = async () => {
    setPending(true);
    setError(null);
    setMessage(null);
    try {
      const result = await api<{ connections: Omit<Connection, "apiKey">[] }>(
        "/api/admin/whisparr/connections",
        { method: "PATCH", body: JSON.stringify({ connections }) },
      );
      setConnections(result.connections.map((c) => ({ ...c, apiKey: "" })));
      setEditingIndex(null);
      window.dispatchEvent(new Event("velvarr:connections-changed"));
      setMessage(
        "Connections saved. Existing approvals retain their original destination.",
      );
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setPending(false);
    }
  };
  const check = async (c: Connection) => {
    if (!c.instanceId) return;
    setPending(true);
    setCheckingId(c.instanceId);
    setError(null);
    try {
      const data = await api<Status>(
        `/api/admin/whisparr/connections/${c.instanceId}`,
      );
      setStatus((s) => ({
        ...s,
        [c.instanceId!]: { ...data, checkedAt: new Date().toISOString() },
      }));
    } catch (e) {
      setError(messageOf(e));
      setStatus((values) => ({
        ...values,
        [c.instanceId!]: {
          configured: true,
          url: values[c.instanceId!]?.url,
          error: { code: "check_failed", message: messageOf(e) },
        },
      }));
    } finally {
      setPending(false);
      setCheckingId(null);
    }
  };
  return (
    <section className="settings-group" aria-labelledby="whisparr-heading">
      <h2 id="whisparr-heading">Whisparr</h2>
      <p className="mt-2 text-sm text-muted">
        Assign one connection to each movie provider. Scenes use the default
        connection unless staff chooses another before approval. Each connection
        has separate movie and scene roots; import and recycle folders remain
        managed by Whisparr.
      </p>
      {error && <ErrorPanel message={error} />}
      <div className="instance-list">
        {connections.map((c, i) => {
          const checked = c.instanceId ? status[c.instanceId] : undefined;
          const changed =
            Boolean(c.apiKey) || Boolean(checked?.url && checked.url !== c.url);
          const checking = checkingId !== null && checkingId === c.instanceId;
          return (
            <section key={c.instanceId ?? i} className="connection-instance">
              <div className="instance-heading">
                <div>
                  <h3>{c.name || "New instance"}</h3>
                  <p className="connection-address">
                    {c.url || "Enter a server URL"}
                  </p>
                </div>
                <span
                  className={
                    "connection-state " +
                    (changed || checking
                      ? ""
                      : checked?.error
                        ? "is-error"
                        : checked?.version
                          ? "is-ok"
                          : "")
                  }
                >
                  {changed
                    ? "Unsaved connection"
                    : checking
                      ? "Checking…"
                      : checked?.error
                        ? "Connection failed"
                        : checked?.version
                          ? "Connected"
                          : c.instanceId
                            ? "Not checked"
                            : "Not saved"}
                </span>
                <button
                  className="btn"
                  disabled={pending || !c.instanceId || changed}
                  onClick={() => void check(c)}
                >
                  Check connection
                </button>
                <button
                  className="btn"
                  disabled={pending}
                  aria-expanded={editingIndex === i}
                  onClick={() => setEditingIndex(editingIndex === i ? null : i)}
                >
                  {editingIndex === i ? "Close" : "Edit instance"}
                </button>
              </div>
              <div className="instance-meta">
                <span>
                  {c.movieProvider === "none"
                    ? "Scenes only"
                    : c.movieProvider.toUpperCase() + " movies"}
                </span>
                {c.sceneDefault && <span>Default for scenes</span>}
                {checked?.version && <span>Version {checked.version}</span>}
                {checked?.checkedAt && (
                  <span>
                    Checked {new Date(checked.checkedAt).toLocaleTimeString()}
                  </span>
                )}
              </div>
              {checked?.error && <ErrorPanel message={checked.error.message} />}
              <fieldset
                className="instance-configuration"
                disabled={pending}
                hidden={editingIndex !== i}
              >
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="label">
                    Name
                    <input
                      className="input"
                      value={c.name}
                      maxLength={80}
                      onChange={(e) => patch(i, { name: e.target.value })}
                    />
                  </label>
                  <label className="label">
                    URL
                    <input
                      className="input"
                      type="url"
                      value={c.url}
                      onChange={(e) => patch(i, { url: e.target.value })}
                    />
                  </label>
                  <label className="label">
                    API key
                    <input
                      className="input"
                      type="password"
                      autoComplete="off"
                      value={c.apiKey}
                      placeholder={
                        c.apiKeyConfigured ? "Leave blank to keep" : "Required"
                      }
                      onChange={(e) => patch(i, { apiKey: e.target.value })}
                    />
                  </label>
                  <label className="label">
                    Movies
                    <select
                      className="input"
                      value={c.movieProvider}
                      onChange={(e) =>
                        patch(i, {
                          movieProvider: e.target
                            .value as Connection["movieProvider"],
                        })
                      }
                    >
                      <option value="tpdb">TPDB</option>
                      <option value="tmdb">TMDB</option>
                      <option value="none">Scenes only</option>
                    </select>
                  </label>
                </div>
                <label className="mt-3 flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="default-scene-connection"
                    className="check"
                    checked={c.sceneDefault}
                    onChange={() =>
                      setConnections((cs) =>
                        cs.map((x, j) => ({ ...x, sceneDefault: j === i })),
                      )
                    }
                  />
                  Default for scenes
                </label>
                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  {(["delivery", "sceneDelivery"] as const).map((key) => {
                    const delivery =
                      c[key] ??
                      defaultDelivery(
                        key === "delivery" ? "/data/movies" : "/data/scenes",
                      );
                    const update = (value: Partial<WhisparrDelivery>) =>
                      patch(i, { [key]: { ...delivery, ...value } });
                    return (
                      <fieldset key={key} className="space-y-2">
                        <legend className="font-semibold">
                          {key === "delivery" ? "Movies" : "Scenes"}
                        </legend>
                        <label className="flex items-center gap-2 text-sm">
                          <input
                            className="check"
                            type="checkbox"
                            checked={delivery.enabled}
                            onChange={(e) =>
                              update({ enabled: e.target.checked })
                            }
                          />
                          Enable delivery
                        </label>
                        <label className="label">
                          Root folder
                          <input
                            className="input"
                            list={`roots-${i}`}
                            value={delivery.rootFolderPath}
                            onChange={(e) =>
                              update({ rootFolderPath: e.target.value })
                            }
                          />
                        </label>
                        <label className="label">
                          Quality profile
                          {checked?.profiles?.length ? (
                            <select
                              className="input"
                              value={delivery.qualityProfileId}
                              onChange={(event) =>
                                update({
                                  qualityProfileId: Number(event.target.value),
                                })
                              }
                            >
                              {!checked.profiles.some(
                                (profile) =>
                                  profile.id === delivery.qualityProfileId,
                              ) && (
                                <option value={delivery.qualityProfileId}>
                                  Saved profile #{delivery.qualityProfileId}
                                </option>
                              )}
                              {checked.profiles.map((profile) => (
                                <option key={profile.id} value={profile.id}>
                                  {profile.name}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <input
                              className="input"
                              type="number"
                              min={1}
                              value={delivery.qualityProfileId}
                              onChange={(event) =>
                                update({
                                  qualityProfileId: Number(event.target.value),
                                })
                              }
                            />
                          )}
                        </label>
                        <label className="flex items-center gap-2 text-sm">
                          <input
                            className="check"
                            type="checkbox"
                            checked={delivery.searchOnAdd}
                            onChange={(e) =>
                              update({ searchOnAdd: e.target.checked })
                            }
                          />
                          Search on add
                        </label>
                      </fieldset>
                    );
                  })}
                </div>
                <datalist id={`roots-${i}`}>
                  {checked?.rootFolders?.map((r) => (
                    <option key={r.id} value={r.path} />
                  ))}
                </datalist>
                <p className="mt-4 text-sm text-muted">
                  Path mappings use the paths Jellyfin reports. Configure them
                  separately even when both Whisparr containers use /data/movies
                  and /data/scenes.
                </p>
                {(c.pathMappings ?? []).map((m, j) => (
                  <div key={j} className="mt-2 flex flex-wrap gap-2">
                    <label className="label flex-1">
                      Whisparr prefix
                      <input
                        className="input"
                        value={m.whisparrPrefix}
                        onChange={(e) =>
                          patch(i, {
                            pathMappings: c.pathMappings!.map((x, n) =>
                              n === j
                                ? { ...x, whisparrPrefix: e.target.value }
                                : x,
                            ),
                          })
                        }
                      />
                    </label>
                    <label className="label flex-1">
                      Jellyfin prefix
                      <input
                        className="input"
                        value={m.jellyfinPrefix}
                        onChange={(e) =>
                          patch(i, {
                            pathMappings: c.pathMappings!.map((x, n) =>
                              n === j
                                ? { ...x, jellyfinPrefix: e.target.value }
                                : x,
                            ),
                          })
                        }
                      />
                    </label>
                    <button
                      className="btn"
                      onClick={() =>
                        patch(i, {
                          pathMappings: c.pathMappings!.filter(
                            (_, n) => n !== j,
                          ),
                        })
                      }
                    >
                      Remove mapping
                    </button>
                  </div>
                ))}
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    className="btn"
                    onClick={() =>
                      patch(i, {
                        pathMappings: [
                          ...(c.pathMappings ?? []),
                          { whisparrPrefix: "", jellyfinPrefix: "" },
                        ],
                      })
                    }
                  >
                    Add mapping
                  </button>
                  <button
                    className="btn"
                    disabled={!c.instanceId}
                    onClick={() => void check(c)}
                  >
                    Check saved connection
                  </button>
                  <button
                    className="btn"
                    onClick={() =>
                      setConnections((cs) => cs.filter((_, j) => j !== i))
                    }
                  >
                    Remove connection
                  </button>
                </div>
                {checked && (
                  <p className="mt-2 text-sm text-muted">
                    Whisparr {checked.version} · Profiles:{" "}
                    {checked.profiles
                      ?.map((p) => `${p.name} (#${p.id})`)
                      .join(", ")}
                  </p>
                )}
              </fieldset>
            </section>
          );
        })}
        <div className="flex flex-wrap gap-2">
          <button
            className="btn"
            disabled={!ready || pending || connections.length >= 8}
            onClick={() => {
              setEditingIndex(connections.length);
              setConnections((cs) => [
                ...cs,
                {
                  name:
                    cs.length === 0
                      ? "Main"
                      : cs.length === 1
                        ? "Alternate"
                        : "Instance " + (cs.length + 1),
                  url: "",
                  apiKey: "",
                  movieProvider: cs.some((c) => c.movieProvider === "tpdb")
                    ? "tmdb"
                    : "tpdb",
                  sceneDefault: cs.length === 0,
                  delivery: defaultDelivery("/data/movies"),
                  sceneDelivery: defaultDelivery("/data/scenes"),
                  pathMappings: [],
                },
              ]);
            }}
          >
            Add instance
          </button>
          <button
            className="btn btn-accent"
            disabled={pending}
            onClick={() => void save()}
          >
            {pending ? "Working…" : "Save connections"}
          </button>
        </div>
      </div>
      {message && (
        <p className="mt-3 text-sm" role="status">
          {message}
        </p>
      )}
    </section>
  );
}
