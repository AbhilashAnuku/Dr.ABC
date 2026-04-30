/**
 * App-wide config — defaults baked in so the app is "loaded" out of the box,
 * with localStorage overrides per-user via Settings.
 */

/**
 * Default Mörbius avatar — empty string means "use the procedural 3D
 * face we built in code" (apps/web/src/overlay/morbius-face.tsx — a
 * white-and-cyan android face with blinking, lip-sync, cursor-tracking
 * eyes, and listening/speaking glow).
 *
 * Users can override by pasting any glTF URL (ReadyPlayerMe, Sketchfab,
 * custom CDN) into Settings — that swaps in a full-body GLB with
 * morph-target lip sync.
 */
export const DEFAULT_AVATAR_URL = '';

/**
 * Default Sketchfab anatomy embed — curated playlist by Stereotype24
 * (https://sketchfab.com/Stereotype24/collections/anatomy-263c48fd2789452f93b733a1e2d5f667).
 * Cycles through high-quality anatomy models. The playlist embed gives
 * us multiple models without needing to maintain our own list.
 *
 * To swap: paste any Sketchfab embed URL (model or playlist) into the
 * Anatomy page side panel. Sketchfab branding + author credit must be
 * preserved per their terms.
 */
export const DEFAULT_SKETCHFAB_URL =
  'https://sketchfab.com/playlists/embed?collection=263c48fd2789452f93b733a1e2d5f667&autostart=1';

export const SKETCHFAB_CREDIT = {
  text: 'Anatomy',
  collectionUrl:
    'https://sketchfab.com/Stereotype24/collections/anatomy-263c48fd2789452f93b733a1e2d5f667',
  authorName: 'Stereotype24',
  authorUrl: 'https://sketchfab.com/Stereotype24',
};

/** API base URL for the orchestrator. Override via VITE_API_BASE_URL. */
export const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? '/api').toString();
