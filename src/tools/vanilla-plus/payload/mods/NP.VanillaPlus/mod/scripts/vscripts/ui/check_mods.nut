untyped

global function CheckModsVanillaPlus_Init

// All of the mod checking/error dialog is taken from halo announcer, shoutout to diqhedd

void function CheckModsVanillaPlus_Init()
{
	// this is just to wait a frame so the game doesn't get upset
	thread CheckForMods()
}

void function CheckForMods()
{
	WaitFrame()

	if ( !VANILLA ) 
	{
		if ( !VP_HAS_CLIENT )
		{
			// if the user isn't in vanilla compat, has vanillaplus, and doesn't have client, they're basically 99% guaranteed
			// to be using -norestrictservercommands still
			// this checks we don't have client because having only client on 2.0+ causes a compile error

			printt( "VanillaPlus Error 1: Using -norestrictservercommands instead of -vanilla" )
			if ( GetConVarBool( "norestrictservercommands_remind" ) )
				UpdateToUsingVanillaLaunchOption()
		}    
		else
		{
			// Prints an error if the user isn't in vanilla compatibilty mode
			// Mostly to be used with Spectre log reading later (hence the 0)

			printt( "VanillaPlus Error 0: Not in vanilla compatibility mode" )
			if ( GetConVarBool( "core_remind" ) )
				VanillaCompat()
		}
	}

	// TODO: see how Archon handles disabling mods
	else if ( VP_HAS_CLIENT || VP_HAS_CUSTOM || VP_HAS_SERVERS )
	{
		if ( GetConVarBool( "core_remind" ) )
			CoreModsEnabled()
	}

	// TODO: find a better way to do this
	else if ( VP_HAS_MORESKINS || VP_HAS_FRAMEWORK || VP_HAS_SPECTRE_RODEO || VP_HAS_IG_SERVER || VP_HAS_BETTER_SERVER ) 
	{
		OtherMods()
	}
}

void function OtherMods()
{
	DialogData warnDiag
	warnDiag.header = "Some mods you have installed don't work with VanillaPlus!"

	if ( VP_HAS_MORESKINS )
	{
		ClientCommand( "mod_remind 1" )
		warnDiag.message = "You have Moreskins installed!\n\nThis won't break VanillaPlus, but it won't work on vanilla! Your skins equipped using it will automatically unequip."
	}

	if ( VP_HAS_FRAMEWORK )
	{
		ClientCommand( "mod_remind 1" )
		warnDiag.message = "You have Titan Framework installed!\n\nIt relies on settings that Northstar has, and requires the server you join to have it, which Respawn's (Vanilla's) never will! Having it enabled WILL break Vanilla!"
	}

	if ( VP_HAS_SPECTRE_RODEO )
	{
		ClientCommand( "mod_remind 1" )
		warnDiag.message = "You have Spectre Rodeo installed!\n\nIt relies on settings that Northstar has, and requires the server you join to have it, which Respawn's (Vanilla's) never will! Having it enabled WILL break Vanilla!"
	}

	if ( VP_HAS_IG_SERVER || VP_HAS_BETTER_SERVER )
	{
		ClientCommand( "mod_remind 1" )
		warnDiag.message = "You have a server browser mod installed!\n\nNorthtar's server browser only works with Northstar servers, NOT with Respawn's (Vanilla's)! Having it enabled MAY break Vanilla!"
	}

	warnDiag.image = $"ui/menu/common/dialog_error"

	AddDialogButton( warnDiag, "#OK", void function(){ ClientCommand( "uiscript_reset" ); ClientCommand( "mod_remind 0" ) } )
	warnDiag.noChoiceWithNavigateBack = true

	if ( GetConVarBool( "mod_remind" ) )
		OpenDialog( warnDiag )
}

void function CoreModsEnabled()
{    
	DialogData coreModWarnDiag
	coreModWarnDiag.header = "Northstar core mods detected!"

	coreModWarnDiag.message = "Northstar's core mods were detected!\n\nThis means that you did not install VanillaPlus properly!\n\nHaving Vanilla+ in the same folder as regular Northstar, OR having Northstar's core mods in the same folder as VanillaPlus WILL cause issues! Please read the instructions again.\n\nHaving them enabled WILL break Vanilla!"

	coreModWarnDiag.image = $"ui/menu/common/dialog_error"
	AddDialogButton( coreModWarnDiag, "Go to instructions", void function(){
		LaunchExternalWebBrowser( "https://northstar.thunderstore.io/package/NachosChipeados/VanillaPlus/", WEBBROWSER_FLAG_FORCEEXTERNAL ); ClientCommand( "uiscript_reset" ); ClientCommand( "core_remind 0" )

	})
	AddDialogButton( coreModWarnDiag, "#OK", void function(){ ClientCommand( "uiscript_reset" ); ClientCommand( "core_remind 0" ) } )
	coreModWarnDiag.noChoiceWithNavigateBack = true

	if ( GetConVarBool( "core_remind" ) )
		OpenDialog( coreModWarnDiag )
}

void function VanillaCompat()
{    
	DialogData coreModWarnDiag
	coreModWarnDiag.header = "Not using vanilla compatibility mode!"

	coreModWarnDiag.message = "You aren't using Northstar's vanilla compatibility mode!\n\nVanillaPlus requires that you follow it's instructions properly to install it!\n\nIgnoring will continue to Northstar servers!"

	coreModWarnDiag.image = $"ui/menu/common/dialog_error"
	AddDialogButton( coreModWarnDiag, "Go to instructions", void function(){
		LaunchExternalWebBrowser( "https://northstar.thunderstore.io/package/NachosChipeados/VanillaPlus/", WEBBROWSER_FLAG_FORCEEXTERNAL ); ClientCommand( "uiscript_reset" ); ClientCommand( "core_remind 0" )

	})
	AddDialogButton( coreModWarnDiag, "Continue to Northstar servers", void function(){ ClientCommand( "uiscript_reset" ); ClientCommand( "core_remind 0" ) } )
	OpenDialog( coreModWarnDiag )
}

void function UpdateToUsingVanillaLaunchOption()
{
	DialogData coreModWarnDiag
	coreModWarnDiag.header = "Not using vanilla compatibility mode!"

	coreModWarnDiag.message = "You aren't using Northstar's vanilla compatibility mode!\n\nIt seems that you're still using the launch option '-norestrictservercommands'.\n\nRecently, a better version of vanilla using the launch option '-vanilla' has come out.\n\nPlease update to that.\n\nYou can read the instructions for how to properly do it again, or you can continue to use VanillaPlus as is, altough it isn't recommended."

	coreModWarnDiag.image = $"ui/menu/common/dialog_error"
	AddDialogButton( coreModWarnDiag, "Go to instructions", void function(){
		LaunchExternalWebBrowser( "https://northstar.thunderstore.io/package/NachosChipeados/VanillaPlus/", WEBBROWSER_FLAG_FORCEEXTERNAL ); ClientCommand( "uiscript_reset" ); ClientCommand( "core_remind 0" )

	})
	AddDialogButton( coreModWarnDiag, "Continue to not recommended VanillaPlus", void function(){ ClientCommand( "uiscript_reset" ); ClientCommand( "norestrictservercommands_remind 0" ) } )
	OpenDialog( coreModWarnDiag )
}