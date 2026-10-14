# Northstar client bundles used by TFX

These are third-party Northstar clients, not original TFX executable code. Retained executable, plugin and core-mod file bytes are unchanged from the official client releases. The optional Global DiscordRPC plugin is excluded from TFX 1.0.0 because its independent redistribution license is not declared in the inspected source. TFX selects and verifies the appropriate client before launch. The clients are stored as compressed payloads to limit portable-download and installed-launcher size.

## Bundle layout

Each `cn` or `global` directory contains `manifest.json` and `payload.zip`. The manifest has `schemaVersion: 1`, `channel`, `version`, `profile: "R2Northstar"`, the three official `ownedDirectories`, and a `files` array of `{path, size, sha256}`. The `archive` record contains `{path: "payload.zip", format: "zip", size, sha256}`. ZIP paths are game-root-relative. Runtime extraction must use a verified external cache and must check every manifest file before installation. Source provenance is recorded in `source`.

The three replaceable core directories are `R2Northstar/mods/Northstar.Client`, `R2Northstar/mods/Northstar.Custom`, and `R2Northstar/mods/Northstar.CustomServers`. Files outside those directories are limited to the explicitly named official loader, DLL, plugin and legal-document paths in the manifests. User mods, packages, settings, enabled-mod state and saves are not included in these bundles.

PDB symbols, dedicated-server stubs and `r2ds.bat` were omitted because this is a game-client launcher. `ns_startup_args*.txt` and the dedicated placeholder player-data file were omitted so switching clients does not overwrite the user's startup options or profile data. Client libraries, licensed official plugins, core mods and client-side resources are retained. The optional Discord Rich Presence plugin omitted from the Global bundle is explicitly recorded in `source.optionalOmissions` with its original path, size and SHA-256.

## Global client 1.31.13

Official release: <https://github.com/R2Northstar/Northstar/releases/tag/v1.31.13>

Official archive: <https://github.com/R2Northstar/Northstar/releases/download/v1.31.13/Northstar.release.v1.31.13.zip>

Original official archive SHA-256: `e622b96e7609912060a61ba3eed382eeafd6cc7b62c105ea609a36bc36e75322`, verified against the GitHub release asset's published digest. The user-supplied Thunderstore package `northstar-Northstar-1.31.13.zip` has a `Northstar/` wrapper; the 827 files retained for TFX 1.0.0 match the official archive byte for byte after removing that wrapper. The TFX payload ZIP is a filtered bundle, and its distinct hash is recorded in `archive.sha256`.

The global client DLL is `R2Northstar/Northstar.dll`. The TFX bundle includes the official `bin/x64_retail/wsock32.dll`, three core mods and the `ranim.dll` and `serialized_io.dll` plugins. It excludes `DiscordRPC.dll`; that optional plugin supplies Discord Rich Presence, not the Northstar multiplayer core. The bundle does not include the CN root-level `Northstar.dll` or `launcher.dll`. A channel switch must remove obsolete alternate-client files and the omitted official plugin from the active profile rather than just change the master-server address. Existing copies are transactionally backed up. User-downloaded official full updates are installed unchanged and may include the plugin; TFX's release does not redistribute those downloaded bytes.

The release's exact `R2Northstar/LEGAL.txt` and core-mod `LICENSE`, `README.md` and `CONTRIBUTING.md` are retained. A duplicate of `LEGAL.txt` is available under `licenses/GLOBAL-LEGAL.txt`; it contains the Northstar client MIT notice and the upstream curl, httplib, MinHook, OpenSSL, RapidJSON, spdlog and font notices.

`ranim` and `serialized_io` declare Apache-2.0 in their official source manifests: <https://github.com/R2Northstar/NorthstarPlugins>. The Apache-2.0 text is included under `licenses/APACHE-2.0.txt`. The DiscordRPC source is <https://github.com/R2Northstar/NorthstarDiscordRPC>. On 2026-10-14, its public main tree contained no license file, its Cargo manifest declared no license, and GitHub repository metadata reported `license: null`. TFX 1.0.0 therefore does not bundle that binary or claim the main client's MIT notice licenses it. A future bundled inclusion requires an explicit applicable upstream license or permission.

## China client 1.17.7 LTS

Official release: <https://github.com/R2NorthstarCN/R2NorthstarCN_Launcher/releases/tag/v1.17.7>

Official archive: <https://github.com/R2NorthstarCN/R2NorthstarCN_Launcher/releases/download/v1.17.7/v1.17.7.zip>

Archive SHA-256: `a42e9d364509d30ecf5e951c373f9547a28a9985a79d6f698751764216a946d2`. It was downloaded directly from the official asset URL. This older GitHub asset does not publish a digest, so the recorded hash is a local integrity record rather than an upstream signature.

The China client has root-level `Northstar.dll`, `NorthstarLauncher.exe` and `launcher.dll`, plus its own `bin/x64_retail/wsock32.dll` and three core mods. It has no plugins in this release. It is the portable fallback; it must not be presented as version 1.18.0 or used to silently overwrite a separately preserved, recognized local 1.18.0 installation.

The official release build workflow removes core-mod license files. TFX restores the MIT core-mod `LICENSE` obtained from the official NorthstarCN source repository; executable and core-mod functional bytes are unchanged. Copies of the project, launcher-code and core-mod MIT notices are retained under `licenses/CN-LICENSE.txt`, `CN-CODE-LICENSE.txt`, and `CN-MODS-LICENSE.txt`.

Source projects: <https://github.com/R2NorthstarCN/R2NorthstarCN_Launcher>, <https://github.com/R2NorthstarCN/NorthstarLauncher>, and <https://github.com/R2NorthstarCN/NorthstarMods>.

Additional notices were obtained from the public NorthstarCN source's recorded curl, MinHook and minizip submodule commits and from its bundled fmt license. These are `CN-curl-COPYING.txt`, `CN-minhook-LICENSE.txt`, `CN-minizip-LICENSE.txt`, and `CN-FMT-LICENSE.rst`. RapidJSON and spdlog notice text is supplemented from their upstream projects under `CN-RAPIDJSON-LICENSE.txt` and `CN-SPDLOG-LICENSE.txt`, consistent with the copyright/license headers in the public CN source. The CN binary release does not provide a reproducible source-commit manifest; these supplemental notices are not claimed to prove its complete build dependency set.

No user's game directory, private mods, personal configuration, credentials, skin packages or local CN snapshot is distributed inside this product directory.
