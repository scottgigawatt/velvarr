// Connection selection is separate from metadata and delivery transport.
import type {
  IntegrationConfig,
  MediaReference,
  WhisparrConnection,
} from "../lib/contracts.ts";
import { AppError } from "./http.ts";

/** Upgrade view only: legacy storage and its logical identity remain intact. */
export function whisparrConnections(
  config: IntegrationConfig | null,
): WhisparrConnection[] {
  if (!config) return [];
  if (config.whisparrInstances !== undefined) return config.whisparrInstances;
  return config.whisparr
    ? [
        {
          ...config.whisparr,
          name: "Main",
          movieProvider: "tpdb",
          sceneDefault: true,
          sceneDelivery: config.whisparr.delivery,
        },
      ]
    : [];
}

export function whisparrTarget(
  config: IntegrationConfig | null,
  media: MediaReference,
  instanceId?: string,
): WhisparrConnection | undefined {
  const connections = whisparrConnections(config);
  if (instanceId !== undefined)
    return connections.find((c) => c.instanceId === instanceId);
  return connections.find((c) =>
    media.kind === "scene"
      ? c.sceneDefault
      : c.movieProvider === media.provider,
  );
}

/** Project one endpoint and one kind's root/profile into the existing transport. */
export function targetConfig(
  config: IntegrationConfig,
  media: MediaReference,
  instanceId?: string,
): IntegrationConfig {
  if (config.whisparrInstances === undefined) return config;
  const target = whisparrTarget(config, media, instanceId);
  if (!target)
    throw new AppError(
      409,
      "target_not_configured",
      "No Whisparr connection is configured for this request.",
    );
  return {
    ...config,
    whisparrInstances: undefined,
    whisparr: {
      ...target,
      delivery: media.kind === "scene" ? target.sceneDelivery : target.delivery,
    },
  };
}
