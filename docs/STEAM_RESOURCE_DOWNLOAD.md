# Selective Steam resource recovery

TFX's repair adapter can obtain a missing Titanfall 2 skin resource without asking Steam to verify the entire game. It downloads only the exact STARPAK or common VPK filenames selected from the currently installed Steam depot manifest. A separate cache directory holds the download; the adapter never writes to the installed game. The DDS/VTF recovery engine verifies the source again and preserves installed skin records when applying the repair.

This optional path requires ownership of Titanfall 2 on Steam and sign-in through the Steam mobile application's QR scanner. A full missing container can still be large: `pc_stream.starpak` in the tested manifest is approximately 10.4 GiB. The plan reports the download size, and the adapter requires room for the resource, its temporary staging copy, and 512 MiB of helper/runtime headroom. A complete local original source is preferable when available.

## Optional external program

The external downloader is **DepotDownloader**, maintained by the SteamRE community. It is not a Valve or Electronic Arts program. TFX invokes the unmodified official SteamRE release through its public command-line interface; TFX does not incorporate its C# source into the launcher. Steam remains the provider of the authenticated game resource bytes.

- Project and source: <https://github.com/SteamRE/DepotDownloader>
- Pinned release: `DepotDownloader_3.4.0`
- Release: <https://github.com/SteamRE/DepotDownloader/releases/tag/DepotDownloader_3.4.0>
- Windows x64 ZIP: <https://github.com/SteamRE/DepotDownloader/releases/download/DepotDownloader_3.4.0/DepotDownloader-windows-x64.zip>
- ZIP length: `33474005` bytes
- ZIP SHA-256: `41c9e9f0df54b3ad02e67a11726756e5c73283bd7c2e1b04acfa5ae4c2ed3767`
- Extracted executable SHA-256: `6281279efce8f1e20db9532a58e42382f81afb9e3827a8b965ffcb43fbe4531f`
- Upstream license: GNU General Public License version 2, <https://github.com/SteamRE/DepotDownloader/blob/DepotDownloader_3.4.0/LICENSE>

The downloader is fetched only when the optional Steam download action is chosen. It is not bundled in TFX's application package. Its original `LICENSE` accompanies the cached executable. The official release includes its own dependencies, including SteamKit2 and QRCoder; their source and license declarations are available through the pinned upstream source and project dependencies.

## Isolation and validation

Every job uses a fresh directory for the payload, file list, temporary files, and Windows user profile. Before login, the adapter checks that Windows resolves the child process's local and roaming application-data folders inside that private profile. If Windows redirects either known folder elsewhere, the adapter stops before authentication. No global Steam or DepotDownloader account cache is opened or removed by TFX.

The command includes `-app 1237970`, depot `1237971`, the installed manifest ID, `-filelist` with exact names, a private `-dir`, `-qr`, and a random `-loginid`. It omits `-username`, `-password`, `-remember-password`, `-validate`, and `-verify-all`. The sign-in session is not persistent. QR artwork is displayed only through transient progress events; raw helper output, account names, and authentication tokens are not written to TFX logs.

On success, all selected files must pass every SHA-1 chunk in the installed manifest with complete coverage and unchanged file identity. A manifest change during download invalidates the result. Private profile and helper metadata are removed before a source is returned. Cancellation, helper failure, authentication timeout, invalid resource bytes, and insufficient space yield no repair source; failed jobs are removed from the owned cache directory. The user's installed game is untouched by this adapter.

The implementation's automated tests cover exact file selection, unsafe paths, changed manifests, fragmented QR output, safe errors, private profile isolation, free-space checks, cancellation, timeout, source verification, and unchanged installed-game fixtures. A successful real Steam sign-in and resource download require the owning user's QR authorization; offline and fixture tests alone do not establish that end-to-end result.
