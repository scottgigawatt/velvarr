"use client";
import { useEffect, useState } from "react";
import type {
  AppearancePreferences,
  ContentPreferences,
} from "../lib/contracts.ts";
import {
  APPEARANCE_PRESETS,
  DEFAULT_APPEARANCE,
} from "../lib/personalization.ts";
import { api, messageOf, PREFERENCES_CHANGED, useApiGet } from "./shared.tsx";

/** A bounded palette keeps custom accent colors readable in either color mode. */
export function applyAppearance(appearance: AppearancePreferences) {
  const root = document.documentElement;
  const dark =
    appearance.mode === "dark" ||
    (appearance.mode === "system" &&
      matchMedia("(prefers-color-scheme: dark)").matches);
  const preset = APPEARANCE_PRESETS.find(
    (entry) => entry.id === appearance.preset,
  );
  const hue = preset?.hue ?? 325;
  const accent =
    appearance.preset === "custom"
      ? appearance.accent
      : (preset?.accent ?? "#ef3483");
  const channels = [1, 3, 5].map(
    (offset) => Number.parseInt(accent.slice(offset, offset + 2), 16) / 255,
  );
  const luminance = channels
    .map((channel) =>
      channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
    )
    .reduce(
      (total, channel, index) =>
        total + channel * [0.2126, 0.7152, 0.0722][index]!,
      0,
    );
  const colors: Record<string, string> = {
    canvas: dark
      ? "oklch(17% 0.022 " + hue + ")"
      : "oklch(97% 0.009 " + hue + ")",
    panel: dark ? "oklch(22.5% 0.028 " + hue + ")" : "oklch(100% 0 0)",
    raised: dark
      ? "oklch(27.5% 0.034 " + hue + ")"
      : "oklch(94% 0.015 " + hue + ")",
    edge: dark ? "oklch(38% 0.04 " + hue + ")" : "oklch(81% 0.024 " + hue + ")",
    ink: dark
      ? "oklch(96.5% 0.006 " + hue + ")"
      : "oklch(22% 0.025 " + hue + ")",
    muted: dark
      ? "oklch(80% 0.022 " + hue + ")"
      : "oklch(43% 0.03 " + hue + ")",
    accent,
    "accent-hover":
      "color-mix(in srgb, " +
      accent +
      " 82%, " +
      (dark ? "white" : "black") +
      ")",
    "accent-ink": luminance > 0.179 ? "#101014" : "#ffffff",
    "accent-text":
      "color-mix(in srgb, " +
      accent +
      " 55%, " +
      (dark ? "white" : "black") +
      ")",
    "accent-soft":
      "color-mix(in srgb, " +
      accent +
      " 18%, " +
      (dark ? "#17131d" : "white") +
      ")",
    ok: dark ? "oklch(86% 0.14 159.2)" : "oklch(42% 0.11 159.2)",
    danger: dark ? "oklch(80% 0.14 30)" : "oklch(45% 0.17 30)",
    info: dark ? "oklch(80% 0.12 250)" : "oklch(42% 0.14 250)",
  };
  for (const [name, value] of Object.entries(colors))
    root.style.setProperty("--color-" + name, value);
  root.style.colorScheme = dark ? "dark" : "light";
}

/** Account-scoped appearance follows preference saves and system theme changes. */
export function AppearanceSync() {
  const preferences = useApiGet<ContentPreferences>("/api/me/preferences", []);
  useEffect(() => {
    window.addEventListener(PREFERENCES_CHANGED, preferences.reload);
    return () =>
      window.removeEventListener(PREFERENCES_CHANGED, preferences.reload);
  }, [preferences.reload]);
  useEffect(() => {
    const appearance = preferences.data?.appearance ?? DEFAULT_APPEARANCE;
    const update = () => applyAppearance(appearance);
    update();
    const media = matchMedia("(prefers-color-scheme: dark)");
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [preferences.data?.appearance]);
  useEffect(() => () => applyAppearance(DEFAULT_APPEARANCE), []);
  return null;
}

export function AppearanceView({ embedded = false }: { embedded?: boolean }) {
  const preferences = useApiGet<ContentPreferences>("/api/me/preferences", [], {
    fresh: true,
  });
  const [draft, setDraft] = useState<AppearancePreferences | null>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const current = draft ?? preferences.data?.appearance ?? DEFAULT_APPEARANCE;
  const choose = async (next: AppearancePreferences) => {
    setDraft(next);
    setPending(true);
    setMessage(null);
    applyAppearance(next);
    try {
      await api("/api/me/preferences", {
        method: "PATCH",
        body: JSON.stringify({ appearance: next }),
      });
      preferences.reload();
      window.dispatchEvent(new Event(PREFERENCES_CHANGED));
      setMessage("Appearance saved.");
    } catch (error) {
      const previous = preferences.data?.appearance ?? DEFAULT_APPEARANCE;
      setDraft(previous);
      applyAppearance(previous);
      setMessage(messageOf(error));
    } finally {
      setPending(false);
    }
  };
  return (
    <section className="appearance-page" aria-label="Appearance">
      {!embedded && (
        <header className="page-heading">
          <div>
            <h1 className="page-title">Appearance</h1>
            <p className="page-description">
              A color palette that feels like you.
            </p>
          </div>
        </header>
      )}
      <section className="settings-group">
        <h2>Color mode</h2>
        <p className="field-help">
          Choose your preferred canvas, or follow your device.
        </p>
        <div className="theme-modes" role="group" aria-label="Color mode">
          {(["dark", "light", "system"] as const).map((mode) => (
            <button
              className={"btn " + (current.mode === mode ? "btn-accent" : "")}
              key={mode}
              aria-pressed={current.mode === mode}
              disabled={pending || !preferences.data}
              onClick={() => void choose({ ...current, mode })}
            >
              {mode[0]!.toUpperCase() + mode.slice(1)}
            </button>
          ))}
        </div>
      </section>
      <section className="settings-group">
        <h2>Palette</h2>
        <p className="field-help">
          Choose a preset or make your own. Your preference follows your
          account.
        </p>
        <div className="palette-grid">
          {APPEARANCE_PRESETS.map((preset) => (
            <button
              key={preset.id}
              className={
                "palette-option " +
                (current.preset === preset.id ? "is-selected" : "")
              }
              aria-pressed={current.preset === preset.id}
              disabled={pending || !preferences.data}
              onClick={() =>
                void choose({
                  ...current,
                  preset: preset.id,
                  accent: preset.accent,
                })
              }
            >
              <span
                className="palette-preview"
                style={{ background: "oklch(20% 0.035 " + preset.hue + ")" }}
              >
                <span style={{ background: preset.accent }} />
                <span
                  style={{ background: "oklch(35% 0.05 " + preset.hue + ")" }}
                />
              </span>
              <strong>{preset.name}</strong>
              <span className="field-help">{preset.description}</span>
            </button>
          ))}
        </div>
        <label className="custom-color">
          Custom accent
          <input
            type="color"
            aria-label="Custom accent color"
            value={current.accent}
            disabled={pending || !preferences.data}
            onChange={(event) =>
              void choose({
                ...current,
                preset: "custom",
                accent: event.target.value,
              })
            }
          />
          <span className="connection-address">{current.accent}</span>
        </label>
        <p className="field-help" role="status">
          {message ?? preferences.error ?? (pending ? "Saving…" : "")}
        </p>
      </section>
    </section>
  );
}
