2.5.0
- Use tabs for indentation
- Add Spectre rodeo, in-game server browser and better server browser warning
- Hide a few Vanilla+ convars that are only used internally
- Update Discord RPC stuff

2.4.4
- Removed "Easier Alternative Install Method" from README.md
- (Hopefully) better clarified Thunderstore install instructions

2.4.3
- Added `chatroom.nut` from Northstar
- Moved `fontfiletable.txt` to keyvalues
- Added `NSGetModDownloadLinkByName` error to FAQ.md
- Added extra launch option to README.md
- Updated links in README.md to point to the new wiki
- Updated github links to point to this repo

2.4.2
- Updated to handle Northstar`s mod info refactor

2.4.1
- Add warning to migrate to `-vanilla` if the user is still on `-norestrictservercommands`

2.4
- Update VanillaPlus to use `-vanilla` as `-norestrictservercommands` is deprecated
- Remove DT fov mod warning
- Clean up some unused code
- Fix core mod warning not going away

2.3 
- Re-add files to make mods such as Khalmee's Speech Bubbles work
- Fix error introduced by plugins v3 in Northstar

2.2
- Fix Mod Settings not showing up in the in game menu
- Re-add slightly modified `_items.nut` from Northstar.CustomServers for some mods that use its functions (the one brought to my attention being Blue Fire)
- Make Vanilla+ convars save to profile.cfg (so they don't need to be set every time... I should've done this originally...)

2.1
- Fix infinite connecting bug introduced in 2.0
- Allow user to disable main menu promos (in mod settings)
- Allow user to change Vanilla+ logo transparency (in mod settings)

2.0
- Rework/rewrite of VanillaPlus
- Restore FD functionality
- Add safeio support
- Fix most auth errors
- Check for incompatible mods and warn the user if they have one
- Independent of Northstar.Client (~35 unused files for Vanilla no longer load)

1.1
- Include rich presence in the VanillaPlus GitHub release

1.0
- First version of the mod, using Northstar.Client alongside the mod to load
