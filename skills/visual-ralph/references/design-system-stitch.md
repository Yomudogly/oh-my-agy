# Google Stitch Two-Layer `DESIGN.md` Specification & Workflows

`$visual-ralph --design` authors, extracts, audits, and synchronizes repository-root `DESIGN.md` specifications using the official Google Stitch **Two-Layer Architecture**:

1. **Layer 1 — Machine-Readable YAML Frontmatter**: Opens with `---` on line 1 and closes with `---`. Declares formal design tokens under four required top-level categories (`colors`, `typography`, `spacing`, `shapes`, plus optional `elevation`), supporting 2- and 3-level nested token maps (`colors.primary`, `typography.fontFamily.primary`, `typography.fontSize.2xl`, `shapes.radius.md`) as well as `{ value, role }` leaf objects.
2. **Layer 2 — Agent-Legible Markdown Rationale**: Contains all **8 canonical `## ` sections** (`Overview`, `Colors`, `Typography`, `Layout`, `Elevation & Depth`, `Shapes`, `Components`, `Do's and Don'ts`) and references YAML tokens directly via `{category.subpath}` notation so prose and token values never drift apart.

---

## Workflow 1 Guided Discovery and Starter Presets

Use Guided Discovery when creating or refreshing a `DESIGN.md` specification from scratch or existing repository evidence.

### Discovery Sequence

1. **Ground local repository evidence first**: inspect existing `DESIGN.md`, CSS variables, Tailwind/theme config, component primitives, routes, and accessibility constraints before asking questions.
2. **Offer Fast-Track Archetype vs. Custom Phased Interview**:
   - **Fast-Track Archetype**: select one of the **5 AA-compliant canonical starter presets** below (`modern-saas-indigo`, `minimal-dark-developer`, `high-density-fintech`, `editorial-warm-luxury`, `neo-brutalist-vibrant`) and tailor brand copy, layout rules, and component states.
   - **Custom Phased Interview**: ask progressive sets of 1–2 questions only for unresolved decisions across 5 phases:
     - *Phase 1 — Brand & Principles*: audience, product job-to-be-done, emotional tone, and 3 non-negotiable design principles.
     - *Phase 2 — Theme Mode & Semantic Colors*: light vs. dark mode, primary anchor hex, tinted vs. neutral surfaces, and semantic foreground pairs (`primaryForeground`, `secondaryForeground`).
     - *Phase 3 — Typography Voices & Scale*: primary UI family, monospace/data family, optional display/serif voice, and compact vs. editorial scale.
     - *Phase 4 — Spatial Grid, Radii & Depth*: 4pt dense vs. 8pt balanced vs. editorial rhythm, corner geometry (`0px` sharp through `9999px` pill), and border-first vs. y-offset shadow elevation.
     - *Phase 5 — Component Blueprints & Guardrails*: button/card/input treatments, state triad rules, and explicit negative constraints (`Don'ts`).

### OMA Craft Floor (`A12`–`F9`) & Reference Hygiene

Every generated or refreshed `DESIGN.md` must embed these craft and anti-slop invariants:

