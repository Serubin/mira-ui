# Fonts

Mira renders track titles, artists, lyrics and device names that come from Spotify and from paired
devices, so they can be in any script. The Car Thing has no OS-level safety net: the firmware image
copies exactly one system font into the rootfs (`ttf-bitstream-vera`, see
`mira-firmware/resources/stock-files/download.sh`), so **any script not covered by a bundled webfont
renders as tofu**. This directory generates the coverage.

## Layout

| Path             | Role                                                                            |
| ---------------- | ------------------------------------------------------------------------------- |
| `config.mjs`     | Hand-maintained policy: which scripts ship, subset filtering, collision winners |
| `generate.mjs`   | Maintenance script. Hits the network, rewrites `manifest.json`                  |
| `sync.mjs`       | Build step. Reads `manifest.json`, emits the SCSS, verifies hashes              |
| `manifest.json`  | Generated, committed. One entry per face: file, range, hash, copyright          |
| `lib/sfnt.mjs`   | WOFF2/SFNT reader — `cmap`, `name`, colour-format detection                     |
| `lib/ranges.mjs` | CSS `unicode-range` ↔ codepoint set conversions                                 |
| `lib/emit.mjs`   | Renders `@font-face` rules and the `font-family` stack                          |
| `lib/notice.mjs` | Builds the OFL attribution notice                                               |
| `vendor/`        | CLDR script-usage snapshot — the audit trail for the inclusion decision         |

Generated outputs, both gitignored and rewritten on every build:
`src/styles/_font-faces.generated.scss` and `src/styles/_font-stack.generated.scss`.

## What ships

Which scripts are included comes from CLDR's UAX #31 `ID_USAGE` field: `RECOMMENDED` and
`LIMITED_USE` are scripts in living use and ship; `EXCLUSION` marks historic scripts (Cuneiform,
Egyptian Hieroglyphs, Linear A/B, Gothic …) and those are left out — a track title is not going to be
in Cuneiform, and every file costs space on a partition that is already slimmed to fit. `config.mjs`
adds a short `ALWAYS_INCLUDE` list, since CLDR classifies Mongolian as `EXCLUSION` despite everyday
use in Inner Mongolia.

Every font is committed under `public/fonts/`, so builds are offline
and the device only ever reads fonts off its own filesystem.

|                                   | faces  | size         |
| --------------------------------- | ------ | ------------ |
| Pinned Inter + CJK (pre-existing) | 8      | 21.77 MB     |
| Living scripts (64 faces)         | 64     | 3.41 MB      |
| Colour emoji                      | 1      | 10.67 MB     |
| **Total**                         | **73** | **35.86 MB** |

The rootfs is capped at 516 MiB and `mira-firmware/scripts/stages/30/35-slim-rootfs.sh` already
deletes files to fit when voice is bundled, so `src/__tests__/fonts.test.ts` asserts a byte budget.

## Nothing is fetched at runtime

Every `@font-face` `src` is a root-relative `/fonts/…` path, served by `static-web-server --root
/etc/mira/ui` off the device's own filesystem. No Google Fonts URL reaches the device: the upstream
download URLs live only in `manifest.json`, which stays in `tools/` and is never copied into
`public/`. `generate.mjs` is the only thing here that touches the network, and it is a maintenance
script you run by hand. Four tests in `src/__tests__/fonts.test.ts` enforce this.

## Regenerating

```
node tools/fonts/generate.mjs --dry   # report only
node tools/fonts/generate.mjs         # rewrite the manifest and download files
```

Then commit `manifest.json`, the refreshed `vendor/cldr-scriptMetadata.txt`, any new files under
`public/fonts/`, and the regenerated `public/fonts/NOTICE`.

Adding a script is usually just a re-run: if upstream Noto gains a family, `generate.mjs` picks it
up and classifies it from CLDR. If it collides with an existing family on a subset the run **fails** and
names both — add the winner to `SUBSET_FAMILY_PREFERENCE` in `config.mjs` with a reason.

## Why it works this way

**Ranges come from the font, not the filename.** Every declared `unicode-range` is intersected with
the font's real `cmap`. The hand-written CSS this replaced shipped `NotoSansGK-VF.woff2` as
`'Noto Sans Greek'` with `unicode-range: U+0370-03FF`, but that file is Gurmukhi and contains zero
Greek codepoints — so Greek downloaded 112 KB it could not use, and Punjabi never rendered at all.
Google's declared ranges also describe the subset _family_ rather than the individual file, so they
over-claim; intersecting stops the browser fetching a face for a codepoint it cannot draw.

**Every face is gated on `unicode-range`.** That is what keeps 60+ script fonts off a 512 MB device:
the browser only fetches a face when a codepoint in its range is actually rendered, so a listener
playing English-titled music pays nothing for Khmer. A face _without_ a range downloads eagerly for
any text — Google serves a few unsubsetted families (e.g. Noto Sans Math) that way, so the generator
derives a range from the `cmap` for those too.

**One family per script, declared explicitly.** Where several families claim the same subset — four
provide Arabic, a dozen carry Google's shared `math` and `symbols` slices — `config.mjs` names the
winner. `generate.mjs` fails on any collision that is not listed, because the alternative is
font-family stack order silently deciding which font renders a script.

**Latin is not duplicated 160 times.** Each family's Latin/Greek/Cyrillic slices are dropped, except
from one designated supplementary family. That matters more than it looks: Inter covers `latin` and
`cyrillic` fully but only 44.6% of `cyrillic-ext`, 62.5% of `latin-ext` and 77.8% of `greek`, so
dropping those outright would have _lost_ glyphs (Old Church Slavonic, IPA extensions, archaic
Greek).

**CJK files are pinned, their ranges are not.** The four CJK `.woff2` files are reproduced
byte-for-byte from before this pipeline existed — replacing them is a separate decision. Their
`unicode-range`s in `config.mjs` state the intended scope (the CJK blocks, deliberately _not_ each
font's full cmap, which also contains Latin) and are then intersected with the real cmap like every
other face. As originally hand-written they over-claimed by 8,195 codepoints for JP and 12,074 for
TC, so those codepoints each triggered a 4–5 MB download that produced no glyph.

**Emoji must be CBDT.** The Car Thing runs Chrome 69, which supports CBDT bitmap emoji and COLRv0 but
not COLRv1 (Chrome 98+). Google Fonts' Noto Color Emoji is COLRv1 and would render as flat outlines,
so we take the legacy CBDT build from the `noto-emoji` repo. Both `generate.mjs` and `sync.mjs`
assert the format, so an upstream reformat cannot silently ship broken emoji.

## Licensing

Inter and every Noto font is OFL 1.1, which requires the license text and copyright notices to
accompany the fonts wherever they are redistributed — and Mira redistributes them inside the
firmware image. `public/fonts/OFL.txt` and `public/fonts/NOTICE` are generated and land on-device via
`dist/` → `ui.zip` → `/etc/mira/ui`. The notices are read out of each font's own `name` table, so
they cannot drift.
