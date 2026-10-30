# Repository Guidelines

## Project Structure & Module Organization

This is a TypeScript/Vite keyboard playground with a FastAPI account and mode-studio backend. Application code lives in `src/`, the Python server in `src/server/`, automated tests in `tests/` (Python tests in `tests/server/`), static resources in `public/`, and build helpers in `scripts/`. The root `Dockerfile` builds the frontend and serves it through FastAPI on port 8080. OpenCode runs file-only mode generation inside the app container; `compose.yaml` runs the web app with DynamoDB persistence. Provision the table explicitly with `scripts/setup_dynamodb.py`; runtime IAM permissions are documented in `infra/dynamodb-policy.json`.

When introducing a structure, group application code under `src/`, automated tests under `tests/`, and static resources under `assets/` where appropriate. Keep configuration files at the repository root. Avoid creating empty directories solely to match this suggested layout.

## Build, Test, and Development Commands

Use `pnpm install`, `pnpm dev`, `pnpm check`, `pnpm test`, `pnpm build`, and `pnpm format` as documented in `README.md`. The package manager version is pinned in `package.json`.

The container includes pinned OpenCode and reuses its embedded Bun via `scripts/opencode-bun.sh` for dependency installation, TypeScript checking, and frontend builds. Do not add a separate Node.js or Bun installation to the image. Keep Linux release checksums pinned in `Dockerfile` and verify both `opencode --version` and a `bun build` smoke check after runtime changes. Native pnpm development continues to use `pnpm-lock.yaml`; container builds use the migrated `bun.lock`. Keep both locks in sync when changing JavaScript dependencies.

Use `uv sync --group dev` for Python dependencies, `uv run pytest` for backend tests, and `uv run ruff check src/server tests/server` plus `uv run ruff format --check src/server tests/server` for Python lint and formatting. Keep `uv.lock` updated. See `README.md` for server startup, email setup, and the OpenCode/Meta integration.

Document dependency installation, local startup, production builds, and test execution. Do not assume commands such as `npm test` exist until their configuration is committed.

## Coding Style & Naming Conventions

Follow the conventions of the language and framework introduced by the project. Configure a formatter and linter early, and keep their settings in version control. Match existing indentation and naming when extending established code. Use descriptive filenames and identifiers, and keep modules focused on a single responsibility.

## Testing Guidelines

Use checks proportional to the change; do not run the full test suite or production build after every edit. For a focused behavior change, run the relevant test file, for example `node --experimental-strip-types --test tests/tumble.test.mjs`. Use `pnpm check` when TypeScript validation is relevant. Documentation-only changes do not require tests; simple visual changes usually need a visual check.

Run `pnpm test` for changes affecting several modes or shared engine behavior, before merging to `main`, or when explicitly requested. Run `pnpm build` for build, dependency, deployment, or asset changes. Once appropriate checks pass, do not repeat or broaden them without new changes, failures, or unresolved concerns. Add regression tests for meaningful bugs, and report the checks actually performed.

## Commit & Pull Request Guidelines

No Git history is available to establish commit conventions. Use concise, imperative commit subjects, such as `Add initial application structure`, and keep changes focused.

Work on `dev`. Merge or push to `main` only when the user explicitly requests it; pushes to `main` deploy the live game. Do not monitor GitHub workflow runs unless requested.

The `origin` remote is AWS CodeCommit in `ap-southeast-1`. Use AWS profile `appsme` for this project. Container images go to the private ECR repository `399049857363.dkr.ecr.ap-southeast-1.amazonaws.com/taptaptap`; tags are immutable. See `README.md` for authentication and publishing commands.

Production is served at `https://taptaptap.birme.net` through Cloudflare on SSH host `vera`. The server uses `~/taptaptap/compose.vera.yaml`, Caddy, and an app-specific EC2 role. Build release images for `linux/arm64`. Deployment is manual and separate from Git pushes; see `README.md` for the image-digest update and rollback procedure.

Pull requests should explain the change, include validation performed, and link relevant issues. Add screenshots for visible interface changes. Explicitly note any unavailable checks or required configuration.

## Security & Configuration

Never commit credentials or local secrets. When environment configuration is introduced, provide a sanitized example file and ignore local overrides and generated artifacts.

Use `.env.example` for settings. Never expose generated HTML on the app origin or execute agent-produced code in the web container. OpenCode runs each turn in a private temporary workspace, receives only a placeholder token, and has file-only permissions. The real Meta key remains in the trusted relay outside the child. Preserve the denial of shell, Code Mode execution, external directories, and config edits. Never bake META_API_KEY into an image. Preserve mode ownership checks, one-time email verification, session hashing, and same-origin mutation checks when extending the API.

Use DynamoDB conditional transactions for token consumption, project limits, and artifact/chat commits. Keep expiration checks independent of TTL cleanup. Preserve lease ownership during save and release. Store large HTML as versioned chunks under the item-size limit; do not put complete mode artifacts or unbounded chat history into one item. Backend tests use Moto and fake credentials, never the live table.

New studio modes are exactly one default `CustomMode` TypeScript class implementing `PlayMode`, with a `ModeContext` constructor. OpenCode may edit only `mode.ts` and `reply.txt`; original engine and mode sources are read-only reference material. `scripts/build-mode.ts` checks and bundles source with the embedded Bun runtime without importing or executing it on the server. Preserve its single-class and import restrictions. The preview reuses `index.html`, `src/game.ts`, the original engine, and styles via the immutable `mode-runtime.json` build. Keep generated modules inside the opaque-origin iframe. Store source and compiled code atomically in the versioned artifact chunks and retain legacy HTML reads.

For full local studio testing, use `docker compose -f compose.yaml -f compose.local.yaml up -d` with the ignored local `.env`. This uses DynamoDB Local and fake AWS credentials; never point local fixtures at the production table. Keep local CA trust, scoped diagnostics, and the copied server `.env.server` ignored and out of images. Agent outputs are checked by `WorkspaceGuard` before compilation/save; preserve explicit authenticated user/project scope and rejection of unexpected file changes or links. TypeScript interfaces/type aliases are allowed alongside the single mode class because they produce no runtime code.

Preserve the Linux Landlock/seccomp boundary in `scripts/agent-sandbox.c` and `src/server/sandbox.py`. Never add an unisolated fallback. Only the fixed Meta Muse endpoint and the current turn's registered private harness worker may be reached; no arbitrary loopback, metadata, or internal-service destinations. Keep real API keys outside the harness environment, keep the compiler offline, and maintain adversarial syscall/filesystem probes when changing the boundary.
