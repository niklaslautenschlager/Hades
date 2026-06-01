import type { Theme } from "../store/useStore";

export type ThemeGroup = "Core" | "Popular" | "Light & Classic" | "Hades Originals";

export interface ThemeMeta {
  id: Theme;
  label: string;
  description: string;
  group: ThemeGroup;
  /** Swatch order: [surface, accent, accent-2] — used for previews. */
  swatch: [string, string, string];
}

export const THEMES: ThemeMeta[] = [
  // ── Core ──────────────────────────────────────────────────────────
  { id: "dark",        label: "Zinc Dark",  description: "Indigo-violet on graphite", group: "Core",          swatch: ["#09090b", "#818cf8", "#c084fc"] },
  { id: "light",       label: "Paper",      description: "Warm amber on paper",        group: "Core",          swatch: ["#faf8f1", "#ea580c", "#f59e0b"] },
  { id: "catppuccin",  label: "Catppuccin", description: "Mocha — mauve & blue",       group: "Core",          swatch: ["#1e1e2e", "#cba6f7", "#89b4fa"] },
  { id: "gruvbox",     label: "Gruvbox",    description: "Retro warm earth",           group: "Core",          swatch: ["#282828", "#fabd2f", "#fe8019"] },
  { id: "nord",        label: "Nord",       description: "Cool arctic blues",          group: "Core",          swatch: ["#2e3440", "#88c0d0", "#81a1c1"] },

  // ── Popular ───────────────────────────────────────────────────────
  { id: "tokyonight",  label: "Tokyo Night", description: "Neon city blues",           group: "Popular",       swatch: ["#1a1b26", "#7aa2f7", "#bb9af7"] },
  { id: "dracula",     label: "Dracula",     description: "Purple & pink classic",     group: "Popular",       swatch: ["#282a36", "#bd93f9", "#ff79c6"] },
  { id: "onedark",     label: "One Dark",    description: "Atom's signature",          group: "Popular",       swatch: ["#282c34", "#61afef", "#c678dd"] },
  { id: "monokai",     label: "Monokai Pro", description: "Lime & magenta pop",        group: "Popular",       swatch: ["#2d2a2e", "#a9dc76", "#ff6188"] },
  { id: "rosepine",    label: "Rosé Pine",   description: "Soho-vibes rose & iris",    group: "Popular",       swatch: ["#191724", "#ebbcba", "#c4a7e7"] },

  // ── Light & Classic ───────────────────────────────────────────────
  { id: "solarized",       label: "Solarized Dark",  description: "Precision teal & blue",  group: "Light & Classic", swatch: ["#002b36", "#268bd2", "#2aa198"] },
  { id: "solarized-light", label: "Solarized Light", description: "Easy sepia daylight",    group: "Light & Classic", swatch: ["#fdf6e3", "#b58900", "#cb4b16"] },
  { id: "everforest",      label: "Everforest",      description: "Soft forest greens",     group: "Light & Classic", swatch: ["#2d353b", "#a7c080", "#7fbbb3"] },
  { id: "rosepine-dawn",   label: "Rosé Pine Dawn",  description: "Rosé Pine, in daylight",  group: "Light & Classic", swatch: ["#faf4ed", "#d7827e", "#907aa9"] },

  // ── Hades Originals ───────────────────────────────────────────────
  { id: "ember",      label: "Ember",     description: "Volcanic red on char",  group: "Hades Originals", swatch: ["#0d0807", "#ff5722", "#ff9100"] },
  { id: "abyss",      label: "Abyss",     description: "Deep-ocean teal glow",  group: "Hades Originals", swatch: ["#0a141f", "#2dd4bf", "#38bdf8"] },
  { id: "synthwave",  label: "Synthwave", description: "Neon magenta & cyan",   group: "Hades Originals", swatch: ["#1a0b2e", "#ff2e97", "#00e5ff"] },
  { id: "matrix",     label: "Matrix",    description: "Phosphor terminal green", group: "Hades Originals", swatch: ["#0a0e0a", "#00ff66", "#7cfc00"] },
];

export const THEME_GROUPS: ThemeGroup[] = ["Core", "Popular", "Light & Classic", "Hades Originals"];

const THEME_BY_ID: Record<Theme, ThemeMeta> = Object.fromEntries(
  THEMES.map((t) => [t.id, t])
) as Record<Theme, ThemeMeta>;

export function themeMeta(id: Theme): ThemeMeta {
  return THEME_BY_ID[id] ?? THEMES[0];
}
