# taptaptap

[Play taptaptap](https://taptaptap.birme.net/) · [Mode studio](https://taptaptap.birme.net/studio.html)

A little world for every key. A keyboard playground with an optional account-based studio where users describe and build their own typing modes with OpenCode and Muse Wonder 1.0. The original worlds remain available without an account.

Built with TypeScript, Vite, PixiJS, Matter.js, and FastAPI. Fredoka is bundled locally through Fontsource; sound effects are synthesized with Web Audio. Studio accounts, conversations, and custom modes are saved on the server. Studio prompts, recent conversation, and the current custom mode are sent to Meta through OpenCode when you request a change.

## Run locally

For native development, use Node.js 22.12+ (or a compatible newer release) and
pnpm 11.10.0. The Docker build uses OpenCode's embedded Bun runtime instead of
installing Node.js; see the container section below.

```sh
pnpm install
pnpm dev
```

Open the local address printed by Vite. Press a key or choose **Start typing**. Physical keyboards are the primary input; browser and OS shortcuts remain available.

## Worlds

- **Float:** letters drift upward with a gentle sway.
- **Tumble:** letters fall, bounce, and collect in a pile. Rounded collision boxes approximate the glyphs.
- **Train:** letters join the tail of a train moving from a random starting point, making right-angle turns throughout the play area; each new letter gives it a little push that gently tapers back to cruising speed, with a soft choo-choo whistle as you type.
- **Story:** any play key reveals the next character of a prepared passage, with automatic spaces, punctuation, and word wrapping. Twelve original three-paragraph stories flow one after another; pauses do not reset the passage. Add your own passage in parent settings; it stays in this browser.
- **Typewriter:** actual typed characters form lines of text with a blinking cursor. Space inserts a space, Enter starts a new line, and Backspace removes the last live character.
- **Ripples:** letters land on a pond, sending rings across the surface and bobbing nearby letters.
- **Stars:** letters form constellations with delicate connections and gently twinkling points.

The dock selects worlds, mutes sound, clears letters, enters fullscreen, and opens parent settings. Worlds rotate automatically every 45 seconds by default; parents can turn rotation off or choose a different duration and participating worlds. Settings also include shuffle, letter size, sound volume, separate keypress sounds, and gentler motion. Preferences stay in this browser. Sound starts after user interaction. Background tabs pause animation and rotation.

Once play starts, the interface and cursor disappear after three seconds of pointer inactivity. Move the mouse, tap the screen, or press Tab to reveal the controls. Settings stay visible while open, and keyboard-focused controls remain visible.

Story text stays visible without fading and scrolls upward as the page fills. Clear the page or switch worlds to start fresh. In the other worlds, each letter has its own 15-second lifespan and fades during its last two seconds, even when typing stops. New letters do not push out existing letters. Expiration uses foreground play time, so background tabs remain paused.

## Play time limits

Parent settings offer an optional 5, 10, 15, 20, or 30-minute play limit (off by default). The timer starts when play begins. At the deadline, a “Take a break” screen blocks typing, controls, animation, and sound for five minutes. Play returns automatically when the countdown ends. A grown-up can optionally solve a random multiplication-and-addition question to skip the remaining break.

Session deadlines are saved in local browser storage. Refreshing or reopening the page preserves both the play deadline and any remaining break, and tabs on the same site share the session. Closing a tab does not pause the timer; time away counts toward the break. The question and remaining break survive refreshes, wrong answers, and reopening the page. A correct answer skips the wait and starts a fresh play session; no answer is needed to resume after five minutes. Active breaks cannot be cancelled through parent settings.

This is a browser-local family timer: clearing site data or using another browser/profile creates separate storage. If browser storage cannot save a timer, the app reports the failure rather than silently starting it.

## Development

```sh
pnpm check   # TypeScript validation
pnpm test        # Settings, keyboard mapping, and rotation tests
pnpm build  # Validate and create dist/
pnpm preview # Preview the production build
pnpm format # Format source and contributor documentation
```

The full app runs on EC2 in a container; FastAPI serves both the built HTML and
the account/studio API on port 8080. Static hosting alone supports the original
playground but cannot run accounts or the studio API. This checkout has no
automated deployment pipeline. Keep work on `dev`; publishing an ECR image does
not deploy it to EC2.

## Accounts and local server

Use Python 3.12+ and [uv](https://docs.astral.sh/uv/). Python dependencies are
pinned in `uv.lock`; JavaScript dependencies are pinned in `pnpm-lock.yaml`.

```sh
uv sync --group dev
uv run python scripts/setup_dynamodb.py --profile appsme
pnpm install --frozen-lockfile
pnpm build
AWS_PROFILE=appsme uv run uvicorn server.app:create_app --factory --app-dir src --host 127.0.0.1 --port 8080
```

Open `http://localhost:8080/studio.html`. Local defaults print email sign-in links
in the server log. Follow the link and click **Confirm sign-in**; the email
fragment is removed from the address bar before use. Accounts are created only
after verifying the link. Tokens expire after 15 minutes and work once; sign-in
sessions last 30 days. The database stores hashes of tokens and sessions.
Email requests have a 60-second cooldown per address, enforced atomically in
DynamoDB. The send button shows the remaining time across refreshes and tabs,
using the server's `Retry-After` response. The limit of three requests per address
per 15 minutes still applies.

```sh
uv run pytest
uv run ruff check src/server tests/server
uv run ruff format --check src/server tests/server
```

For frontend development, run the API and `pnpm dev` in separate terminals, with
`APP_URL=http://localhost:5173` on the API process. Open that exact origin. Vite
proxies `/api` to port 8080. Changes to environment settings require restarting
the API process. Both servers accept mutations only from the configured origin.

## Isolated local studio testing

The local stack uses the copied Meta key with DynamoDB Local, fake AWS
credentials, console email, and a separate `taptaptap-local` table. It cannot
write to the production table. Keep `.env.server` as the protected server copy;
`.env` contains localhost overrides. Both files and local diagnostics are ignored
by Git and excluded from Docker builds.

```sh
# For a fresh checkout: copy .env.example to .env and set META_API_KEY locally.
# This session already has a protected .env copied from vera with local overrides.
cp "${SSL_CERT_FILE:-/etc/ssl/cert.pem}" .env.local-ca.pem
mkdir -p data/local-debug
chmod 777 data/local-debug
pnpm build
docker compose -f compose.yaml -f compose.local.yaml up -d --build
```

Open `http://localhost:8080/studio.html`. Source, scripts, provider config, and
`dist` are mounted read-only, so changes need no image publish. Rebuild frontend
assets with `pnpm build`; restart only the local app after Python changes:

```sh
docker compose -f compose.yaml -f compose.local.yaml restart app
# Runs a real paid Muse Wonder request for the butterfly prompt as the local
# liang.shang@gmail.com fixture; refuses any production database configuration.
docker compose -f compose.yaml -f compose.local.yaml exec -T -e PYTHONPATH=/app app /app/.venv/bin/python /app/scripts/test_local_mode.py
```

Sign-in email links appear only in the local app log. The fixture also saves a
one-time local browser link and its API result in `data/local-debug/local-test.json`.
That file is private and ignored; do not publish it. Compiler diagnostics and
mode source are saved in user/project-scoped directories under
`data/local-debug/`; the Meta key is redacted. Diagnostics cannot be enabled on
public app origins. Local runs allow up to 210 seconds for the coding turn.

Each request receives only its authenticated user's mode and conversation.
Agent tools allow edits only to `mode.ts` and `reply.txt`. A filesystem snapshot
check rejects changes to the request, read-only reference files, unexpected
files, symlinks, and hard links before compilation or database save. The server
passes the authenticated user/project IDs explicitly; it rejects other users'
project IDs before invoking OpenCode. Compiler errors get one repair attempt
within the same private workspace and overall deadline.
Run compiler regression checks without a model call with:

```sh
docker compose -f compose.yaml -f compose.local.yaml exec -T app bun run /app/scripts/check-mode-compiler.mjs
```

## EC2 container setup

```sh
cp .env.example .env
docker compose up -d --build
docker compose logs -f app
```

Compose exposes port 8080 only on host loopback. Put an HTTPS reverse proxy on
the EC2 host in front of it. Set `APP_URL` to your exact public HTTPS origin,
`EMAIL_DELIVERY=ses`, and `EMAIL_FROM` to an SES-verified sender. Set `SES_REGION`
to its verified region; it defaults to `AWS_REGION` when unset. Public origins require HTTPS and SES; console sign-in delivery is
limited to localhost. SES sandbox accounts can send only to verified recipients.
See [SES identity setup](https://docs.aws.amazon.com/ses/latest/dg/creating-identities.html).

Grant the EC2 instance role the table permissions in
[infra/dynamodb-policy.json](infra/dynamodb-policy.json), plus `ses:SendEmail`
for your sender identity. Never embed
AWS credentials in an image. Accessing instance-role credentials from a bridge
container may require an [IMDSv2 response hop limit of 2](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/configuring-IMDS-new-instances.html); enforce IMDSv2 and block
untrusted workloads from instance metadata. Chat generation is bounded to 95
seconds plus up to 30 seconds for compilation; allow a little more time for the proxy request. The web API ignores forwarded client-IP headers; its per-IP
email limit will cover all users behind the proxy, in addition to per-email
limits. Configure trusted proxy addresses before raising that shared limit.

Persistence uses the `taptaptap` DynamoDB table in `ap-southeast-1`; set
`DYNAMODB_TABLE` and `AWS_REGION` to select another table or region. The app has
no database files or persistent container volume. On EC2, the container uses the
instance role; for native local development use AWS profile `appsme`. Compose
expects instance-role credentials and does not mount local AWS profiles.

`scripts/setup_dynamodb.py` explicitly provisions an on-demand table with string
partition key `pk`, string sort key `sk`, TTL attribute `expires_at`, and
point-in-time recovery. Run it with an administrative provisioning identity;
the app role needs only the runtime policy linked above. Startup checks that
the table exists; the app never creates or reconfigures AWS resources.

Accounts, hashed login tokens, sessions, rate counters, projects, HTML chunks,
and chat messages share the table. All reads use primary keys and queries, with
pagination and strongly consistent reads; runtime code never scans the table.
Expired credentials are rejected by the app even before asynchronous TTL cleanup.
One-time verification, the 50-mode account limit, and mode/chat saves use
conditional transactions. Lease IDs prevent expired jobs from saving over or
unlocking a newer turn. Mode artifacts have a 512,000-byte UTF-8 limit and are stored in
64,000-byte chunks to fit [DynamoDB's item size limit](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Constraints.html).
Each successful update atomically replaces the prior artifact and appends chat.
New artifacts contain the editable TypeScript class and its compiled browser
module. Legacy HTML modes remain readable and are converted on their next edit.

Tests use Moto with fake credentials and isolated tables, without contacting
AWS. `DYNAMODB_ENDPOINT_URL` optionally points the native server at DynamoDB
Local; use that endpoint consistently when provisioning with `--endpoint-url`.
Legacy SQLite data is not automatically imported; existing files are untouched.
The production configuration for the SSH host `vera` is described below.

## Production on vera

The site is served at `https://taptaptap.birme.net` through Cloudflare. The origin
is EC2 instance `i-0df7143dcc834b5da` (`18.142.223.61`), accessed with `ssh vera`.
`compose.vera.yaml` runs the app behind Caddy on ports 80/443; the app port is
private to the Docker network. `infra/Caddyfile` handles automatic certificate
issuance and renewal using the HTTP ACME challenge, plus HTTP-to-HTTPS redirects.
Keep Cloudflare's DNS record pointed at the origin and use
[Full (strict) SSL](https://developers.cloudflare.com/ssl/origin-configuration/ssl-modes/full-strict/).
Certificate state persists in the Caddy volumes; preserve them during upgrades.

The deployment lives in `~/taptaptap` on `vera`. Its protected `.env` holds
`APP_IMAGE` pinned to an ECR image digest, `EMAIL_FROM`, and `META_API_KEY`; `infra/vera.env.example` documents the format. The instance profile
`taptaptap-vera` supplies credentials. Its trust and runtime policies are in
`infra/ec2-trust-policy.json` and `infra/vera-policy.json`. No AWS keys are copied
to the server or the app image.

To deploy a new release, build for `linux/arm64`, publish it to ECR, and update
`APP_IMAGE` in the server's `.env` to the new digest. Copy updated Compose/Caddy
files if needed, then run:

```sh
ssh vera
cd ~/taptaptap
aws ecr get-login-password --region ap-southeast-1 \
  | docker login --username AWS --password-stdin 399049857363.dkr.ecr.ap-southeast-1.amazonaws.com
docker compose -f compose.vera.yaml --env-file .env pull
docker compose -f compose.vera.yaml --env-file .env up -d
docker compose -f compose.vera.yaml --env-file .env ps
```

Rollback uses the same commands after restoring the previous image digest.
This is a manual deployment; a CodeCommit push does not automatically deploy.
Email delivery uses `contact@birme.net` with `SES_REGION=us-east-1`, where the
account has SES production access. The sender must be verified in that region.
DynamoDB and the EC2 instance remain in `ap-southeast-1`; their region is selected
independently with `AWS_REGION`. The Singapore SES region remains sandboxed and
can send only to verified recipients. Do not switch email back there for public
sign-in unless it has also received production access. The existing
`appsme-website` contact form delegates to `https://www.birme.net/api/contact`;
that checkout does not contain the outbound mail implementation.

## OpenCode and Meta integration

The image contains the OpenCode provider and mode-agent configuration in
`infra/opencode.json`, installed as immutable `/etc/opencode/opencode.json`.
The trusted relay uses Meta's Responses API at `https://api.meta.ai/v1`, pinned to
`meta/muse-wonder-1.0` (**Muse Wonder 1.0**).
The immutable harness provider points only at the local relay (`http://127.0.0.1:9/v1`).
The v2 native Responses adapter is bundled in OpenCode; no provider package is
installed at startup.

Set `META_API_KEY` in the server's protected `.env`. Both Compose files pass it
into the app **at runtime**. It is never a Docker build argument or image layer;
`.env` files are excluded from the build context. Updating a running deployment
requires recreating the app container with the updated Compose configuration.
No push or deployment is needed to build and test the image locally.

Each authenticated chat request uses supervisor-started `opencode serve --stdio`
and a separately sandboxed `opencode run --server` client, with a
private temporary workspace and configuration/state directories. It receives
only recent chat, that user's current mode source, and read-only copies of the
original mode examples and engine contracts. The child receives a placeholder
token and private runtime directories, with no real Meta key, AWS credentials,
or application configuration. A trusted relay keeps the real Meta key outside
the child and injects it only on requests to the fixed Muse API. The typing-mode agent may read `request.json`, `mode.ts`,
`reply.txt`, and `reference/**`, and may edit only `mode.ts` and `reply.txt`. Shell, Code Mode execution,
subagents, web tools, external directories, and configuration edits are denied.
Generated code is never executed by the backend. A separate trusted compiler
uses TypeScript and OpenCode's embedded Bun to check and bundle it. It accepts
exactly one default `CustomMode` class, plus allowed imports and erased helper types; additional classes,
top-level scripts, dynamic imports, and unsupported dependencies are rejected.
The class implements `PlayMode` with a `ModeContext` constructor. Pixi, Matter,
the engine type contract, and the existing writing helpers are available.
Source is limited to 128,000 bytes and compiled JavaScript to 256,000 bytes.

The Linux container runs the harness and its descendants through
`scripts/agent-sandbox.c`. Landlock ABI 3+ denies access to server secrets and
other users' files. Writes are confined to the current user/project job workspace
and its private runtime state; the configuration files and shared runtime code
are read-only. `/dev/null` is writable only for discarded subprocess output.
The existing tool permissions still limit edits to `mode.ts` and `reply.txt`, and
`WorkspaceGuard` rejects unexpected edits before compilation or persistence.

Seccomp denies direct network connections, DNS/UDP, abstract Unix sockets,
namespace changes, tracing, process-memory access, and replacement security
filters. Outbound sockets receive private Unix relay channels instead of real
unconnected IP sockets. The relay accepts only `POST /v1/responses` for the pinned
Muse model, verifies TLS, injects authentication, refuses redirects and remote
input resources, and rejects server-side network/execution tools. It never
forwards caller-selected destination hosts or authentication headers to Meta.

OpenCode v2 requires its own backend subprocess. The only internal-server
exception is that turn's private worker: its listener is bound by the parent to
a random loopback port, and only that registered port can be reached through the
turn's relay. This does not grant access to the app, DynamoDB, EC2 metadata, or
another turn's worker. The trusted supervisor starts the worker and client separately; neither may
spawn another process or leave its supervised process session. Both are killed
when the turn ends. Signals are restricted to each sandbox's own process.
The trusted compiler runs in a separate sandbox with networking fully disabled.
Missing kernel support or a missing sandbox binary aborts generation rather
than running without isolation.

The sandbox caps CPU time, file size, open descriptors, and process counts;
Compose also limits app memory, CPU, and PIDs. These are defense-in-depth limits,
not a claim that a kernel or runtime vulnerability is impossible. Production
requires a kernel with Landlock ABI 3+ and seccomp notification FD injection.
No extra Linux capabilities or Docker daemon socket are needed.

Run the adversarial fixture locally (fake keys, no paid model calls):

```sh
docker run --rm --read-only --cap-drop ALL --security-opt no-new-privileges:true \
  --tmpfs /tmp:size=256m,mode=1777 --network none --memory 1g --pids-limit 256 \
  -e PYTHONPATH=/app -v "$PWD/scripts:/app/scripts:ro" -v "$PWD/src:/app/src:ro" \
  taptaptap:local /app/.venv/bin/python /app/scripts/check_agent_sandbox.py
```

The fixture attempts secret reads, cross-user writes and links, metadata and
local-service requests, direct socket/syscall bypasses, process inspection, and
subprocess escape, then checks legitimate private-worker and compiler behavior.

Saved modes also have a dedicated full-page player at
`/play.html?mode=<project-id>`, linked from **Play full page** in the studio.
The page loads only the signed-in user's selected mode, with the original game
controls and no editor. Generated code stays in an opaque-origin sandbox. Play
keys pressed in the host page are forwarded into the game, while editor input,
modifier shortcuts, and composition events are excluded.

`scripts/build-mode-runtime.mjs` builds the preview from the original
`index.html`, shared `src/game.ts`, engine, and styles. Only the single mode class
changes. Libraries are bundled once in the trusted runtime, not regenerated or
stored per mode. The browser loads the class into the sandboxed frame with an
opaque origin, no API/network access, and in-memory preview preferences. The
normal game keeps its persisted settings and session timer. Completed artifacts
and chat are saved atomically in DynamoDB. Legacy HTML is shown unchanged until
the next edit asks the agent to convert it to the class contract.

There is one OpenCode turn per app process at a time and a 95-second deadline.
Timeouts kill its process group and discard temporary output. Failed turns keep
the previous saved mode and chat. The existing account and project rate limits
still apply. The UI polls an ownership-checked progress endpoint while a request
is running. A bounded in-memory activity log reports sanitized read/edit stages,
code checks, and saving, with an elapsed timer. Raw tool output, code, and model
reasoning are never returned by that endpoint. Token streaming and cancellation
are not implemented. User-facing labels call the service Meta Muse.

The studio discloses that prompts and mode code are sent to Meta for generation.
The pinned model is `meta/muse-wonder-1.0`. The former Muse CLI/host-worker integration has
been removed; no separate worker, Docker socket, or `AGENT_URL` is required.

The build and automated tests use no real Meta key and make no paid model
requests. Live Meta authentication requires the runtime key and has to be
validated separately from the local mock-provider checks.

## AWS repositories and containers

Use AWS CLI profile `appsme` in `ap-southeast-1` (Singapore).

- CodeCommit: `https://git-codecommit.ap-southeast-1.amazonaws.com/v1/repos/taptaptap`
- Private ECR: `399049857363.dkr.ecr.ap-southeast-1.amazonaws.com/taptaptap`

Work on `dev`. Push source with `git push -u origin dev`. This checkout uses
the AWS CLI CodeCommit credential helper with `appsme`. For a fresh checkout:

```sh
git -c credential.helper= -c 'credential.helper=!aws --profile appsme codecommit credential-helper $@' \
  -c credential.UseHttpPath=true clone \
  https://git-codecommit.ap-southeast-1.amazonaws.com/v1/repos/taptaptap
cd taptaptap
git config credential.https://git-codecommit.ap-southeast-1.amazonaws.com.helper ''
git config --add credential.https://git-codecommit.ap-southeast-1.amazonaws.com.helper \
  '!aws --profile appsme codecommit credential-helper $@'
git config credential.https://git-codecommit.ap-southeast-1.amazonaws.com.useHttpPath true
```

Build and preview the production container (Docker must be running):

```sh
docker build -t taptaptap:local .
docker run --rm -p 8080:8080 taptaptap:local
```

Open `http://localhost:8080`. FastAPI serves the built frontend and API. The
container needs AWS instance-role credentials for DynamoDB, or an explicitly
configured local DynamoDB endpoint with development credentials. Native local
development can use `AWS_PROFILE=appsme`; that profile is not copied into images.
Local defaults use console email delivery.

The image includes pinned OpenCode 2.1.4 and a `bun` command that runs the same
executable with `BUN_BE_BUN=1`, a [documented Bun feature](https://bun.com/docs/bundler/executables#running-the-executable-as-bun).
There is no separate Node.js or Bun installation. The build installs dependencies
from `bun.lock` (migrated from the existing pnpm lock with resolved versions
preserved) using `--frozen-lockfile`, then runs
TypeScript's `tsc --noEmit`, Vite, and the font-license copy script through that
runtime. Dependency install scripts are disabled. Downloaded OpenCode archives
are checked against pinned SHA-256 hashes for Linux ARM64 and AMD64.

```sh
docker run --rm --tmpfs /tmp:mode=1777 taptaptap:local opencode --version
docker run --rm --tmpfs /tmp:mode=1777 taptaptap:local bun --version
```

The final image also exposes Bun's TypeScript runner and bundler, so a writable
workspace can run `bun build input.ts --target browser --outdir dist` without
Node.js. The trusted runtime compiler also has read-only access to TypeScript,
frontend dependencies, and shared engine source. It type-checks generated modes
before bundling; Bun transpilation alone is insufficient.
OpenCode state defaults to `/tmp/opencode` for read-only container operation;
no provider credentials are baked into the image. Only the trusted relay receives
the real runtime Meta key; the harness receives a placeholder token.

To build behind a private certificate authority, pass its trusted bundle only
to build steps using a BuildKit secret:

```sh
docker build --secret id=build_ca,src="$SSL_CERT_FILE" -t taptaptap:local .
```

To publish an image, choose a unique tag; ECR prevents overwriting tags and scans
images on push. The `vera` server uses Linux ARM64:

```sh
registry=399049857363.dkr.ecr.ap-southeast-1.amazonaws.com
tag=$(git rev-parse --short HEAD)
aws ecr get-login-password --profile appsme --region ap-southeast-1 \
  | docker login --username AWS --password-stdin "$registry"
docker build --platform linux/arm64 -t "$registry/taptaptap:$tag" .
docker push "$registry/taptaptap:$tag"
```

CodeCommit stores source and ECR stores container images. Pull the tagged image
on your EC2 instance and supply the environment and instance role described
above. The current deployment uses `compose.vera.yaml` on `vera`.

## Contribute a world

See [CONTRIBUTING.md](CONTRIBUTING.md) for the mode contract and a minimal example. Shared services live in `src/engine/`, worlds in `src/modes/`, and the HTML interface in `index.html` and `src/main.ts`.

## Design direction

Large letters, restrained colour, tactile sound, and playful systems inspired by Yugo Nakamura’s exploration of motion and simple rules. Every key should feel consequential. Keep controls quiet and leave room for discovery.

## Licenses

The application has no open-source license selected yet. Fredoka is distributed under the SIL Open Font License; see `node_modules/@fontsource-variable/fredoka/LICENSE` and the bundled font license in production output. Library licenses remain with their respective packages.

The GitHub icon is from [Primer Octicons](https://github.com/primer/octicons), distributed under the [MIT license](public/licenses/octicons.txt).
