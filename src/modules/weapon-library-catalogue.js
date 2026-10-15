"use strict";
// Original, theme-tinted SVG profiles. Titan labels include their pilot chassis.
const rows=[
  {
    "id": "r201",
    "name": "R-201",
    "category": "rifle",
    "outline": "M4 26H21V22H31V17H91L98 20H118L123 24H140L150 20H156V44H150V30H136L126 28H117L112 35 123 48 116 54 103 39H95L97 53 85 56 78 39H68L63 35H34V39H25V32H4Z M97 31H108L111 36H101Z",
    "detail": "M35 22H91M39 28H73M84 42 89 50M47 34H57M148 27V38",
    "names": {
      "zh-CN": "R-201卡宾枪",
      "zh-TW": "R-201卡賓槍"
    }
  },
  {
    "id": "r101",
    "name": "R-101",
    "category": "rifle",
    "outline": "M3 26H20V23H31V18H61V13H69V9H87V14H94V18H116L121 23H139L150 21H156V44H150V30H136L126 28H117L113 35 123 49 115 54 102 39H94L97 53 84 57 77 39H66L62 35H34V39H26V32H3Z M96 31H108L111 36H100Z",
    "detail": "M67 14H86M36 24H89M39 29H71M84 43 89 50M148 28V37",
    "names": {
      "zh-CN": "R-101卡宾枪",
      "zh-TW": "R-101卡賓槍"
    }
  },
  {
    "id": "flatline",
    "name": "V-47 Flatline",
    "category": "rifle",
    "outline": "M4 25H22V21H34V17H97L105 21H125L130 25H143V22H154V43H145V29H130L120 28H114L111 35 119 46 112 50 101 39H93C95 48 93 55 88 60L76 55C82 47 82 42 79 37H66L62 33H31V37H23V31H4Z M97 29H108L109 35H101Z M144 27H150V37H147Z",
    "detail": "M36 23H95M34 29H63M85 42 86 52M116 23H128",
    "names": {
      "zh-CN": "V-47平行步枪",
      "zh-TW": "V-47平行步槍"
    }
  },
  {
    "id": "hemlok",
    "name": "Hemlok",
    "category": "rifle",
    "outline": "M3 26H17V18H47V20H54V16H109L117 22H137L144 20H153V47H148V31H133L122 28H113L108 35 118 48 111 53 100 39H92L94 54 82 57 77 40H66L61 35H48V39H32L29 34H17V31H3Z M95 29H106L108 35H99Z",
    "detail": "M20 23H44M20 29H43M56 22H105M80 43 86 51M148 26V38",
    "names": {
      "zh-CN": "汗洛BF-R",
      "zh-TW": "汗洛BF-R"
    }
  },
  {
    "id": "g2",
    "name": "G2A5",
    "category": "rifle",
    "outline": "M4 26H19V22H33V20H88L93 15H100L105 21H127L134 25H148V22H155V43H148L140 34H125L116 31H108L104 38 112 49 104 53 94 40H84V53H72V38H64L58 34H34V37H20V31H4Z M88 31H101L101 36H90Z M142 29H150V36H147Z",
    "detail": "M38 25H86M36 29H61M77 41V49M118 27H134",
    "names": {
      "zh-CN": "G2A5",
      "zh-TW": "G2A5"
    }
  },
  {
    "id": "alternator",
    "name": "Alternator",
    "category": "smg",
    "outline": "M29 15H43V11H90L97 7H102L106 12H127L135 17 132 28 117 47H108L102 61H90L84 56 90 44 83 32H73V36H60V25H29L24 21V17H29Z M98 27H114L107 39H103Z M65 27H77V31H65Z M94 53H101L98 57H92Z",
    "detail": "M40 16H91M33 21H64M112 18H125M119 25 111 39M96 47 93 53",
    "names": {
      "zh-CN": "转换者冲锋枪",
      "zh-TW": "轉換者衝鋒槍"
    }
  },
  {
    "id": "car",
    "name": "C.A.R.",
    "category": "smg",
    "outline": "M4 25H15V19H81V17H104L111 22H123L128 26H139V23H156V46H149V31H135L123 29H116L110 37 122 51 113 57 100 39H91V51H75L71 43 66 35H38V54H32V35H16V32H4Z M94 29H106L108 35H97Z",
    "detail": "M19 24H75M22 29H49M79 40V46H86M152 29V38M34 39V49",
    "names": {
      "zh-CN": "CAR",
      "zh-TW": "CAR"
    }
  },
  {
    "id": "r97",
    "name": "R-97",
    "category": "smg",
    "outline": "M4 25H14V19H24V12H29V20H87L91 17H99V20H112L117 25H132V21H152L156 27V47H150V32H136L129 30H114L108 36 118 50 108 54 96 40H87L95 56 82 61 71 40H65L60 35H33V46H28V35H14V40H9V31H4Z M82 29H96L99 35H89Z",
    "detail": "M33 25H85M43 29H67M80 43 87 54M151 29V39M30 36V43",
    "names": {
      "zh-CN": "R-97",
      "zh-TW": "R-97"
    }
  },
  {
    "id": "volt",
    "name": "Volt",
    "category": "smg",
    "outline": "M4 22H21V25H28V18H84V16H123V18H145L155 23V48H150L130 33H117L112 37 122 51 114 56 103 39H97V52H83L77 47 68 37H30V43H26V33H21V31H4Z M84 37H90V47H86Z M131 27H149V40Z M99 29H109L110 35H103Z",
    "detail": "M35 23H70M36 28H72M86 23H113M87 54 85 59H96V53M8 25V29",
    "names": {
      "zh-CN": "电能冲锋枪",
      "zh-TW": "電能衝鋒槍"
    }
  },
  {
    "id": "spitfire",
    "name": "Spitfire",
    "category": "lmg",
    "outline": "M3 25H21V21H34V18H82V13H97V18H121L128 22H145V20H154V47H148V33H132L123 29H116L110 36 120 51 111 56 99 40H91V51H76V39H66L62 34H35V37H23V31H3Z M96 29H108L109 35H101Z M135 28H148V37H142Z",
    "detail": "M39 23H81M42 29H71M80 41V47H87V41M128 26H139",
    "names": {
      "zh-CN": "喷火枪",
      "zh-TW": "噴火槍"
    }
  },
  {
    "id": "devotion",
    "name": "Devotion",
    "category": "lmg",
    "outline": "M4 24H18V20H32V17H69V14H94V17H125L132 21H155V46H150L135 32H118L115 44 107 54H91L86 45V34H76L70 42 74 51 67 55 57 39H34V43H26V34H19V30H4Z M134 26H149V37Z M78 26H87V31H80Z",
    "detail": "M37 23H72M98 23H121M94 38H109M95 44H107M29 24V31",
    "names": {
      "zh-CN": "X-55专注冲锋枪",
      "zh-TW": "X-55專注衝鋒槍"
    }
  },
  {
    "id": "lstar",
    "name": "L-STAR",
    "category": "lmg",
    "outline": "M18 26V15L25 7H109L119 14H129L149 21 153 28V46H116L101 58H61L47 39H24V44H19V36H14V30H18Z M28 13H100V18L75 23H28Z M58 39H77L85 51H66Z M91 37H107V45L96 52H92Z",
    "detail": "M30 9H106M31 27H79M29 32H93M104 29C104 23 115 23 115 29S104 35 104 29M117 37H144",
    "names": {
      "zh-CN": "L-STAR",
      "zh-TW": "L-STAR"
    }
  },
  {
    "id": "doubletake",
    "name": "D-2 Double Take",
    "category": "sniper",
    "outline": "M3 27H27V21H42V17H97V10H114V17H128L135 22H150L156 18V48H147L136 38H126L121 43 127 51 118 55 107 42H98V52H84L80 39H68L62 35H29V38H21V32H3Z M135 28H146V38H142Z M100 29H115V35H106Z",
    "detail": "M34 24H91M34 30H79M102 20H126M87 42V48M144 25V36",
    "names": {
      "zh-CN": "D-2双击狙击步枪",
      "zh-TW": "D-2雙擊狙擊步槍"
    }
  },
  {
    "id": "longbow",
    "name": "D-101 Longbow",
    "category": "sniper",
    "outline": "M3 24H26V21H50V16H68V10H96V16H108V20H125L131 25H144V23H154V49H141V38H127L119 34H112L108 41 115 52 105 57 96 42H89V54H76V41H60L55 35H29V38H17V31H3Z M99 29H111V35H104Z",
    "detail": "M66 16H94M32 26H70M39 32H74M81 44V50M144 29V41",
    "names": {
      "zh-CN": "长弓DMR",
      "zh-TW": "長弓DMR"
    }
  },
  {
    "id": "kraber",
    "name": "Kraber-AP",
    "category": "sniper",
    "outline": "M3 27H12V29H45V24H64V19H90V11H109V17H120V22H130L135 27H148V25H155V49H149V34H133L124 30H118L114 38 123 49 115 54 102 40H81L75 34H57L51 36H12V33H3Z M98 28H110L112 34H103Z",
    "detail": "M17 30H45M72 25H99M93 17H108M65 31H91M146 30V42",
    "names": {
      "zh-CN": "克莱博-AP狙击步枪",
      "zh-TW": "克萊博-AP狙擊步槍"
    }
  },
  {
    "id": "eva8",
    "name": "EVA-8 Auto",
    "category": "shotgun",
    "outline": "M3 25H14V19H38V15H103L111 20H120V22H132V18H151L156 23V42H143L134 30H119L113 29H108L105 35 118 47 111 53 99 39H92L86 58C84 62 72 60 66 56L72 36H60L55 34H28V31H14V30H3Z M92 29H104L105 35H96Z M137 25H150V36H146Z",
    "detail": "M20 24H56M28 29H66M60 20H98M76 39 87 42M73 46 84 49M70 53 81 56M150 24V36",
    "names": {
      "zh-CN": "EVA-8自动",
      "zh-TW": "EVA-8自動"
    }
  },
  {
    "id": "mastiff",
    "name": "Mastiff",
    "category": "shotgun",
    "outline": "M3 29H25V22H31V12H38V20H96V15H109V20H124L134 24H154V44L125 59H116L108 39H96L91 36H38V41H30V36H3Z M118 36H126L130 47 123 52Z M135 32H148V39L135 45Z",
    "detail": "M38 23H96M39 28H89M40 33H88M108 24H125M9 32H30",
    "names": {
      "zh-CN": "獒犬霰弹枪",
      "zh-TW": "獒犬霰彈槍"
    }
  },
  {
    "id": "wingman",
    "name": "B3 Wingman",
    "category": "pistol",
    "outline": "M32 18H43V14H88L95 18H101L108 23 112 33 121 54 110 58 98 38H88L83 43H70L65 35H32Z M75 33H87V38H77Z",
    "detail": "M38 23H74M40 29H70M78 21V29M87 21V29M107 42 115 52",
    "names": {
      "zh-CN": "B3小帮手",
      "zh-TW": "B3小幫手"
    }
  },
  {
    "id": "wingmanelite",
    "name": "Wingman Elite",
    "category": "pistol",
    "outline": "M28 17H39V12H85V9H101V14H109V21L115 31 124 53 112 59 99 38H88L82 44H68L62 35H28Z M74 33H87V39H76Z",
    "detail": "M33 23H72M35 29H69M79 20V29M88 20V29M108 43 116 52",
    "names": {
      "zh-CN": "小帮手菁英",
      "zh-TW": "小幫手菁英"
    }
  },
  {
    "id": "p2016",
    "name": "P2016",
    "category": "pistol",
    "outline": "M31 17H113L122 23V34H103L111 55 95 59 86 39H72L67 34H31Z M77 31H88L92 36H78Z",
    "detail": "M39 23H112M39 28H87M97 41 103 53M105 19V26",
    "names": {
      "zh-CN": "汉蒙P2016",
      "zh-TW": "漢蒙P2016"
    }
  },
  {
    "id": "re45",
    "name": "RE-45 Auto",
    "category": "pistol",
    "outline": "M34 16H109L117 22V32H100L103 41 109 57H95L88 35H78L73 40H65L62 32H34Z M70 32H84L83 36H71Z",
    "detail": "M41 22H106M43 27H83M96 41 101 54M98 58H112V61H97Z",
    "names": {
      "zh-CN": "RE-45自动",
      "zh-TW": "RE-45自動"
    }
  },
  {
    "id": "mozambique",
    "name": "Mozambique",
    "category": "pistol",
    "outline": "M23 17H83L89 13H107L115 19V28L108 32 123 54 108 60 95 39H82L76 44H65L60 36H27Z M71 33H87L91 38H75Z",
    "detail": "M34 23H78M32 29H76M93 20H107M107 44 115 54",
    "names": {
      "zh-CN": "SA-3莫三比克",
      "zh-TW": "SA-3莫三比克"
    }
  },
  {
    "id": "smartpistol",
    "name": "Smart Pistol Mk6",
    "category": "pistol",
    "outline": "M28 18H102V14H116V22H131V34H108L118 54 103 60 92 39H76L70 34H28Z M79 32H94L97 36H82Z",
    "detail": "M35 24H116M40 29H86M104 20H114M105 42 112 52",
    "names": {
      "zh-CN": "智慧型手枪",
      "zh-TW": "智慧型手槍"
    }
  },
  {
    "id": "epg",
    "name": "EPG-1",
    "category": "grenadier",
    "outline": "M8 25H17V19H25V13H37V8H89V14H97L105 18H130L149 22 154 29V49L104 61H85L75 39H58L52 42 60 53 51 56 41 39H18V36H8Z M35 13H85V17H35Z M83 41H100L112 53 91 57Z M116 40H141V47L121 52Z",
    "detail": "M25 23H91M25 29H86M101 26H143M101 33H143M37 18H83",
    "names": {
      "zh-CN": "能源炮-1",
      "zh-TW": "能源砲-1"
    }
  },
  {
    "id": "coldwar",
    "name": "EM-4 Cold War",
    "category": "grenadier",
    "outline": "M7 20H28V16H57V11H83V16H119L128 21H144V39H131L124 34H113L107 40 117 52 108 57 98 43H91V58H78V40H64L59 35H8Z M94 28H108L110 35H99Z",
    "detail": "M13 25H58M13 30H56M64 22H107M82 44V53M123 26H139",
    "names": {
      "zh-CN": "EM-4冷战榴弹枪",
      "zh-TW": "EM-4冷戰榴彈槍"
    }
  },
  {
    "id": "softball",
    "name": "R-6P Softball",
    "category": "grenadier",
    "outline": "M7 23H21V18H33V13H48V18H72L81 21H128L138 25H151V45H145V33H130L122 29H115L110 38 121 51 111 56 99 41H88C88 49 82 55 73 55S58 49 58 41V36H37V52H30V34H13V31H7Z M91 29H105V35H96Z",
    "detail": "M27 23H69M65 40C65 34 81 34 81 40S65 48 65 40M112 24H130M146 28V37",
    "names": {
      "zh-CN": "R-6P垒球榴弹枪",
      "zh-TW": "R-6P壘球榴彈槍"
    }
  },
  {
    "id": "smr",
    "name": "Sidewinder SMR",
    "category": "grenadier",
    "outline": "M7 18H33V14H59V18H88L95 22H120L129 25H147V20H154V46H147V31H130L117 29H109L105 36 115 49 106 53 96 40H87V47H68L62 40H54L51 35H34V57H27V35H7Z M91 29H104L104 35H96Z",
    "detail": "M13 23H46M13 29H47M64 23H84M73 41H83M149 28V39",
    "names": {
      "zh-CN": "响尾蛇飞弹",
      "zh-TW": "響尾蛇飛彈"
    }
  },
  {
    "id": "archer",
    "name": "Archer",
    "category": "antiTitan",
    "outline": "M8 14H40V12H56V16H101V12H127V15H149V39H132V36H116L110 41 117 52 107 57 95 40H83L76 48H56L41 34H20V37H8Z M43 34H55L59 42H68L74 36H85V40L76 45H59Z",
    "detail": "M16 18V32M33 18V32M117 18V32M136 18V34M49 25H103",
    "names": {
      "zh-CN": "射手飞弹",
      "zh-TW": "射手飛彈"
    }
  },
  {
    "id": "thunderbolt",
    "name": "LG-97 Thunderbolt",
    "category": "antiTitan",
    "outline": "M8 17H29L35 13H122L136 18H152V41H137L127 35H105L99 42 112 54 101 59 89 44H66L58 38H29L23 33H8Z M73 34H90L93 39H77Z",
    "detail": "M18 22H50M17 29H45M67 23H123M73 19 61 28H75L65 36M136 23V34",
    "names": {
      "zh-CN": "LG-97雷电炮",
      "zh-TW": "LG-97雷電砲"
    }
  },
  {
    "id": "charge_rifle",
    "name": "Charge Rifle",
    "category": "antiTitan",
    "outline": "M8 18H41V14H77V18H94L101 23H116L126 26H140V22H153V51H142L132 44H117L111 49H96L87 41H80L72 36H43V39H8V31H19V25H8Z M117 32H141V43H134L125 38H116Z",
    "detail": "M15 21H37M15 34H35M48 20V33M55 20V33M62 20V33M69 20V33M147 28V44",
    "names": {
      "zh-CN": "电能步枪",
      "zh-TW": "電能步槍"
    }
  },
  {
    "id": "mgl",
    "name": "MGL",
    "category": "antiTitan",
    "outline": "M8 20H53V16H69V20H88V15H94L87 4H90L101 15H108L114 23H126V20H142L146 24H156V48H147L139 41H126L117 31H111L105 55H85L87 50 83 41H78V61H61L55 57V39H39V59H30V41H21L14 37H8L5 32V25Z M92 39H104L100 50H95Z M145 29H151V42H148L140 35Z M67 25H75V34H66Z",
    "detail": "M15 23H48M15 29H48M18 35H47M21 20 17 26M29 20 25 26M37 20 33 26M45 20 41 26M64 43H74M64 49H74M65 55H73M91 23H106M33 44V55",
    "names": {
      "zh-CN": "磁能榴弹发射器",
      "zh-TW": "磁能榴彈發射器"
    }
  },
  {
    "id": "xo16",
    "name": "XO-16",
    "category": "titan",
    "outline": "M3 25H19V18H54V13H72V17H100L109 22H124L133 25H154V49H138L129 41H113L105 46H87L78 39H67V53H48V38H31L25 34H3Z M109 30H128L141 35V44H137L128 37H111Z",
    "detail": "M23 23H52M23 29H52M54 35V47M61 35V48M76 23H98M145 31V43",
    "names": {
      "zh-CN": "帝王的XO-16",
      "zh-TW": "帝王的XO-16"
    }
  },
  {
    "id": "splitterrifle",
    "name": "Splitter Rifle",
    "category": "titan",
    "outline": "M5 23H22V19H49L57 13H83V17H101L108 22H125V20H147L155 26V47H140L128 41H116C113 52 104 58 93 58S74 51 72 42H58L53 37H28V41H15V34H5Z M127 28H146V39H139L129 35Z",
    "detail": "M26 24H70M24 31H67M89 35C89 28 104 28 104 36S89 44 89 35M81 39C81 24 112 24 112 39S81 54 81 39",
    "names": {
      "zh-CN": "离子的分裂枪",
      "zh-TW": "離子的分裂槍"
    }
  },
  {
    "id": "thermitelauncher",
    "name": "T-203 Thermite Launcher",
    "category": "titan",
    "outline": "M5 19H28L34 14H77L89 18H109L121 23H136L144 19H154V49H135L122 44H101L91 48H76L69 41H32L23 35H5Z M135 28H147V41H140L131 36Z",
    "detail": "M15 23C10 23 10 34 15 34S20 23 15 23M35 22H70M35 28H67M35 34H65M85 26H113",
    "names": {
      "zh-CN": "烈焰的T-203铝热剂发射器",
      "zh-TW": "烈焰的T-203鋁熱劑發射器"
    }
  },
  {
    "id": "leadwall",
    "name": "Leadwall",
    "category": "titan",
    "outline": "M8 10H84L91 7H123L135 13H148L154 23V52H142L133 46H124L117 58H101L91 53H76L69 47H59L56 58H39L31 48V36H17L12 31H8Z M39 36H49L47 49H42Z M128 32H142V46H137L130 40Z",
    "detail": "M14 14V29M19 14V29M25 14V29M31 15H63M31 22H63M73 17H98M74 25H97M91 29C99 36 99 46 91 52M102 23C116 31 118 44 108 54M110 19C124 27 127 42 116 54",
    "names": {
      "zh-CN": "浪人的天女散花",
      "zh-TW": "浪人的天女散花"
    }
  },
  {
    "id": "plasmarailgun",
    "name": "Plasma Railgun",
    "category": "titan",
    "outline": "M3 22H19V16H51V12H76V16H112L124 21H141L154 27V45H144L133 38H115L106 43H81L76 37H40L34 33H3Z M136 27H147V38H142Z",
    "detail": "M8 25H31M9 29H33M43 22H72M86 21H115M86 27H116M86 33H113",
    "names": {
      "zh-CN": "北极星的电浆磁轨炮",
      "zh-TW": "北極星的電漿磁軌砲"
    }
  },
  {
    "id": "trackercannon",
    "name": "40mm Tracker Cannon",
    "category": "titan",
    "outline": "M3 26H23V21H47V16H69V11H89V17H108L117 22H135L143 19H153V48H137L126 41H111L104 46H89L81 39H71V57H53V38H32L27 33H3Z M112 29H129L141 34V42H138L128 36H114Z",
    "detail": "M31 26H60M55 41V51M64 40V52M75 22H101M144 26V41M7 29H26",
    "names": {
      "zh-CN": "强力的40mm 追踪机炮",
      "zh-TW": "強力的40mm 追蹤機砲"
    }
  },
  {
    "id": "predatorcannon",
    "name": "Predator Cannon",
    "category": "titan",
    "outline": "M2 17H78V11H88V17H113L123 20H139L153 27V45H142L131 39H118L109 44H96L92 55H75L70 43H48L42 36H2V32H14V28H2V24H14V21H2Z M123 27H141L148 32V38H143L133 32H121Z",
    "detail": "M18 19H72M18 26H70M18 33H70M77 21V35M82 43C82 36 93 36 93 44S82 51 82 43M107 25H118",
    "names": {
      "zh-CN": "军团的猎杀者炮",
      "zh-TW": "軍團的獵殺者砲"
    }
  },
  {
    "id": "broadsword",
    "name": "Broadsword",
    "category": "titan",
    "outline": "M13 49 23 39 26 42 45 23 50 28 134 7 117 27 57 36 61 41 54 47 46 39 30 55 27 52 19 58Z",
    "detail": "M54 31 125 13M27 44 47 29M18 51 24 45",
    "names": {
      "zh-CN": "浪人的大剑",
      "zh-TW": "浪人的大劍"
    }
  },
  {
    "id": "primesword",
    "name": "Prime Sword",
    "category": "titan",
    "outline": "M12 49 22 39 26 43 43 26 48 31 124 8 143 7 125 27 57 38 61 42 54 49 45 41 29 57 25 53 19 59Z",
    "detail": "M54 34 132 13M28 45 46 31M17 51 23 45",
    "names": {
      "zh-CN": "至尊浪人的大剑",
      "zh-TW": "至尊浪人的大劍"
    }
  }
];
const weapons=Object.freeze(rows.map(row=>Object.freeze({...row,names:Object.freeze(row.names)})));
module.exports={weapons};
