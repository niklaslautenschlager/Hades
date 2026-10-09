import { describe, expect, it } from "vitest";
import { THEMES, THEME_GROUPS, THEME_STORAGE_KEY } from "./themes";

// Vitest swaps `.css?raw` imports for an empty string and @types/node is not a
// dependency, so read the sources through a dynamically imported `node:fs`.
const nodeFs = "node:fs";
const { readFileSync } = (await import(/* @vite-ignore */ nodeFs)) as {
  readFileSync(path: URL, encoding: "utf8"): string;
};
const read = (relative: string) => readFileSync(new URL(relative, import.meta.url), "utf8");

const globalsCss = read("../styles/globals.css");
const storeSource = read("../store/useStore.ts");
const appSource = read("../App.tsx");
const indexHtml = read("../../index.html");

// ─── CSS parsing ────────────────────────────────────────────────────────────

interface Rule {
  selectors: string[];
  decls: Map<string, string>;
}

function parseRules(css: string): Rule[] {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const rules: Rule[] = [];
  for (const m of stripped.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = m[1]
      .split(",")
      .map((s) => s.trim().replace(/\s+/g, " "))
      .filter(Boolean);
    const decls = new Map<string, string>();
    for (const d of m[2].split(";")) {
      const i = d.indexOf(":");
      if (i > 0) decls.set(d.slice(0, i).trim(), d.slice(i + 1).trim());
    }
    rules.push({ selectors, decls });
  }
  return rules;
}

const RULES = parseRules(globalsCss);

/** The default theme lives under `:root, [data-theme="dark"]`; every other theme under its own selector. */
function tokenBlocks(id: string): Rule[] {
  return RULES.filter((r) => r.selectors.includes(`[data-theme="${id}"]`));
}

function tokens(id: string): Map<string, string> {
  return tokenBlocks(id)[0]?.decls ?? new Map();
}

const REQUIRED_TOKENS = [
  "--color-surface",
  "--color-surface-hover",
  "--color-surface-elevated",
  "--color-foreground",
  "--color-foreground-secondary",
  "--color-muted",
  "--color-border",
  "--color-border-active",
  "--color-grid",
  "--color-card",
  "--color-card-hover",
  "--color-input",
  "--color-input-border",
  "--scrollbar-thumb",
  "--scrollbar-hover",
  "--selection",
  "--heatmap-low",
  "--heatmap-mid",
  "--heatmap-high",
  "--heatmap-max",
  "--accent",
  "--accent-2",
  "--accent-contrast",
  "--accent-glow",
  "--accent-soft",
];

// ─── WCAG contrast ──────────────────────────────────────────────────────────

function rgb(hex: string): [number, number, number] {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) throw new Error(`expected an opaque hex colour, got "${hex}"`);
  const h = m[1].length === 3 ? m[1].replace(/./g, (c) => c + c) : m[1];
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

function ratio(id: string, fg: string, bg: string): number {
  const t = tokens(id);
  return contrast(t.get(fg) ?? "", t.get(bg) ?? "");
}

const NEW_IDS = ["mono", "bluepaper", "honey", "pastel"];
const NEW_THEMES = THEMES.filter((t) => NEW_IDS.includes(t.id));
const LIGHT_IDS = THEMES.filter((t) => t.scheme === "light").map((t) => t.id);
const DARK_IDS = THEMES.filter((t) => t.scheme === "dark").map((t) => t.id);

// ─── Registry ───────────────────────────────────────────────────────────────

