# Changelog

## 0.2.0

First packaged release of the HeySurf macOS desktop app.

- Native macOS glass with vibrancy fallback, a single workspace window, and browser-based sign-in.
- Option+Space Quick Ask: a compact pill composer, streamed answers, follow-ups, and shared cloud-agent context.
- Reconnect interrupted answer streams without resubmitting the task or repeating partial text.
- Keep the composer editable, clear sent text immediately, and preserve the next draft.
- Use the new tipped HeySurf logo in the app icon and sign-in screen.
- Open external service authorization in the default browser and preserve the workspace draft.
- Provide Apple Silicon and Intel DMG/ZIP packages with SHA-256 checksums.

This release is unsigned and not notarized. The README includes installation instructions and the app-scoped quarantine command. Cloud features depend on the hosted HeySurf frontend and backend deployment.

Validation: the Apple Silicon packaged app passes all 42 desktop tests. Intel executable architecture and archive integrity are checked locally; Intel runtime testing requires an Intel Mac or Rosetta, which is not installed on the build machine. The release workflow runs packaged-app tests on both architectures.
