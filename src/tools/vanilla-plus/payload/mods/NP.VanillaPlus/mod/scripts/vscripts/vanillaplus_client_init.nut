global enum eDiscordGameState
{
    LOADING = 0
    MAINMENU
    LOBBY
    INGAME
}

global struct GameStateStruct {

    string map
    string mapDisplayname

    string playlist
    string playlistDisplayname

    int currentPlayers
    int maxPlayers
    int ownScore
    int otherHighestScore
    int maxScore
    float timeEnd
    int serverGameState
    int fd_waveNumber
    int fd_totalWaves
}

global struct UIPresenceStruct {
    int gameState
}

global struct ModInfo
{
    string name = ""
    string description = ""
    string version = ""
    string downloadLink = ""
    int loadPriority = 0
    bool enabled = false
    bool requiredOnClient = false
    bool isRemote
    array<string> conVars = []
}