# .nix

Nix flake defining the reproducible development environment for this repo.

- `flake.nix` — a dev shell (`nix develop ./.nix`) providing the Rust toolchain (rustc, cargo, clippy, rust-analyzer), Node.js + pnpm, and build tooling (just, bacon, pkg-config, openssl) across Linux and macOS.
- `flake.lock` — pinned input revisions.

Entered via the repo's `./shell` wrapper or automatically through direnv (`.envrc` → `use flake ./.nix`).
