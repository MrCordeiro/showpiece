# Contributing to showpiece

Thank you for your help! ✧*｡٩(ˊᗜˋ*)و✧*｡

## Issues

Found a bug? Did a flow fail in a way that the diagnostics do not explain? [Open an issue](https://github.com/MrCordeiro/showpiece/issues/new/choose). This is the fastest way to get an answer.

For a `capture` bug, attach `.showpiece/diagnostics/last-run.json`. It shows the failed step and the error code, and it usually tells us more than a long description.

## Feature requests

Request a feature with the [feature request template](https://github.com/MrCordeiro/showpiece/issues/new?template=feature_request.yml). Every idea is welcome. Tell us as much as you can about the why: what you try to do, and what you do today instead.

The planned work has the [`roadmap`](https://github.com/MrCordeiro/showpiece/labels/roadmap) label. If you need one of these items, comment on its issue. The comments decide what comes next.

## Code contributions

Bug fixes, better error messages, flow recipes and docs are always welcome.

For a new feature, open an issue first, also when it is on the roadmap. Then we agree on the approach before you write the code, and two people do not do the same work. A good feature makes store screenshots easier for React Native and Expo developers.

If you are not sure, open an issue and ask. We answer quickly.

### Local setup

You need Node.js 22.12 or later. To run `capture`, you also need `maestro`, `adb` and an Android emulator (see the [README](README.md#quickstart)).

```bash
git clone https://github.com/MrCordeiro/showpiece.git
cd showpiece
npm install
npm test
```

> [!IMPORTANT]
> On Windows, turn on Developer Mode (or run Git as administrator) and clone with `git clone -c core.symlinks=true ...`. Otherwise Git checks out the `.claude/skills` symlink as a text file, and Claude Code does not find the skills in `.agents/skills/`.

To try your build in an app repo:

```bash
npm pack                                        # builds dist/ and writes showpiece-<version>.tgz
cd ../your-app
npm install --save-dev ../showpiece/showpiece-<version>.tgz
npx showpiece --help
```

### Pull requests

1. Create a branch from `main`.
2. Add or update tests for any behavior that you change.
3. Run the checks that CI runs:

   ```bash
   npm run lint && npm run typecheck && npm test && npm run build
   ```

4. Use a Conventional Commits message, for example `fix(capture): ...`.
5. Open the PR and fill in the template.

If your change removes or renames a CLI flag, a config field, a folder under `.showpiece/` or an error code (`E_*`), say so in the PR. Users' configs and scripts depend on these.