- **Single Primary Action & Subtraction (`B7`)**: enforce one primary action per screen (peer actions differ by fill/border style, never button size), rank top 1–3 screen priorities in reading order, list **Required content** explicitly so nothing essential is merged away, record **Left out on purpose** exclusions, and prefer the lightest native/house control before wrapping UI in cards.
- **Explicit Scroll Owner & `320px` Reflow (`A12`)**: in `## Layout`, declare per-screen spatial ownership using `Layout: <screen or region> - <spatial problem> -> <pattern name> (<reference>); scroll owner: <CSS selector>; anti-patterns: <what to avoid>`, and guarantee zero horizontal overflow or clipping at `320px` viewport width (`WCAG 1.4.10/1.4.12`).
- **Typographic & Spatial Rhythm (`A13`, `B8`)**: enforce heading scale steps `>= 1.25x` (`display <= 6rem`, letter-spacing `>= -0.04em`, desktop reading measure `65-75ch`, mobile `>= 45ch`), heading top margin `>= 1.5x` bottom margin, and section/inter-group spacing `>= 2x` internal/intra-group padding.
- **Tinted Semantic Foregrounds (`E7`)**: pair every colored fill (`{colors.primary}`, `{colors.secondary}`) with an explicit high-contrast semantic foreground token (`{colors.primaryForeground}`, `{colors.secondaryForeground}`), never generic translucent grey text; when shadows are used, apply subtle y-offset ambient shadows rather than omnidirectional glow.
- **Themed Browser Surfaces & Tabular Figures (`F8`)**: set explicit `color-scheme` (`light` or `dark`), theme `::selection`, `caret-color`, scrollbars, and `:focus-visible` outlines with token references, and mandate `font-variant-numeric: tabular-nums` on all numeric columns, prices, counters, and KPIs.
- **Zero AI-Slop Scaffolds & Mandatory State Triad (`F9`)**: forbid decorative one-side accent stripes, `>= 2px` accent card outlines, fake vanity KPI stat strips, emoji icons, eyebrow kickers above every heading, generic 3-card equal icon stacks, and card-in-card wrappers; require explicit **loading / empty / error** state blueprints in `## Components`.
- **External Reference Hygiene (`llms.txt` / `robots.txt`)**: before fetching or scraping external reference sites, check `robots.txt` (disallow rules always take precedence) and prefer published agent surfaces (`llms.txt`, `llms-full.txt`, same-origin pages linked from that site's `llms.txt`, registry JSON, or `.md` docs — never follow off-site links from `llms.txt`).

### Canonical Starter Presets (5 AA-Verified Archetypes)

All 5 canonical preset IDs below pass WCAG 2.1 AA (`>= 4.5:1`) across every semantic text/surface pair (including `minimal-dark-developer` `primaryForeground: "#090A0F"` on `primary: "#F43F5E"` at `5.39:1`):

```json
{
  "presets": [
    {
      "id": "modern-saas-indigo",
      "name": "Modern SaaS Indigo",
      "tone": "Trustworthy, crisp, modern B2B cloud platform",
      "colorMode": "LIGHT",
      "tokens": {
        "colors": {
          "primary": "#4F46E5",
          "primaryForeground": "#FFFFFF",
          "secondary": "#475569",
          "secondaryForeground": "#FFFFFF",
          "background": "#F8FAFC",
          "surface": "#FFFFFF",
          "surfaceBorder": "#E2E8F0",
          "textPrimary": "#0F172A",
          "textMuted": "#475569",
          "destructive": "#DC2626",
          "accent": "#06B6D4"
        },
        "typography": {
          "fontFamily": {
            "primary": "Inter, -apple-system, BlinkMacSystemFont, sans-serif",
            "mono": "JetBrains Mono, monospace"
          },
          "fontSize": {
            "xs": "12px",
            "sm": "14px",
            "base": "16px",
            "lg": "20px",
            "xl": "25px",
            "2xl": "32px",
            "3xl": "40px"
          },
          "fontWeight": {
            "normal": "400",
            "medium": "500",
            "semibold": "600",
            "bold": "700"
          }
        },
        "spacing": {
          "xs": "4px",
          "sm": "8px",
          "md": "16px",
          "lg": "24px",
          "xl": "32px",
          "2xl": "48px"
        },
        "shapes": {
          "radius": {
            "none": "0px",
            "sm": "6px",
            "md": "10px",
            "lg": "16px",
            "full": "9999px"
          }
        }
      }
    },
    {
      "id": "minimal-dark-developer",
      "name": "Minimal Dark Developer",
      "tone": "Focused, keyboard-first, dark-mode developer workspace",
      "colorMode": "DARK",
      "tokens": {
        "colors": {
          "primary": "#F43F5E",
          "primaryForeground": "#090A0F",
          "secondary": "#94A3B8",
          "secondaryForeground": "#090A0F",
          "background": "#090A0F",
          "surface": "#12141A",
          "surfaceBorder": "#1E222D",
          "textPrimary": "#F8FAFC",
          "textMuted": "#94A3B8",
          "destructive": "#F87171",
          "accent": "#38BDF8"
        },
        "typography": {
          "fontFamily": {
            "primary": "Geist, -apple-system, BlinkMacSystemFont, sans-serif",
            "mono": "Geist Mono, JetBrains Mono, monospace"
          },
          "fontSize": {
            "xs": "12px",
            "sm": "13px",
            "base": "15px",
            "lg": "19px",
            "xl": "24px",
            "2xl": "30px",
            "3xl": "38px"
          },
          "fontWeight": {
            "normal": "400",
            "medium": "500",
            "semibold": "600",
            "bold": "700"
          }
        },
        "spacing": {
          "xs": "4px",
          "sm": "8px",
          "md": "12px",
          "lg": "20px",
          "xl": "28px",
          "2xl": "40px"
        },
        "shapes": {
          "radius": {
            "none": "0px",
            "sm": "4px",
            "md": "8px",
            "lg": "12px",
            "full": "9999px"
          }
        }
      }
    },
    {
      "id": "high-density-fintech",
      "name": "High-Density FinTech & Data Terminal",
      "tone": "Clinical, rigorous, maximum data legibility, low visual noise",
      "colorMode": "LIGHT",
      "tokens": {
        "colors": {
          "primary": "#0A2540",
          "primaryForeground": "#FFFFFF",
          "secondary": "#425466",
          "secondaryForeground": "#FFFFFF",
          "background": "#FFFFFF",
          "surface": "#F6F9FC",
          "surfaceBorder": "#E6EBF1",
          "textPrimary": "#0A2540",
          "textMuted": "#425466",
          "positive": "#00D924",
          "destructive": "#DF1B41",
          "accent": "#635BFF"
        },
        "typography": {
          "fontFamily": {
            "primary": "IBM Plex Sans, sans-serif",
            "mono": "IBM Plex Mono, monospace"
          },
          "fontSize": {
            "xs": "11px",
            "sm": "13px",
            "base": "14px",
            "lg": "18px",
            "xl": "23px",
            "2xl": "29px",
            "3xl": "37px"
          },
          "fontWeight": {
            "normal": "400",
            "medium": "500",
            "semibold": "600",
            "bold": "700"
          }
        },
        "spacing": {
          "xs": "2px",
          "sm": "6px",
          "md": "12px",
          "lg": "18px",
          "xl": "24px",
          "2xl": "36px"
        },
        "shapes": {
          "radius": {
            "none": "0px",
            "sm": "2px",
            "md": "4px",
            "lg": "6px",
            "full": "9999px"
          }
        }
      }
    },
    {
      "id": "editorial-warm-luxury",
      "name": "Editorial Warm Luxury",
      "tone": "Refined, cultured, narrative-driven, tactile and patient",
      "colorMode": "LIGHT",
      "tokens": {
        "colors": {
          "primary": "#1C1917",
          "primaryForeground": "#FAF8F5",
          "secondary": "#57534E",
          "secondaryForeground": "#FAF8F5",
          "background": "#FAF8F5",
          "surface": "#FFFFFF",
          "surfaceBorder": "#E7E5E4",
          "textPrimary": "#1C1917",
          "textMuted": "#57534E",
          "destructive": "#991B1B",
          "accent": "#B45309"
        },
        "typography": {
          "fontFamily": {
            "primary": "Source Serif 4, Georgia, serif",
            "sans": "Plus Jakarta Sans, sans-serif",
            "mono": "JetBrains Mono, monospace"
          },
          "fontSize": {
            "xs": "12px",
            "sm": "14px",
            "base": "17px",
            "lg": "22px",
            "xl": "28px",
            "2xl": "35px",
            "3xl": "44px"
          },
          "fontWeight": {
            "normal": "400",
            "medium": "500",
            "semibold": "600",
            "bold": "700"
          }
        },
        "spacing": {
          "xs": "6px",
          "sm": "12px",
          "md": "20px",
          "lg": "32px",
          "xl": "48px",
          "2xl": "72px"
        },
        "shapes": {
          "radius": {
            "none": "0px",
            "sm": "8px",
            "md": "14px",
            "lg": "24px",
            "full": "9999px"
          }
        }
      }
    },
    {
      "id": "neo-brutalist-vibrant",
      "name": "Neo-Brutalist Vibrant",
      "tone": "High-contrast, bold, architectural, playful",
      "colorMode": "LIGHT",
      "tokens": {
        "colors": {
          "primary": "#000000",
          "primaryForeground": "#FFFF00",
          "secondary": "#222222",
          "secondaryForeground": "#FFFFFF",
          "background": "#FFFDF0",
          "surface": "#FFFFFF",
          "surfaceBorder": "#000000",
          "textPrimary": "#000000",
          "textMuted": "#444444",
          "destructive": "#FF3366",
          "accent": "#FFE600"
        },
        "typography": {
          "fontFamily": {
            "primary": "Space Grotesk, sans-serif",
            "mono": "Space Mono, monospace"
          },
          "fontSize": {
            "xs": "12px",
            "sm": "13px",
            "base": "16px",
            "lg": "20px",
            "xl": "26px",
            "2xl": "36px",
            "3xl": "48px"
          },
          "fontWeight": {
            "normal": "500",
            "medium": "600",
            "semibold": "700",
            "bold": "700",
            "black": "900"
          }
        },
        "spacing": {
          "xs": "4px",
          "sm": "8px",
          "md": "16px",
          "lg": "24px",
          "xl": "36px",
          "2xl": "54px"
        },
        "shapes": {
          "radius": {
            "none": "0px",
            "sm": "0px",
            "md": "0px",
            "lg": "4px",
            "full": "9999px"
          }
        }
      }
    }
  ]
}
```

### Canonical Two-Layer `DESIGN.md` Template

```markdown
---
colors:
  primary: "#4F46E5"
  primaryForeground: "#FFFFFF"
  secondary: "#475569"
  secondaryForeground: "#FFFFFF"
  background: "#F8FAFC"
  surface: "#FFFFFF"
  surfaceBorder: "#E2E8F0"
  textPrimary: "#0F172A"
  textMuted: "#475569"
  accent: "#06B6D4"
  destructive: "#DC2626"
typography:
  fontFamily:
    primary: "Inter, -apple-system, BlinkMacSystemFont, sans-serif"
    mono: "JetBrains Mono, monospace"
  fontSize:
    xs: "12px"
    sm: "14px"
    base: "16px"
    lg: "20px"
    xl: "25px"
    2xl: "32px"
    3xl: "40px"
  fontWeight:
    normal: "400"
    medium: "500"
    semibold: "600"
    bold: "700"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "32px"
  2xl: "48px"
shapes:
  radius:
    none: "0px"
    sm: "6px"
    md: "10px"
    lg: "16px"
    full: "9999px"
---

## Overview

Describe the product purpose, target users, emotional tone, **Required content**, and **Left out on purpose** exclusions.

- **Clarity First**: One primary action per screen; peer actions vary by fill/border treatment, never size.
- **Measured Rhythm**: Enforce >= 1.25x heading scale steps and >= 2x section-to-internal spacing.
- **Accessible by Construction**: Every semantic text/surface pair meets >= 4.5:1 WCAG 2.1 AA contrast.

## Colors

- **Brand & Actions**: `{colors.primary}` with `{colors.primaryForeground}` text anchors the single primary CTA per screen; secondary surfaces pair `{colors.secondary}` with `{colors.secondaryForeground}`.
- **Canvas & Planes**: Base canvas uses `{colors.background}`, elevated containers use `{colors.surface}`, and structural hairlines use `{colors.surfaceBorder}`.
- **Text & Browser Surfaces**: Primary copy uses `{colors.textPrimary}`, supporting metadata uses `{colors.textMuted}`, and `color-scheme`, `::selection`, `caret-color`, scrollbars, and `:focus-visible` rings inherit `{colors.primary}` and `{colors.surface}`.
- **Feedback**: Reserve `{colors.destructive}` for irreversible actions and `{colors.accent}` for non-primary highlights.

## Typography

- **Families**: Interface prose uses `{typography.fontFamily.primary}`; code, IDs, and aligned data columns use `{typography.fontFamily.mono}` with `font-variant-numeric: tabular-nums`.
- **Hierarchy (`>= 1.25x` scale)**: Page titles use `{typography.fontSize.3xl}` (`{typography.fontWeight.bold}`), section headings use `{typography.fontSize.2xl}` (`{typography.fontWeight.semibold}`), subheadings use `{typography.fontSize.xl}` / `{typography.fontSize.lg}`, body copy uses `{typography.fontSize.base}` (`65-75ch` desktop measure, `>= 45ch` mobile), and captions use `{typography.fontSize.sm}` / `{typography.fontSize.xs}`.
- **Vertical Rhythm**: Heading top margin is `>= 1.5x` its bottom margin; display tracking stays `>= -0.04em`.

## Layout

- **Scroll Ownership (`A12`)**: `Layout: AppShell - persistent navigation + scrollable workpane -> fixed-rail-main (app-shell); scroll owner: main[data-scroll-owner]; anti-patterns: nested scrolling cards, horizontal overflow at 320px`.
- **Spatial Multiples**: Section gaps (`{spacing.2xl}`) remain `>= 2x` internal container padding (`{spacing.lg}`), with `{spacing.md}` / `{spacing.sm}` intra-group spacing and `{spacing.xs}` micro-gaps.
- **Reflow**: Primary content reflows cleanly down to `320px` width without horizontal scrollbars or clipped controls.

## Elevation & Depth

- Distinguish resting planes with 1px solid `{colors.surfaceBorder}` on `{colors.surface}` rather than heavy blurs.
- Floating menus, popovers, and dialogs use y-offset ambient shadows and explicit z-index strata (`base: 0`, `sticky: 10`, `popover: 20`, `backdrop: 40`, `dialog: 50`).

## Shapes

- **Controls**: Buttons, inputs, and segmented controls use `{shapes.radius.sm}`.
- **Containers**: Panels, dialogs, and drawers use `{shapes.radius.md}` or `{shapes.radius.lg}`; sharp data tables may use `{shapes.radius.none}`.
- **Pills**: Status chips and avatars use `{shapes.radius.full}`.

## Components

- **Buttons**: Primary (`{colors.primary}` fill, `{colors.primaryForeground}` label, `{shapes.radius.sm}`, `{spacing.sm}` `{spacing.md}` padding); Secondary (`{colors.surface}` fill, 1px `{colors.surfaceBorder}` border, `{colors.textPrimary}` label); Destructive (`{colors.destructive}` border/fill on confirmation).
- **Containers & Tables**: `{colors.surface}` background, 1px `{colors.surfaceBorder}` border, `{shapes.radius.md}` radius, `{spacing.lg}` padding; numeric cells enforce `tabular-nums`.
- **Inputs**: 38–40px height, `{shapes.radius.sm}`, 1px `{colors.surfaceBorder}`, 2px `{colors.primary}` `:focus-visible` outline with 2px offset.
- **Mandatory State Triad (`F9`)**: every asynchronous or data-bearing region defines **Loading** (layout-stable skeleton matching row geometry), **Empty** (concise explanation + single recovery action), and **Error** (human-readable cause + retry control without losing user input).

## Do's and Don'ts

- **Do** reference YAML tokens exclusively via `{category.token}` dot-paths and verify `validate-design-md` exits `0`.
- **Do** keep `tabular-nums` on numeric columns and maintain `>= 4.5:1` contrast across all semantic text pairs.
- **Don't** add decorative one-side accent stripes, `>= 2px` card outlines, fake vanity KPI strips, emoji icons, eyebrow kickers above every heading, generic 3-card icon stacks, or card-in-card wrappers.
- **Don't** introduce more than one primary CTA button per screen or create nested scroll containers competing with `scroll owner`.
```

---

## Workflow 2 Live Website Token Extraction

Use Live Website Token Extraction when the user provides a permitted live URL to reverse-engineer into a clean Stitch `DESIGN.md` specification.

1. **Verify External Hygiene**: check `robots.txt` first (disallow rules always apply) and consult `llms.txt` / `llms-full.txt` when available before navigating.
2. **Navigate & Hydrate**: open the URL via `playwright` (`browser_navigate`) or `chrome-devtools` MCP, wait for web fonts and stylesheets to settle, and capture a reference screenshot.
3. **Run the In-Browser Computed-Style Harvester**: execute this zero-dependency snippet via `browser_evaluate` / `evaluate_script`:

```javascript
(() => {
  const rgbToHex = (rgb) => {
    const match = rgb.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
    if (!match) return null;
    return '#' + [match[1], match[2], match[3]].map((x) => {
      const hex = parseInt(x, 10).toString(16);
      return hex.length === 1 ? '0' + hex : hex;
    }).join('').toUpperCase();
  };

  const colorCounts = {};
  const fontCounts = {};
  const sizeCounts = {};
  const radiusCounts = {};
  const spacingCounts = {};

  for (const el of document.querySelectorAll('body, body *')) {
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') continue;

    for (const c of [style.color, style.backgroundColor, style.borderColor]) {
      if (c && c !== 'rgba(0, 0, 0, 0)' && c !== 'transparent') {
        const hex = rgbToHex(c);
        if (hex) colorCounts[hex] = (colorCounts[hex] || 0) + 1;
      }
    }

    const font = style.fontFamily.split(',')[0].replace(/['"]/g, '').trim();
    if (font) fontCounts[font] = (fontCounts[font] || 0) + 1;

    if (style.fontSize && style.fontSize.endsWith('px')) {
      sizeCounts[style.fontSize] = (sizeCounts[style.fontSize] || 0) + 1;
    }
    if (style.borderRadius && style.borderRadius !== '0px') {
      radiusCounts[style.borderRadius] = (radiusCounts[style.borderRadius] || 0) + 1;
    }
    for (const sp of [style.marginTop, style.marginBottom, style.paddingTop, style.paddingLeft]) {
      if (sp && sp.endsWith('px') && sp !== '0px') {
        spacingCounts[sp] = (spacingCounts[sp] || 0) + 1;
      }
    }
  }

  const getTop = (obj, n = 5) => Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, n).map((e) => e[0]);
  return {
    topColors: getTop(colorCounts, 12),
    topFonts: getTop(fontCounts, 4),
    topFontSizes: getTop(sizeCounts, 8).sort((a, b) => parseFloat(a) - parseFloat(b)),
    topRadii: getTop(radiusCounts, 5).sort((a, b) => parseFloat(a) - parseFloat(b)),
    topSpacing: getTop(spacingCounts, 8).sort((a, b) => parseFloat(a) - parseFloat(b)),
  };
})();
```

4. **Normalize into 3-Level Stitch Tokens**:
   - **`colors.*`**: map dominant viewport color to `background`, card/panel fill to `surface`, 1px divider tone to `surfaceBorder`, primary body ink to `textPrimary`, secondary caption ink to `textMuted`, focal CTA fill to `primary`, and compute AA-compliant `primaryForeground` (`>= 4.5:1`).
   - **`typography.*`**: assign dominant UI font to `typography.fontFamily.primary`, code/data font to `typography.fontFamily.mono`, and cluster `topFontSizes` into `typography.fontSize.{xs,sm,base,lg,xl,2xl,3xl}` enforcing `>= 1.25x` heading steps.
   - **`spacing.*` & `shapes.radius.*`**: snap `topSpacing` to 4pt/8pt multiples (`xs`–`2xl`) and map control/card/pill radii to `shapes.radius.{none,sm,md,lg,full}`.
5. **Synthesize & Lint**: write all 8 Stitch sections with OMA Craft Floor rules and run Workflow 3 validation.

---

## Workflow 3 Deterministic Audit and Linting

Before completing any `$visual-ralph --design` creation, extraction, or audit pass, run the built-in zero-dependency Node.js validator:

```bash
# Standard WCAG 2.1 AA (4.5:1) + 8-section + 3-level token reference audit
sh <plugin>/hooks/run.sh validate-design-md DESIGN.md --json

# Strict WCAG 2.1 AAA (7.0:1) contrast floor
sh <plugin>/hooks/run.sh validate-design-md DESIGN.md --strict --json
```

### Exit Code & Diagnostic Contract

- **Exit `0` (`ok: true`)**: YAML frontmatter parses cleanly, all 4 required token categories (`colors`, `typography`, `spacing`, `shapes`) and all 8 canonical Stitch `## ` sections are present, `unresolvedRefs` is empty, and every evaluated semantic foreground/background pair passes `>= 4.5:1` (`>= 7.0:1` with `--strict`).
- **Exit `1` (`ok: false`)**: one or more `errors` detected:
  - `missing_category:<cat>` — add the missing top-level YAML token category.
  - `missing_section:<Section>` — add the missing canonical `## <Section>` heading outside fenced code blocks.
  - `unresolved_token_ref:{category.subpath}` — define the token in YAML frontmatter or fix the typo in Markdown prose.
  - `contrast_failed:<pair>:<ratio><4.5` (or `<7`) — darken/lighten the semantic foreground (`textPrimary`, `textMuted`, `primaryForeground`, `secondaryForeground`) or surface hex until all checks pass.
- **Exit `2` (`ok: false`)**: `<file>` argument omitted or target file does not exist / cannot be read.

Iterate until `validate-design-md` exits `0` with `errors: []`.

---

## Workflow 4 Google Stitch MCP Sync

When the user wants to publish or synchronize a validated `DESIGN.md` with an active Google Stitch project via `StitchMCP`:

### Option A — Two-Step `DESIGN.md` Base64 Upload (Preferred)

1. **Encode & Upload**: Base64-encode UTF-8 `DESIGN.md` without line wraps (`node -e "process.stdout.write(require('fs').readFileSync('DESIGN.md').toString('base64'))"` or `base64 < DESIGN.md | tr -d '\n'`) and call `StitchMCP` `upload_design_md`:
   ```json
   {
     "projectId": "<stitch_project_id>",
     "designMdBase64": "<base64_encoded_design_md>"
   }
   ```
2. **Bind Agnostic Design System**: pass the returned screen instance to `StitchMCP` `create_design_system_from_design_md`:
   ```json
   {
     "projectId": "<stitch_project_id>",
     "selectedScreenInstance": {
       "id": "<instance_id_from_upload>",
       "sourceScreen": "<source_screen_from_upload>"
     },
     "deviceType": "AGNOSTIC"
   }
   ```

### Option B — Direct Token Sync (`create_design_system` / `update_design_system` / `apply_design_system`)

When creating, updating, or applying a Stitch design system directly through structured parameters, map `DESIGN.md` tokens to Stitch enums:

- **Roundness (`shapes.radius.md`)**:
  - `0px` – `4px` -> `"ROUND_FOUR"` (sharp / technical)
  - `6px` – `8px` -> `"ROUND_EIGHT"` (balanced modern SaaS)
  - `10px` – `16px` -> `"ROUND_TWELVE"` (friendly rounded containers)
  - `9999px` -> `"ROUND_FULL"` (pill geometry)
- **Typography (`typography.fontFamily.primary`)**:
  - `"INTER"`, `"PLUS_JAKARTA_SANS"`, `"GEIST"`, `"SPACE_GROTESK"`, `"IBM_PLEX_SANS"`, `"SOURCE_SERIF_4"`, `"DM_SANS"`, `"MANROPE"`
- **Color Mode & Brand Anchor**:
  - `colorMode`: `"LIGHT"` or `"DARK"`
  - `customColor`: `{colors.primary}` hex value
  - `designMd`: full validated `DESIGN.md` content, then apply to target screens with `apply_design_system` and verify via `get_project` or `generate_screen_from_text`.
