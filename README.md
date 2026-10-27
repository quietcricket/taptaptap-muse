# taptaptap

[Play taptaptap](https://quietcricket.github.io/taptaptap/) · [Source and contributions](https://github.com/quietcricket/taptaptap)

A little world for every key. A keyboard playground for children who enjoy pressing keys and watching things happen. No lessons, scores, accounts, or tracking.

Built with TypeScript, Vite, PixiJS, Matter.js, and plain HTML/CSS controls. Fredoka is bundled locally through Fontsource; sound effects are synthesized with Web Audio. Nothing is sent to a server while playing.

## Run locally

Use Node.js 22.12+ (or a compatible newer release) and pnpm 11.10.0.

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

GitHub Actions runs tests and builds the game only on pushes to `main` or manual runs targeting `main`. Pull requests and pushes to other branches do not trigger the workflow. Successful pushes to `main` publish `dist/` to [GitHub Pages](https://quietcricket.github.io/taptaptap/). The pipeline is in `.github/workflows/pages.yml` and uses the pnpm version declared in `package.json`. A deployment can also be started from the workflow's **Run workflow** button with `main` selected; manual runs on other branches skip all jobs.

To configure a fork, enable **Settings → Pages → Build and deployment → Source: GitHub Actions** and update the links above and the canonical/social preview URLs in `index.html` to your own account and repository. No deployment secrets are required; GitHub supplies the scoped workflow token.

You can also deploy `dist/` to any static web host. The build uses relative asset paths so it can also live under a repository subdirectory.

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

Open `http://localhost:8080`. The build runs `pnpm build` and serves the static
output through an unprivileged Nginx server. No application secrets are needed.

To publish an image, choose a unique tag; ECR prevents overwriting tags and scans
images on push. This example targets Linux AMD64; choose the platform to match
your eventual container host:

```sh
registry=399049857363.dkr.ecr.ap-southeast-1.amazonaws.com
tag=$(git rev-parse --short HEAD)
aws ecr get-login-password --profile appsme --region ap-southeast-1 \
  | docker login --username AWS --password-stdin "$registry"
docker build --platform linux/amd64 -t "$registry/taptaptap:$tag" .
docker push "$registry/taptaptap:$tag"
```

CodeCommit stores source and ECR stores container images. Hosting the running
container requires a separate deployment service; no AWS runtime is configured.

## Contribute a world

See [CONTRIBUTING.md](CONTRIBUTING.md) for the mode contract and a minimal example. Shared services live in `src/engine/`, worlds in `src/modes/`, and the HTML interface in `index.html` and `src/main.ts`.

## Design direction

Large letters, restrained colour, tactile sound, and playful systems inspired by Yugo Nakamura’s exploration of motion and simple rules. Every key should feel consequential. Keep controls quiet and leave room for discovery.

## Licenses

The application has no open-source license selected yet. Fredoka is distributed under the SIL Open Font License; see `node_modules/@fontsource-variable/fredoka/LICENSE` and the bundled font license in production output. Library licenses remain with their respective packages.

The GitHub icon is from [Primer Octicons](https://github.com/primer/octicons), distributed under the [MIT license](public/licenses/octicons.txt).
