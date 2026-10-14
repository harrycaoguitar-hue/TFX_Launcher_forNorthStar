# Building TFX Launcher 1.0.0

The entry point is src/index.js. The application package and native Windows metadata use version 1.0.0. The public build configuration targets Windows x64 and keeps required archive tools and official client bundles outside ASAR.

## Requirements

- Windows x64 with Node.js 22.12 or later (the release validation used Node.js 24.19.0).
- npm and access to npm, GitHub and the official Electron / builder download endpoints.
- Electron 43.1.1 and electron-builder 26.15.3 are pinned in package.json and package-lock.json.

## Commands

Run from the source root:

```powershell
npm ci
npm test
npm start
npm run dist
```

The portable application is written to dist/TFX-Launcher-1.0.0.exe. The distribution is unsigned. Signing requires the publisher's own certificate and is not configured in this source. The supplied source archive also retains the exact production dependency files and their supplemental license notices used in the delivered build. npm ci obtains the same pinned package versions from their public registries.

The development release was assembled from a verified Electron 43.1.1 runtime with native resources en-US, zh-CN, zh-TW, de and fr; native metadata and the TFX icon were applied before portable wrapping. A standard npm run dist build may retain additional Electron language resources, so compressed bytes need not be identical. No private build paths or signing credentials are required by the public build configuration.

## Data and behavior

The existing fold.json name is retained for upgrade compatibility. Saved preferences remain under the Windows application data folder. Northstar download caches and transaction data, Thunderstore caches, and some mod-state backups prefer D:/TFX-Launcher-Data when D: exists. DDS / VTF skin backups and cross-format recovery records remain under fold-launcher in Windows application data; prepared client-switching files also use the .tfx area inside the game folder. Use Open backup folder on each skin page to locate its actual storage. Do not delete active recovery journals or client slots.

NorthstarCN 1.17.7 and Northstar 1.31.13 provide offline first-install bundles. Existing newer recognized local clients are preserved. The optional Global DiscordRPC.dll is excluded because its independent redistribution license was not declared by the inspected upstream source. Retained official files are unchanged and each is hashed in its manifest. Runtime downloads of official full updates retain their original contents. See src/tools/clients/SOURCE.md.

DDS ZIP extraction uses the same bounded, path-validated, CRC-checked ZIP reader as local mod imports. The old unzip-stream dependency and seven now-unused package directories were removed. VTF archive extraction retains the bundled 7-Zip licenses and unRAR terms.

The skin protection switch restores two previously captured user settings before launch. These are the user's recorded values, not a universal certified quality preset. It does not lock the game's UI. Incomplete installation transactions block launch even when the preference is off.

## Tests and release evidence

Tests run in owned temporary directories and must not be pointed at a user's live game for destructive fixture cases. Set TEMP and TMP to a spacious drive before running the suite if necessary. The release audit separately records renderer interaction tests, five-language native runs, official bundle switching, real sample imports, network reads and bounded real-game checks. Read the final release audit for observed outcomes and limits; passing unit tests alone does not establish online gameplay compatibility.

Preserve GPL and third-party notices when redistributing. Source files, tool licenses, client manifests and dependency versions are included. A source ZIP matching the released EXE should accompany the GitHub release.
