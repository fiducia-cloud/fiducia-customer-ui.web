# workflows

GitHub Actions CI for the customer portal.

`ci.yml` runs on pushes to `main`, pull requests, and manual dispatch. It has two jobs:

- **build** — checks out this repo plus the sibling `file:../` dependencies (`fiducia-interfaces`, `fiducia-test-config`, `fiducia-sync`), builds the `@fiducia/sync` bundler-target wasm, then runs `npm run check` (typecheck) and `npm run build`.
- **browser-e2e** — best-effort (`continue-on-error`) full-browser suite that also checks out `fiducia-backend.rs` and `fiducia-ui.web`, boots the real backend serving the built `dist`, and drives Chrome via `npm run test:browser`. It never gates the build.
