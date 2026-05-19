# Extension Changelog

All notable changes to the ASMR Curator Companion browser extension. The
extension is versioned independently from the main app; the `Release
Extension` GitHub workflow reads the matching section here and uses it as
the release notes for the published extension zip.

The format is a simplified version of [Keep a Changelog](https://keepachangelog.com/en/1.1.0/):

- `Additions` — New features
- `Changes` — Behaviour changes
- `Fixes` — Bugfixes
- `Other` — Technical changes / updates

## [Unreleased]

## [0.1.1]

### Fixes

- **Backend URL can now point at any LAN host**, not just `localhost` / `127.0.0.1`. Previously a backend on a remote box (Unraid, separate homelab, reverse-proxied hostname) would fail with `NetworkError when attempting to fetch resource` because the manifest's `host_permissions` were locked to loopback. Broadened to `http://*/*` + `https://*/*` so any user-configured backend URL is reachable.

## [0.1.0]

First packaged release.

### Additions

- **One-click Patreon + Google cookie sync** into the local ASMR Curator backend. Replaces the manual DevTools copy/paste step.
- **Floating Sync pill on patreon.com** that fires the same sync without leaving the page.
- **Toolbar popup** with a single Sync button. Mixed outcomes are surfaced as one combined status so you can tell which service needs you to log in.
- **Options page** for the backend URL — point the extension at a remote homelab or alternate port.
- **MV3 manifest** for Chromium and Firefox 121+.
