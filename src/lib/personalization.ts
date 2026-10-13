// Validated account settings for discovery and presentation.
import type {
  AppearancePreferences,
  CatalogTagSelection,
} from "./contracts.ts";
export const APPEARANCE_PRESETS = [
  {
    id: "velvet",
    name: "Velvet",
    accent: "#ef3483",
    hue: 325,
    description: "Plum and marquee pink",
  },
  {
    id: "ocean",
    name: "Midnight ocean",
    accent: "#5b9eff",
    hue: 255,
    description: "Deep navy and clear blue",
  },
  {
    id: "forest",
    name: "Emerald",
    accent: "#4dd4a8",
    hue: 165,
    description: "Forest tones and fresh mint",
  },
  {
    id: "amber",
    name: "Golden hour",
    accent: "#f2b854",
    hue: 65,
    description: "Warm charcoal and amber",
  },
  {
    id: "violet",
    name: "Amethyst",
    accent: "#b28aff",
    hue: 290,
    description: "Indigo and soft violet",
  },
] as const;
export const DEFAULT_APPEARANCE: AppearancePreferences = {
  mode: "dark",
  preset: "velvet",
  accent: "#ef3483",
};
export type PersonalSettings = {
  includeTags: CatalogTagSelection[];
  applyIncludeTags: boolean;
  personalizeDiscover: boolean;
  browseRowLimit: number;
  appearance: AppearancePreferences;
};
export function defaultPersonalSettings(): PersonalSettings {
  return {
    includeTags: [],
    applyIncludeTags: true,
    personalizeDiscover: true,
    browseRowLimit: 50,
    appearance: { ...DEFAULT_APPEARANCE },
  };
}
/** Colors are bounded hex values, never arbitrary CSS. */
export function parsePersonalSettings(
  raw: Record<string, unknown>,
): Omit<PersonalSettings, "includeTags"> {
  const defaults = defaultPersonalSettings();
  for (const key of ["applyIncludeTags", "personalizeDiscover"]) {
    if (raw[key] !== undefined && typeof raw[key] !== "boolean")
      throw new TypeError(key + " must be a boolean");
  }
  const limit =
    raw.browseRowLimit === undefined
      ? defaults.browseRowLimit
      : raw.browseRowLimit;
  if (
    typeof limit !== "number" ||
    !Number.isInteger(limit) ||
    limit < 10 ||
    limit > 100
  ) {
    throw new TypeError(
      "Results per row must be a whole number from 10 to 100",
    );
  }
  const value =
    raw.appearance === undefined ? defaults.appearance : raw.appearance;
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new TypeError("Invalid appearance");
  const a = value as Record<string, unknown>;
  if (
    Object.keys(a).some((key) => !["mode", "preset", "accent"].includes(key)) ||
    !["dark", "light", "system"].includes(String(a.mode)) ||
    ![...APPEARANCE_PRESETS.map((preset) => preset.id), "custom"].includes(
      String(a.preset),
    ) ||
    typeof a.accent !== "string" ||
    !/^#[0-9a-f]{6}$/i.test(a.accent)
  ) {
    throw new TypeError(
      "Choose a valid appearance preset, mode, and hex color",
    );
  }
  return {
    applyIncludeTags: (raw.applyIncludeTags ??
      defaults.applyIncludeTags) as boolean,
    personalizeDiscover: (raw.personalizeDiscover ??
      defaults.personalizeDiscover) as boolean,
    browseRowLimit: limit,
    appearance: {
      mode: a.mode,
      preset: a.preset,
      accent: a.accent.toLowerCase(),
    } as AppearancePreferences,
  };
}