describe("theme registry", () => {
  it("has 22 themes with unique ids and labels", () => {
    expect(THEMES).toHaveLength(22);
    expect(new Set(THEMES.map((t) => t.id)).size).toBe(THEMES.length);
    expect(new Set(THEMES.map((t) => t.label)).size).toBe(THEMES.length);
  });

  it("registers the four new light themes under the expected ids and labels", () => {
    const byId = Object.fromEntries(THEMES.map((t) => [t.id, t]));
    expect(byId.mono).toMatchObject({ label: "Monochrome", scheme: "light" });
    expect(byId.bluepaper).toMatchObject({ label: "Blue & Paper", scheme: "light" });
    expect(byId.honey).toMatchObject({ label: "Honeyed Naturals", scheme: "light" });
    expect(byId.pastel).toMatchObject({ label: "Pastel", scheme: "light" });
  });

  it("puts every theme in a known group and leaves no group empty", () => {
    for (const t of THEMES) expect(THEME_GROUPS, t.id).toContain(t.group);
    for (const g of THEME_GROUPS) expect(THEMES.some((t) => t.group === g), g).toBe(true);
    expect(new Set(THEME_GROUPS).size).toBe(THEME_GROUPS.length);
  });

  it("gives every theme a non-empty description", () => {
    for (const t of THEMES) expect(t.description.trim().length, t.id).toBeGreaterThan(0);
  });

  it("keeps the Theme union in useStore.ts in sync with THEMES", () => {
    const m = /export type Theme =([^;]+);/.exec(storeSource);
    expect(m).not.toBeNull();
    const union = [...m![1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
    expect([...union].sort()).toEqual(THEMES.map((t) => t.id).sort());
  });

  it("uses a swatch that matches the theme's own surface and accents", () => {
    for (const t of THEMES) {
      const tk = tokens(t.id);
      expect(t.swatch.map((c) => c.toLowerCase()), t.id).toEqual([
        tk.get("--color-surface")?.toLowerCase(),
        tk.get("--accent")?.toLowerCase(),
        tk.get("--accent-2")?.toLowerCase(),
      ]);
    }
  });
});

// ─── Per-theme CSS ──────────────────────────────────────────────────────────

describe.each(THEMES.map((t) => [t.id, t] as const))("theme %s", (id, meta) => {
  it("is declared by exactly one [data-theme] block", () => {
    expect(tokenBlocks(id)).toHaveLength(1);
  });

  it("defines every required token", () => {
    const tk = tokens(id);
    const missing = REQUIRED_TOKENS.filter((name) => !tk.get(name));
    expect(missing).toEqual([]);
  });

  it("declares a color-scheme matching its ThemeMeta.scheme", () => {
    const scheme = tokens(id).get("color-scheme");
    if (meta.scheme === "light") {
      expect(scheme).toBe("light");
    } else {
      // Dark is the inherited default (:root), so dark themes may omit it.
      expect(scheme === undefined || scheme === "dark").toBe(true);
    }
  });

  it("changes colour tokens only, so switching themes cannot shift layout", () => {
    const offenders = [...tokens(id).keys()].filter((k) => !k.startsWith("--") && k !== "color-scheme");
    expect(offenders).toEqual([]);
  });

  it("keeps body text readable (foreground on surface >= 4.5:1)", () => {
    expect(ratio(id, "--color-foreground", "--color-surface")).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps accent fills legible (accent-contrast on accent never below 2.5:1)", () => {
    // Older light themes (solarized-light, rosepine-dawn) sit just under 3:1; the
    // new themes are held to the stricter 3:1 below.
    expect(ratio(id, "--accent-contrast", "--accent")).toBeGreaterThanOrEqual(2.5);
  });
});

describe("default (dark) theme", () => {
  it("is declared on :root so every theme inherits it", () => {
    const block = tokenBlocks("dark")[0];
    expect(block.selectors).toContain(":root");
    expect(block.decls.get("color-scheme")).toBe("dark");
  });
});

describe("new light themes: legibility", () => {
  it("monochrome text is high contrast (foreground on surface >= 7:1)", () => {
    expect(ratio("mono", "--color-foreground", "--color-surface")).toBeGreaterThanOrEqual(7);
  });

  it.each(NEW_THEMES.map((t) => [t.id] as const))("%s: secondary text, muted text and cards stay readable", (id) => {
    expect(ratio(id, "--color-foreground-secondary", "--color-surface")).toBeGreaterThanOrEqual(4.5);
    expect(ratio(id, "--color-foreground", "--color-card")).toBeGreaterThanOrEqual(4.5);
    expect(ratio(id, "--color-foreground", "--color-surface-elevated")).toBeGreaterThanOrEqual(4.5);
    expect(ratio(id, "--color-foreground-secondary", "--color-surface-elevated")).toBeGreaterThanOrEqual(4.5);
    expect(ratio(id, "--color-muted", "--color-surface")).toBeGreaterThanOrEqual(4.5);
  });

  it.each(NEW_THEMES.map((t) => [t.id] as const))("%s: accents are visible and carry readable button text", (id) => {
    expect(ratio(id, "--accent-contrast", "--accent")).toBeGreaterThanOrEqual(3);
    expect(ratio(id, "--accent-contrast", "--accent-2")).toBeGreaterThanOrEqual(3);
    expect(ratio(id, "--accent", "--color-surface")).toBeGreaterThanOrEqual(3);
    expect(ratio(id, "--accent", "--color-card")).toBeGreaterThanOrEqual(3);
  });

  it("monochrome is greyscale: every opaque colour token has equal r, g and b", () => {
    for (const [name, value] of tokens("mono")) {
      if (!/^#[0-9a-f]{6}$/i.test(value)) continue;
      const [r, g, b] = rgb(value);
      expect([name, r === g && g === b]).toEqual([name, true]);
    }
  });

  it("heatmap ramps keep four distinct steps", () => {
    for (const { id } of NEW_THEMES) {
      const tk = tokens(id);
      const steps = ["--heatmap-low", "--heatmap-mid", "--heatmap-high", "--heatmap-max"].map((n) => tk.get(n));
      expect(new Set(steps).size, id).toBe(4);
    }
  });
});

// ─── Scheme-scoped rules ────────────────────────────────────────────────────

describe("scheme-scoped CSS rules", () => {
  // Group every `[data-theme="x"] <tail>` selector by its tail and collect the
  // themes it names across all rules, so a rule split in two still counts.
  const byTail = new Map<string, Set<string>>();
  const scopedDecls = new Map<string, string[]>();
  for (const rule of RULES) {
    for (const sel of rule.selectors) {
      const m = /^\[data-theme="([^"]+)"\] (.+)$/.exec(sel);
      if (!m) continue;
      if (!byTail.has(m[2])) byTail.set(m[2], new Set());
      byTail.get(m[2])!.add(m[1]);
      scopedDecls.set(m[2], [...(scopedDecls.get(m[2]) ?? []), ...rule.decls.keys()]);
    }
  }

  it("finds the note-link overrides (guards against the parser silently matching nothing)", () => {
    expect([...byTail.keys()]).toEqual(
      expect.arrayContaining([".markdown-body .note-link", ".markdown-body .note-link:hover"])
    );
  });

  it("applies each scoped rule to every theme of one scheme, never a subset", () => {
    const light = [...LIGHT_IDS].sort();
    const dark = [...DARK_IDS].sort();
    for (const [tail, ids] of byTail) {
      const got = [...ids].sort();
      const ok = JSON.stringify(got) === JSON.stringify(light) || JSON.stringify(got) === JSON.stringify(dark);
      expect({ tail, ids: got, ok }).toEqual({ tail, ids: got, ok: true });
    }
  });

  it("covers all seven light themes with the note-link override", () => {
    expect(LIGHT_IDS).toHaveLength(7);
    for (const tail of [".markdown-body .note-link", ".markdown-body .note-link:hover"]) {
      expect([...(byTail.get(tail) ?? [])].sort()).toEqual([...LIGHT_IDS].sort());
    }
  });

  it("scoped rules only touch colours", () => {
    for (const [tail, props] of scopedDecls) {
      for (const p of props) expect({ tail, p, ok: /color|background|shadow/.test(p) }).toEqual({ tail, p, ok: true });
    }
  });

  it("keeps the light-theme status text colours readable on every light surface and card", () => {
    const status = RULES.filter((r) =>
      r.selectors.some((s) => /^\[data-theme="mono"\] \.text-[a-z]+-\d{3}(\\\/\d+)?$/.test(s))
    );
    expect(status.length).toBeGreaterThanOrEqual(10);
    for (const rule of status) {
      const color = rule.decls.get("color") ?? "";
      if (!color.startsWith("#")) continue;
      for (const id of LIGHT_IDS) {
        for (const token of ["--color-surface", "--color-card"]) {
          const bgColor = tokens(id).get(token) ?? "";
          const ok = contrast(color, bgColor) >= 4.5;
          expect({ sel: rule.selectors[0], id, token, ok }).toEqual({ sel: rule.selectors[0], id, token, ok: true });
        }
      }
    }
  });

  it("keeps the light-theme link colour readable on every light surface", () => {
    const link = RULES.find((r) => r.selectors.includes('[data-theme="mono"] .markdown-body .note-link'));
    const color = link?.decls.get("color") ?? "";
    for (const id of LIGHT_IDS) {
      const surface = tokens(id).get("--color-surface") ?? "";
      expect({ id, ratio: contrast(color, surface) >= 4.5 }).toEqual({ id, ratio: true });
    }
  });
});

// ─── First-paint theme (index.html + App.tsx) ───────────────────────────────

describe("first-paint theme script", () => {
  const scriptBody = (() => {
    for (const m of indexHtml.matchAll(/<script>([\s\S]*?)<\/script>/g)) {
      if (m[1].includes("getItem")) return m[1];
    }
    return "";
  })();

  function run(stored: string | null | "throw") {
    const attrs: Record<string, string> = {};
    const reads: string[] = [];
    const localStorage = {
      getItem(key: string) {
        reads.push(key);
        if (stored === "throw") throw new Error("SecurityError");
        return stored;
      },
    };
    const document = {
      documentElement: {
        setAttribute(name: string, value: string) {
          attrs[name] = value;
        },
      },
    };
    new Function("localStorage", "document", scriptBody)(localStorage, document);
    return { attrs, reads };
  }

  it("exists and runs before the stylesheet and the app bundle", () => {
    expect(scriptBody).not.toBe("");
    const at = indexHtml.indexOf(scriptBody);
    expect(at).toBeLessThan(indexHtml.indexOf('src="/src/main.tsx"'));
    expect(at).toBeLessThan(indexHtml.indexOf('rel="stylesheet"'));
  });

  it("reads the same storage key that App.tsx writes", () => {
    expect(run(null).reads).toEqual([THEME_STORAGE_KEY]);
    expect(appSource).toMatch(/try\s*\{\s*localStorage\.setItem\(THEME_STORAGE_KEY,\s*theme\);\s*\}\s*catch/);
  });

  it.each(THEMES.map((t) => [t.id] as const))("applies the stored id %s", (id) => {
    expect(run(id).attrs).toEqual({ "data-theme": id });
  });

  it("whitelists exactly the registered theme ids", () => {
    const m = /\/\^\(([^)]+)\)\$\//.exec(scriptBody);
    expect(m).not.toBeNull();
    expect(m![1].split("|").sort()).toEqual(THEMES.map((t) => t.id).sort());
  });

  it.each([
    ["nothing stored", null],
    ["an empty string", ""],
    ["an unknown id", "neon-pink"],
    ["a prefix of a real id", "mon"],
    ["a real id with extra text", "mono2"],
    ["a different case", "Mono"],
    ["markup", '"><script>alert(1)</script>'],
  ])("leaves the default theme alone for %s", (_label, stored) => {
    expect(run(stored).attrs).toEqual({});
  });

  it("swallows storage errors and never writes to the console", () => {
    expect(() => run("throw")).not.toThrow();
    expect(run("throw").attrs).toEqual({});
    expect(scriptBody).not.toMatch(/console\./);
  });
});
