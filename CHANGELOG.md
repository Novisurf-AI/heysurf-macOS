# Changelog

## 0.2.1

- Add a dedicated draggable top bar to the workspace and sign-in window, with a subtle hover indicator. Reserve its height so controls remain clickable below it.
- Keep the traffic-light controls and recreate the drag surface on navigation.

## 0.2.0

First packaged release of the HeySurf macOS desktop app.

- Native macOS glass with vibrancy fallback, a single workspace window, and browser-based sign-in.
- Option+Space Quick Ask: a compact pill composer, streamed answers, follow-ups, and shared cloud-agent context.
- Reconnect interrupted answer streams without resubmitting the task or repeating partial text.
- Keep the composer editable, clear sent text immediately, and preserve the next draft.
- Use the new tipped HeySurf logo in the app icon and sign-in screen.
- Open external service authorization in the default browser and preserve the workspace draft.
- Restore the main window when continuing a Quick Ask, and preserve rejected questions for retry without replacing newer drafts.
- Require a matching, unexpired login attempt and reject replayed or unsolicited login callbacks.
- Restrict device and clipboard access to the workspace origin, with explicit consent for microphone, camera and clipboard reads.
- Provide Apple Silicon and Intel DMG/ZIP packages with SHA-256 checksums.

This release is unsigned and not notarized. The README includes installation instructions and the app-scoped quarantine command. Cloud features depend on the hosted HeySurf frontend and backend deployment.

Validation: the Apple Silicon packaged app passes all 47 desktop tests. Intel executable architecture and archive integrity are checked locally; Intel runtime testing requires an Intel Mac or Rosetta, which is not installed on the build machine. The release workflow runs packaged-app tests on both architectures.
