# mira-ui

<img width="3824" height="912" alt="mira-ui-overview" src="https://github.com/user-attachments/assets/afe75e33-2c2f-496d-b29e-6c84b292d14f" />


Frontend for the Mira project, a free and open-source standalone firmware for the Spotify Car Thing.

React + TypeScript + Vite.

Part of [Mira](https://github.com/mira-thing).

## Related projects

- [`mira-daemon`](https://github.com/mira-thing/mira-daemon) - daemon
- [`mira-voice`](https://github.com/mira-thing/mira-voice) - on-device voice stack
- [`mira-firmware`](https://github.com/mira-thing/mira-firmware) - image builder
- [`mira-releases`](https://github.com/mira-thing/mira-releases) - prebuilt firmware images
- [`mira-ui`](.) - Vite + React UI (this repo)

## Support

Mira is free and open source. If you'd like to support development, you can do so on [GitHub Sponsors](https://github.com/sponsors/MustakimK) or [Ko-fi](https://ko-fi.com/MustakimK). Questions and updates are on [Discord](https://discord.gg/SR2Pne7EPM).

## Development

| Command                 | Purpose                      |
| ----------------------- | ---------------------------- |
| `npm run dev`           | Vite dev server with HMR     |
| `npm run build`         | Production build to `dist/`  |
| `npm run lint`          | ESLint                       |
| `npm run typecheck`     | `tsc -b --noEmit`            |
| `npm test`              | Run vitest suite             |
| `npm run test:watch`    | Vitest in watch mode         |
| `npm run test:coverage` | Coverage report              |
| `npm run fonts`         | Regenerate the font CSS      |
| `npm run fonts:refresh` | Re-fetch fonts from upstream |

screen switcher is available when holding down the (`` ` ``) key for iterating on individual UI states without a live daemon.

### Browser target

The Car Thing's Chromium is Chrome 69 (2018), so the production bundle uses `@vitejs/plugin-legacy` to emit a compatible build. The modern bundle is disabled in `vite.config.ts` since it's never shipped.

### Fonts

The Car Thing image ships exactly one system font (Bitstream Vera), so any script without a bundled webfont renders as tofu. Mira bundles every script Unicode CLDR classifies as in living use, plus colour emoji. `@font-face` rules and the `font-family` stack are generated from [`tools/fonts/manifest.json`](tools/fonts/manifest.json) by `npm run fonts`, which runs automatically before `dev`, `build` and `test`.

Every font is committed and served from the device's own filesystem — nothing is ever fetched from the network at runtime. Each non-Latin face is gated on `unicode-range`, so a font is only read when its script actually appears on screen; that is what makes 65 script families affordable on a 512 MB device.

See [`tools/fonts/README.md`](tools/fonts/README.md) for which scripts are included and why, how to add one, and why ranges are derived from each font's `cmap` rather than its filename.

## License

Apache 2.0, see [LICENSE](LICENSE).

Bundled fonts (Inter, Noto) are licensed under the SIL Open Font License 1.1 — see [`public/fonts/OFL.txt`](public/fonts/OFL.txt) and [`public/fonts/NOTICE`](public/fonts/NOTICE).

> "Spotify" and "Car Thing" are trademarks of Spotify AB. This software is not affiliated with or endorsed by Spotify AB.
