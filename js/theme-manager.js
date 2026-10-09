/**
 * theme-manager.js — applies a world's presentation tokens.
 *
 * Owns only presentation state. It never touches the player, so switching
 * worlds cannot interrupt playback, seek position or the queue.
 */
import { THEMES, getTheme } from './theme-registry.js';
import { settings } from './settings.js';

function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [0, 0, 0];
}

class ThemeManager extends EventTarget {
  constructor() {
    super();
    this.current = null;
  }

  /** Apply a world. `source` is informational: 'user' | 'auto' | 'init' | 'url'. */
  apply(id, source = 'user') {
    const theme = getTheme(id);
    if (this.current && this.current.id === theme.id) return theme;
    const root = document.documentElement;
    const p = theme.palette;
    const vars = {
      '--bg': p.bg,
      '--surface': p.surface,
      '--surface-rgb': hexToRgb(p.surface).join(','),
      '--surface-alpha': String(theme.panel.alpha),
      '--primary': p.primary,
      '--primary-ink': p.primaryInk,
      '--on-primary': p.onPrimary,
      '--secondary': p.secondary,
      '--accent': p.accent,
      '--text': p.text,
      '--muted': p.muted,
      '--border': p.border,
      '--font-display': theme.fonts.display,
      '--font-body': theme.fonts.body,
      '--font-mono': theme.fonts.mono,
      '--radius': theme.panel.radius,
      '--panel-border-width': theme.panel.borderWidth,
      '--panel-shadow': theme.panel.shadow,
    };
    for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
    root.dataset.theme = theme.id;
    root.dataset.glitchy = theme.a11y?.glitchy ? 'true' : 'false';
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', p.bg);
    const prev = this.current;
    this.current = theme;
    settings.set('world', theme.id);
    this.dispatchEvent(new CustomEvent('change', { detail: { theme, previous: prev, source } }));
    return theme;
  }

  get list() { return THEMES; }
}

export const themeManager = new ThemeManager();
