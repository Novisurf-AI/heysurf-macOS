# HeySurf for macOS

HeySurf brings your workspace to macOS with native glass, browser-based sign-in, and **Option+Space** Quick Ask.

## Install

Requires **macOS 13 or later**. Native Liquid Glass is available on macOS 26 and later; earlier versions use vibrancy.

1. Download the DMG for your Mac from [Releases](https://github.com/Novisurf-AI/heysurf-macOS/releases): `arm64` for Apple Silicon, `x64` for Intel.
2. Open the DMG and drag **HeySurf** into **Applications**.
3. This release is not notarized. After copying the app, run the following command in Terminal to remove its quarantine attribute:

   ```sh
   xattr -dr com.apple.quarantine "/Applications/HeySurf.app"
   ```

4. Open **HeySurf** from Applications and sign in through your browser.

The command applies only to the installed HeySurf app. Release downloads also include ZIP archives and `SHA256SUMS.txt` for verifying the downloaded files. Updates are installed by replacing the app in Applications; automatic updates are not configured.

The top strip of the desktop window is draggable. Hover it to reveal the grip; the app’s controls remain below the drag area.

## Quick Ask

Press **Option+Space** to open a compact glass pill on the display under your pointer. Enter sends; Shift+Enter adds a line; Escape dismisses. The panel expands for the answer, keeps the composer editable, and accepts follow-ups while Surf works. Each shortcut invocation opens an empty composer.

Quick Ask uses your shared HeySurf conversation and the normal cloud agent with tools, account limits and permissions. Tool approval and input requests can be continued in the main app. Temporary output interruptions reconnect from the last stream position. Full agent access requires the matching Quick Ask backend to be deployed; installing the desktop app does not deploy the server.

Microphone, camera and clipboard access require consent and are restricted to the hosted workspace origin. Login callbacks require a matching, unexpired login attempt initiated in the desktop app.

## Develop

Use macOS with Node.js 22 or later:

```sh
npm ci
npm start
```

The default workspace is `https://heysurf.dev/app`. Set `HEYSURF_ORIGIN` to a local or staging origin for development. Authentication and account data are supplied by the hosted app; no credentials belong in this repository.

```sh
npm run check
npm test
```

Integration tests launch Electron with isolated profiles and localhost fixtures. They do not use your conversations or signed-in account.

## Build a release

```sh
npm ci
npm run check
npm test
npm run dist:all
npm run checksums
```

Artifacts are written to `dist/`. `dist` builds an Apple Silicon DMG; `dist:intel` builds an Intel DMG; `dist:all` builds DMGs and ZIPs for both architectures. Native addons are unpacked from ASAR. The prebuilt Liquid Glass addon includes both architectures.

To test the Apple Silicon packaged app:

```sh
HEYSURF_TEST_EXECUTABLE="$PWD/dist/mac-arm64/HeySurf.app/Contents/MacOS/HeySurf" npm test
```

Builds are unsigned and not notarized unless a Developer ID identity and notarization credentials are configured. Do not describe unsigned artifacts as notarized. See [CHANGELOG.md](CHANGELOG.md) for release notes.

The release workflow builds and tests both architectures on macOS, creates checksums, and uploads a **draft GitHub Release** for review. It can be started manually with an existing `v` tag; tag pushes trigger the same workflow. The package version and tag must agree. Merge release changes before tagging the default branch.

## Artwork

The source logo is `build/heysurf-tipped-logo.svg`. `npm run icon:build` regenerates the rounded macOS SVG, PNG and ICNS assets from that artwork. The sign-in screen uses the same logo.

The checked-in `build/dmg-background*.png` files are ready for release builds. Regenerating installer artwork with `npm run installer:art` requires an adjacent `anyx-code` frontend checkout for the glacier CSS; ordinary app builds do not require it.

Historical performance measurements are in [reports/performance-0.1.1.md](reports/performance-0.1.1.md). They are synthetic local measurements, not guarantees for every Mac or conversation.
