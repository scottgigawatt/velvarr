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
  const [editing, setEditing] = useState(false);
  const [ready, setReady] = useState(false);
  const [pending, setPending] = useState(false);
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
    setError(null);
    try {
      const data = await api<Status>(
        `/api/admin/whisparr/connections/${c.instanceId}`,
      );
      setStatus((s) => ({ ...s, [c.instanceId!]: data }));
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setPending(false);
    }
  };
  return (
    <div className="panel p-5">
      <h3 className="font-semibold">Whisparr connections</h3>
      <p className="mt-2 text-sm text-muted">
        Assign one connection to each movie provider. Scenes use the default
        connection unless staff chooses another before approval. Each connection
        has separate movie and scene roots; import and recycle folders remain
        managed by Whisparr.
      </p>
      {error && <ErrorPanel message={error} />}
      {!editing ? (
        <button
          className="btn mt-3"
          disabled={!ready}
          onClick={() => setEditing(true)}
        >
          Configure connections
        </button>
      ) : (
        <div className="mt-4 space-y-5">
          {connections.map((c, i) => {
            const checked = c.instanceId ? status[c.instanceId] : undefined;
            return (
              <fieldset
                key={i}
                className="rounded border border-edge p-4"
                disabled={pending}
              >
                <legend className="font-semibold">
                  {c.name || `Connection ${i + 1}`}
                </legend>
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
                          Quality profile ID
                          <input
                            className="input"
                            type="number"
                            min={1}
                            value={delivery.qualityProfileId}
                            onChange={(e) =>
                              update({
                                qualityProfileId: Number(e.target.value),
                              })
                            }
                          />
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
            );
          })}
          <div className="flex flex-wrap gap-2">
            <button
              className="btn"
              disabled={pending || connections.length >= 8}
              onClick={() =>
                setConnections((cs) => [
                  ...cs,
                  {
                    name: cs.length ? "Alternate" : "Main",
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
                ])
              }
            >
              Add connection
            </button>
            <button
              className="btn btn-accent"
              disabled={pending}
              onClick={() => void save()}
            >
              {pending ? "Saving…" : "Save connections"}
            </button>
          </div>
        </div>
      )}
      {message && (
        <p className="mt-3 text-sm" role="status">
          {message}
        </p>
      )}
    </div>
  );
}
