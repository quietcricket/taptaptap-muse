# Repository Guidelines

## Project Structure & Module Organization

This is a TypeScript/Vite keyboard playground. Application code lives in `src/`, automated tests in `tests/`, static resources in `public/`, and build helpers in `scripts/`. The root `Dockerfile` builds the application and serves it with unprivileged Nginx on port 8080.

When introducing a structure, group application code under `src/`, automated tests under `tests/`, and static resources under `assets/` where appropriate. Keep configuration files at the repository root. Avoid creating empty directories solely to match this suggested layout.

## Build, Test, and Development Commands

Use `pnpm install`, `pnpm dev`, `pnpm check`, `pnpm test`, `pnpm build`, and `pnpm format` as documented in `README.md`. The package manager version is pinned in `package.json`.

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

Pull requests should explain the change, include validation performed, and link relevant issues. Add screenshots for visible interface changes. Explicitly note any unavailable checks or required configuration.

## Security & Configuration

Never commit credentials or local secrets. When environment configuration is introduced, provide a sanitized example file and ignore local overrides and generated artifacts.
