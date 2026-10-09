/**
 * config.js — deploy-time configuration. Safe to commit.
 *
 * SPOTIFY_CLIENT_ID: your Spotify app's *Client ID* (public by design).
 * Leave empty to let each visitor paste their own in Settings.
 *
 * NEVER put a Client Secret here or anywhere in this repository — a static
 * site cannot keep secrets. This project uses Authorization Code + PKCE,
 * which needs no secret.
 */
export const SPOTIFY_CLIENT_ID = '';
