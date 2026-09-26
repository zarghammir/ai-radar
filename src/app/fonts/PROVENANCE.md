# Vendored web fonts — where each byte came from, and under what licence

These files are committed so that `next build` reaches NOTHING over the network for
fonts. `next/font/google` fetched them from fonts.gstatic.com on every build, which
made every build depend on Google being reachable; four of this week's five red CI
runs were that fetch failing, each one green on a re-run with no code changed (#160).

EVERY FILE HERE IS BYTE-IDENTICAL TO WHAT THE BUILD DOWNLOADED BEFORE. Nothing is
subset, re-compressed or converted, so no glyph any reader sees changes. That is
checkable rather than asserted: `node scripts/verify-vendored-fonts.mjs` recomputes
every sha256 below and fails if one moved.

LICENCE. All three families are under the SIL Open Font License 1.1, whose text is
beside the files it covers. OFL 1.1 permits redistribution provided the licence
travels with the fonts, which is what these three .txt files are for. This project is
MIT; the two do not conflict, because the OFL covers the font files alone.

Fetched 2026-09-26. Licences from the google/fonts repository, which is the projects' own
distribution point; font binaries from the Google Fonts CSS API, which is the exact
source next/font/google used, so the bytes are the ones that were already shipping.

## Archivo

- Licence: SIL Open Font License 1.1 — `Archivo-OFL.txt`
- Licence source: https://github.com/google/fonts/blob/main/ofl/archivo/OFL.txt
- Axis vendored: wght 100..900 (variable)
- CSS request next/font/google made: `https://fonts.googleapis.com/css2?family=Archivo:wght@100..900&display=swap`

### archivo-vietnamese.woff2

- subset: vietnamese
- bytes: 13216
- sha256: 2518e8eb97cd2b36dbf380d085e47bbc0df5c32fc6adc32fe1ca6edce192cee0
- source: https://fonts.gstatic.com/s/archivo/v25/k3kPo8UDI-1M0wlSV9XAw6lQkqWY8Q82sLySOxKsv4RnUPU.woff2
- unicode-range: U+0102-0103, U+0110-0111, U+0128-0129, U+0168-0169, U+01A0-01A1, U+01AF-01B0, U+0300-0301, U+0303-0304, U+0308-0309, U+0323, U+0329, U+1EA0-1EF9, U+20AB

### archivo-latin-ext.woff2

- subset: latin-ext
- bytes: 32672
- sha256: a999e009fdcd0f939c138e04043b3b2ad083b26252b644e8f94c083d48b77af0
- source: https://fonts.gstatic.com/s/archivo/v25/k3kPo8UDI-1M0wlSV9XAw6lQkqWY8Q82sLyTOxKsv4RnUPU.woff2
- unicode-range: U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF

### archivo-latin.woff2

- subset: latin
- bytes: 34940
- sha256: 7150c0ec5ad356453013d11affec1fbab95de0dd2dcecb043b4f1cb7f87c4ba4
- source: https://fonts.gstatic.com/s/archivo/v25/k3kPo8UDI-1M0wlSV9XAw6lQkqWY8Q82sLydOxKsv4Rn.woff2
- unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD

## Archivo Narrow

- Licence: SIL Open Font License 1.1 — `ArchivoNarrow-OFL.txt`
- Licence source: https://github.com/google/fonts/blob/main/ofl/archivonarrow/OFL.txt
- Axis vendored: wght, used at 600 and 700
- CSS request next/font/google made: `https://fonts.googleapis.com/css2?family=Archivo+Narrow:wght@600;700&display=swap`

WHY THERE ARE THREE FILES HERE AND NOT SIX. Archivo Narrow is the one family this app
does NOT use as a variable font: layout.tsx asks for weight ["600", "700"]. Google
answers that with SIX @font-face blocks — 600 and 700 for each of three subsets — but
only THREE distinct files, because it serves one variable file per subset and declares
it twice at different font-weight values. That is Google's doing, not ours. The two
requests' files were hashed against each other and are identical, which is the evidence
for collapsing them to one localFont call per subset carrying weight "600 700".

If Google ever ships a genuinely static or genuinely variable Narrow, the DESCRIPTORS
change and this file count does not. Whoever meets that should not have to re-derive it.

### archivo-narrow-vietnamese.woff2

- subset: vietnamese
- bytes: 6360
- sha256: 36bb8d196c131c6403e9f745d398643b0fa42fc9292c374635a4f2009d4953f2
- source: https://fonts.gstatic.com/s/archivonarrow/v35/tss0ApVBdCYD5Q7hcxTE1ArZ0bb_iXxw2d8oBxk.woff2
- unicode-range: U+0102-0103, U+0110-0111, U+0128-0129, U+0168-0169, U+01A0-01A1, U+01AF-01B0, U+0300-0301, U+0303-0304, U+0308-0309, U+0323, U+0329, U+1EA0-1EF9, U+20AB

### archivo-narrow-latin-ext.woff2

- subset: latin-ext
- bytes: 16580
- sha256: db821b657f1d6b362a8bbddb4452073d156cea76854a157d3b33b4a999fcebfa
- source: https://fonts.gstatic.com/s/archivonarrow/v35/tss0ApVBdCYD5Q7hcxTE1ArZ0bb-iXxw2d8oBxk.woff2
- unicode-range: U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF

### archivo-narrow-latin.woff2

- subset: latin
- bytes: 18724
- sha256: 728b32e94fd137eca605f80d3c34adeaeef0d312425c7a5a1ff743407b2d78f9
- source: https://fonts.gstatic.com/s/archivonarrow/v35/tss0ApVBdCYD5Q7hcxTE1ArZ0bbwiXxw2d8o.woff2
- unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD

## JetBrains Mono

- Licence: SIL Open Font License 1.1 — `JetBrainsMono-OFL.txt`
- Licence source: https://github.com/google/fonts/blob/main/ofl/jetbrainsmono/OFL.txt
- Axis vendored: wght 100..800 (variable)
- CSS request next/font/google made: `https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@100..800&display=swap`

### jetbrains-mono-cyrillic-ext.woff2

- subset: cyrillic-ext
- bytes: 2020
- sha256: 992eea2f70210457ddd1196de4df3240919ffe068ad188c79d985fba4565d3bf
- source: https://fonts.gstatic.com/s/jetbrainsmono/v24/tDbV2o-flEEny0FZhsfKu5WU4xD2OwGtT0rU3BE.woff2
- unicode-range: U+0460-052F, U+1C80-1C8A, U+20B4, U+2DE0-2DFF, U+A640-A69F, U+FE2E-FE2F

### jetbrains-mono-cyrillic.woff2

- subset: cyrillic
- bytes: 12064
- sha256: af7486955880be1c2b972e9c766acffb776768d669b6576ed9a0919ce72e7ca6
- source: https://fonts.gstatic.com/s/jetbrainsmono/v24/tDbV2o-flEEny0FZhsfKu5WU4xD_OwGtT0rU3BE.woff2
- unicode-range: U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116

### jetbrains-mono-greek.woff2

- subset: greek
- bytes: 9084
- sha256: 3edf363dbf9d5fa0cdc784ae2b431a8a4152f4055a8a8858028c0bd668808273
- source: https://fonts.gstatic.com/s/jetbrainsmono/v24/tDbV2o-flEEny0FZhsfKu5WU4xD4OwGtT0rU3BE.woff2
- unicode-range: U+0370-0377, U+037A-037F, U+0384-038A, U+038C, U+038E-03A1, U+03A3-03FF

### jetbrains-mono-vietnamese.woff2

- subset: vietnamese
- bytes: 7468
- sha256: 1390e86cc2823e759358918c01c4fcc1b6e4f01bca915bdbeb6d68eb5c244405
- source: https://fonts.gstatic.com/s/jetbrainsmono/v24/tDbV2o-flEEny0FZhsfKu5WU4xD0OwGtT0rU3BE.woff2
- unicode-range: U+0102-0103, U+0110-0111, U+0128-0129, U+0168-0169, U+01A0-01A1, U+01AF-01B0, U+0300-0301, U+0303-0304, U+0308-0309, U+0323, U+0329, U+1EA0-1EF9, U+20AB

### jetbrains-mono-latin-ext.woff2

- subset: latin-ext
- bytes: 15204
- sha256: 7db7affbce1fdee69c1ffc2641bbca289b049867f524c9d861fe35ab6670bf29
- source: https://fonts.gstatic.com/s/jetbrainsmono/v24/tDbV2o-flEEny0FZhsfKu5WU4xD1OwGtT0rU3BE.woff2
- unicode-range: U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF

### jetbrains-mono-latin.woff2

- subset: latin
- bytes: 40480
- sha256: 1e06740a02a443fb7f3eeda8fcaa685a0f6c620e3f01e6666e847295469ce3ad
- source: https://fonts.gstatic.com/s/jetbrainsmono/v24/tDbV2o-flEEny0FZhsfKu5WU4xD7OwGtT0rU.woff2
- unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD

## Totals

12 files, 208812 bytes in the repository.

WHAT A READER DOWNLOADS IS UNCHANGED, because every unicode-range above is preserved:
a browser fetches only the subsets its text needs. A reader of latin-only text
downloads 94,144 bytes before this change and 94,144 bytes after it.
