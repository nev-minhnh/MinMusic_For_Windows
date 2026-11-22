// GENERATED from the M4-1b layout table (labels are thunks so the i18n scanner finds every literal t call and strings follow the locale live).
// Every desktop key of the v1 pages PLAYER, CONTENT, PRIVACY, LYRICS (+AI, romanization, sources) and APPEARANCE (+desktop group).
import { t } from "../../i18n";

export type RowKind = "switch" | "seg" | "select" | "slider" | "stepper" | "text" | "secret";
export type RowDef = {
  key: string;
  label: () => string;
  kind?: RowKind;
  /** row is shown disabled while this bool key is off */
  dep?: string;
  /** display order of enum values */
  order?: string[];
  /** secret rows: the AI provider the key belongs to (a settings key holding the name, or a literal name) */
  provider?: string;
};
export type GroupDef = { id: string; title: () => string; rows: RowDef[] };
export type PageId = "Appearance" | "Playback" | "Lyrics" | "Content" | "Privacy";

export const layout: Record<PageId, GroupDef[]> = {
  Appearance: [
    {
      id: "theme",
      title: () => t("w2_set_g_appearance_theme"),
      rows: [
        { key: "themeMode", label: () => t("w2_set_themeMode"), kind: "seg", order: ["LIGHT","DARK","PURE_BLACK","AUTO"] },
        { key: "appLanguage", label: () => t("w2_set_appLanguage"), kind: "seg" },
        { key: "appFont", label: () => t("w2_set_appFont"), kind: "select" },
        { key: "animatedGradient", label: () => t("w2_set_animatedGradient") },
      ],
    },
    {
      id: "player",
      title: () => t("w2_set_g_appearance_player"),
      rows: [
        { key: "playerBackgroundStyle", label: () => t("w2_set_playerBackgroundStyle"), kind: "select" },
        { key: "playerThumbnailStyle", label: () => t("w2_set_playerThumbnailStyle"), kind: "select" },
        { key: "sliderStyle", label: () => t("w2_set_sliderStyle"), kind: "select" },
        { key: "sliderTrackThicknessDp", label: () => t("w2_set_sliderTrackThicknessDp"), kind: "slider" },
        { key: "cropAlbumArt", label: () => t("w2_set_cropAlbumArt") },
        { key: "swapPlayerControls", label: () => t("w2_set_swapPlayerControls") },
        { key: "enableAnimatedCovers", label: () => t("w2_set_enableAnimatedCovers") },
        { key: "playerCanvasEnabled", label: () => t("w2_set_playerCanvasEnabled") },
        { key: "showPlayerVideoButton", label: () => t("w2_set_showPlayerVideoButton") },
        { key: "musicVideoPlaybackEnabled", label: () => t("w2_set_musicVideoPlaybackEnabled") },
        { key: "musicVideoQuality", label: () => t("w2_set_musicVideoQuality"), kind: "select", dep: "musicVideoPlaybackEnabled" },
        { key: "playVideosInMiniPlayer", label: () => t("w2_set_playVideosInMiniPlayer") },
      ],
    },
    {
      id: "window",
      title: () => t("w2_set_g_appearance_window"),
      rows: [
        { key: "desktopFloatingPlayerBar", label: () => t("w2_set_desktopFloatingPlayerBar") },
        { key: "desktopSidebarDocked", label: () => t("w2_set_desktopSidebarDocked") },
        { key: "minimizeToTrayOnClose", label: () => t("w2_set_minimizeToTrayOnClose") },
        { key: "desktopTrayToggleOnClick", label: () => t("w2_set_desktopTrayToggleOnClick") },
        { key: "desktopMiniPlayerWindow", label: () => t("w2_set_desktopMiniPlayerWindow") },
        { key: "desktopMiniPlayerOnMinimize", label: () => t("w2_set_desktopMiniPlayerOnMinimize"), dep: "desktopMiniPlayerWindow" },
        { key: "desktopTaskbarButtons", label: () => t("w2_set_desktopTaskbarButtons") },
      ],
    },
  ],
  Playback: [
    {
      id: "audio",
      title: () => t("w2_set_g_playback_audio"),
      rows: [
        { key: "audioQuality", label: () => t("w2_set_audioQuality"), kind: "seg" },
        { key: "audioNormalization", label: () => t("w2_set_audioNormalization") },
        { key: "loudnessLevel", label: () => t("w2_set_loudnessLevel"), kind: "select", dep: "audioNormalization" },
        { key: "skipSilence", label: () => t("w2_set_skipSilence") },
        { key: "skipSilenceInstant", label: () => t("w2_set_skipSilenceInstant"), dep: "skipSilence" },
        { key: "playbackSpeed", label: () => t("w2_set_playbackSpeed"), kind: "slider" },
        { key: "playbackPitch", label: () => t("w2_set_playbackPitch"), kind: "slider" },
      ],
    },
    {
      id: "crossfade",
      title: () => t("w2_set_g_playback_crossfade"),
      rows: [
        { key: "crossfadeEnabled", label: () => t("w2_set_crossfadeEnabled") },
        { key: "crossfadeDuration", label: () => t("w2_set_crossfadeDuration"), kind: "slider", dep: "crossfadeEnabled" },
        { key: "crossfadeGapless", label: () => t("w2_set_crossfadeGapless"), dep: "crossfadeEnabled" },
      ],
    },
    {
      id: "queue",
      title: () => t("w2_set_g_playback_queue"),
      rows: [
        { key: "persistentQueue", label: () => t("w2_set_persistentQueue") },
        { key: "persistentShuffleAcrossQueues", label: () => t("w2_set_persistentShuffleAcrossQueues") },
        { key: "rememberShuffleAndRepeat", label: () => t("w2_set_rememberShuffleAndRepeat") },
        { key: "useLegacyShuffle", label: () => t("w2_set_useLegacyShuffle") },
        { key: "autoLoadMore", label: () => t("w2_set_autoLoadMore") },
        { key: "disableLoadMoreWhenRepeatAll", label: () => t("w2_set_disableLoadMoreWhenRepeatAll") },
        { key: "preventDuplicateTracksInQueue", label: () => t("w2_set_preventDuplicateTracksInQueue") },
        { key: "autoSkipNextOnError", label: () => t("w2_set_autoSkipNextOnError") },
        { key: "keepPausedOnSongChange", label: () => t("w2_set_keepPausedOnSongChange") },
        { key: "pauseOnMute", label: () => t("w2_set_pauseOnMute") },
        { key: "promptContinuePlayback", label: () => t("w2_set_promptContinuePlayback") },
        { key: "sponsorBlockEnabled", label: () => t("w2_set_sponsorBlockEnabled") },
      ],
    },
    {
      id: "seek",
      title: () => t("w2_set_g_playback_seek"),
      rows: [
        { key: "seekDurationSeconds", label: () => t("w2_set_seekDurationSeconds"), kind: "stepper" },
        { key: "seekExtraSeconds", label: () => t("w2_set_seekExtraSeconds") },
        { key: "sleepTimerDefaultMinutes", label: () => t("w2_set_sleepTimerDefaultMinutes"), kind: "stepper" },
        { key: "sleepTimerDefaultFinishCurrentSong", label: () => t("w2_set_sleepTimerDefaultFinishCurrentSong") },
        { key: "sleepTimerDefaultFadeOut", label: () => t("w2_set_sleepTimerDefaultFadeOut") },
      ],
    },
  ],
  Lyrics: [
    {
      id: "display",
      title: () => t("w2_set_g_lyrics_display"),
      rows: [
        { key: "showLyricsOnPlayer", label: () => t("w2_set_showLyricsOnPlayer") },
        { key: "lyricsAutoScroll", label: () => t("w2_set_lyricsAutoScroll") },
        { key: "lyricsClickToSeek", label: () => t("w2_set_lyricsClickToSeek") },
        { key: "lyricsTextPosition", label: () => t("w2_set_lyricsTextPosition"), kind: "seg" },
        { key: "lyricsTextSize", label: () => t("w2_set_lyricsTextSize"), kind: "slider" },
        { key: "lyricsLineSpacing", label: () => t("w2_set_lyricsLineSpacing"), kind: "slider" },
        { key: "subtitleTextSize", label: () => t("w2_set_subtitleTextSize"), kind: "slider" },
        { key: "lyricsAnimationStyle", label: () => t("w2_set_lyricsAnimationStyle"), kind: "select" },
        { key: "lyricsProgressiveBlur", label: () => t("w2_set_lyricsProgressiveBlur") },
        { key: "lyricsPlusLighter", label: () => t("w2_set_lyricsPlusLighter") },
        { key: "lyricsNeutralColor", label: () => t("w2_set_lyricsNeutralColor") },
        { key: "lyricsActiveByRealTiming", label: () => t("w2_set_lyricsActiveByRealTiming") },
        { key: "respectAgentPositioning", label: () => t("w2_set_respectAgentPositioning") },
        { key: "lyricsShowOriginalLyrics", label: () => t("w2_set_lyricsShowOriginalLyrics") },
        { key: "lyricsShowTranslations", label: () => t("w2_set_lyricsShowTranslations") },
        { key: "globalLyricsOffsetMs", label: () => t("w2_set_globalLyricsOffsetMs"), kind: "stepper" },
      ],
    },
    {
      id: "sources",
      title: () => t("w2_set_g_lyrics_sources"),
      rows: [
        { key: "preferWordSyncedLyrics", label: () => t("w2_set_preferWordSyncedLyrics") },
        { key: "lyricsProviderOrder", label: () => t("w2_set_lyricsProviderOrder"), kind: "text" },
        { key: "lyricsEnabledProviders", label: () => t("w2_set_lyricsEnabledProviders"), kind: "text" },
      ],
    },
    {
      id: "roman",
      title: () => t("w2_set_g_lyrics_roman"),
      rows: [
        { key: "lyricsRomanizationEnabled", label: () => t("w2_set_lyricsRomanizationEnabled") },
        { key: "lyricsRomanizeAsMain", label: () => t("w2_set_lyricsRomanizeAsMain"), dep: "lyricsRomanizationEnabled" },
        { key: "lyricsSyllableRomanizationEnabled", label: () => t("w2_set_lyricsSyllableRomanizationEnabled"), dep: "lyricsRomanizationEnabled" },
        { key: "lyricsRomanizeCyrillicByLine", label: () => t("w2_set_lyricsRomanizeCyrillicByLine"), dep: "lyricsRomanizationEnabled" },
        { key: "lyricsRomanizeLanguages", label: () => t("w2_set_lyricsRomanizeLanguages"), kind: "text", dep: "lyricsRomanizationEnabled" },
      ],
    },
    {
      id: "ai",
      title: () => t("w2_set_g_lyrics_ai"),
      rows: [
        { key: "lyricsAiTranslationEnabled", label: () => t("w2_set_lyricsAiTranslationEnabled") },
        { key: "lyricsAiActivationMode", label: () => t("w2_set_lyricsAiActivationMode"), kind: "seg", dep: "lyricsAiTranslationEnabled" },
        { key: "lyricsAiTranslationMode", label: () => t("w2_set_lyricsAiTranslationMode"), kind: "seg", dep: "lyricsAiTranslationEnabled" },
        { key: "lyricsAiProvider", label: () => t("w2_set_lyricsAiProvider"), kind: "text", dep: "lyricsAiTranslationEnabled" },
        { key: "lyricsAiApiKey", label: () => t("w2_set_lyricsAiApiKey"), kind: "secret", provider: "lyricsAiProvider" },
        { key: "lyricsAiBaseUrl", label: () => t("w2_set_lyricsAiBaseUrl"), kind: "text", dep: "lyricsAiTranslationEnabled" },
        { key: "lyricsAiModel", label: () => t("w2_set_lyricsAiModel"), kind: "text", dep: "lyricsAiTranslationEnabled" },
        { key: "lyricsAiTargetLanguage", label: () => t("w2_set_lyricsAiTargetLanguage"), kind: "text", dep: "lyricsAiTranslationEnabled" },
        { key: "lyricsAiSystemPrompt", label: () => t("w2_set_lyricsAiSystemPrompt"), kind: "text", dep: "lyricsAiTranslationEnabled" },
        { key: "lyricsDeepLApiKey", label: () => t("w2_set_lyricsDeepLApiKey"), kind: "secret", provider: "DeepL" },
        { key: "lyricsDeepLFormality", label: () => t("w2_set_lyricsDeepLFormality"), kind: "select" },
      ],
    },
  ],
  Content: [
    {
      id: "region",
      title: () => t("w2_set_g_content_region"),
      rows: [
        { key: "contentLanguage", label: () => t("w2_set_contentLanguage"), kind: "text" },
        { key: "contentCountry", label: () => t("w2_set_contentCountry"), kind: "text" },
        { key: "ytmSync", label: () => t("w2_set_ytmSync") },
      ],
    },
    {
      id: "filter",
      title: () => t("w2_set_g_content_filter"),
      rows: [
        { key: "hideExplicit", label: () => t("w2_set_hideExplicit") },
        { key: "explicitOnly", label: () => t("w2_set_explicitOnly") },
        { key: "hideVideoSongs", label: () => t("w2_set_hideVideoSongs") },
        { key: "hideNonMusicalVideos", label: () => t("w2_set_hideNonMusicalVideos") },
        { key: "hidePodcasts", label: () => t("w2_set_hidePodcasts") },
        { key: "hideShortSongs", label: () => t("w2_set_hideShortSongs") },
        { key: "minimumSongDurationSeconds", label: () => t("w2_set_minimumSongDurationSeconds"), kind: "stepper", dep: "hideShortSongs" },
        { key: "blockAiSlopArtists", label: () => t("w2_set_blockAiSlopArtists") },
      ],
    },
    {
      id: "library",
      title: () => t("w2_set_g_content_library"),
      rows: [
        { key: "showLikedPlaylist", label: () => t("w2_set_showLikedPlaylist") },
        { key: "showDownloadedPlaylist", label: () => t("w2_set_showDownloadedPlaylist") },
        { key: "showTopPlaylist", label: () => t("w2_set_showTopPlaylist") },
        { key: "showUploadedPlaylist", label: () => t("w2_set_showUploadedPlaylist") },
        { key: "showCachedPlaylist", label: () => t("w2_set_showCachedPlaylist") },
      ],
    },
  ],
  Privacy: [
    {
      id: "history",
      title: () => t("w2_set_g_privacy_history"),
      rows: [
        { key: "pauseListenHistory", label: () => t("w2_set_pauseListenHistory") },
        { key: "pauseSearchHistory", label: () => t("w2_set_pauseSearchHistory") },
        { key: "hideRecentSearches", label: () => t("w2_set_hideRecentSearches") },
        { key: "historyDuration", label: () => t("w2_set_historyDuration"), kind: "stepper" },
        { key: "historyPlaylistsEnabled", label: () => t("w2_set_historyPlaylistsEnabled") },
        { key: "queueYouTubeHistoryWhenOffline", label: () => t("w2_set_queueYouTubeHistoryWhenOffline") },
      ],
    },
    {
      id: "diag",
      title: () => t("w2_set_g_privacy_diag"),
      rows: [
        { key: "enableLogging", label: () => t("w2_set_enableLogging") },
        { key: "sentryEnabled", label: () => t("w2_set_sentryEnabled") },
      ],
    },
  ],
};

/** Enum value labels, "<key>.<VALUE>". A value without an entry is humanised from its name. */
export const enumLabels: Record<string, () => string> = {
  "themeMode.LIGHT": () => t("w2_set_themeMode_LIGHT"),
  "themeMode.DARK": () => t("w2_set_themeMode_DARK"),
  "themeMode.PURE_BLACK": () => t("w2_set_themeMode_PURE_BLACK"),
  "themeMode.AUTO": () => t("w2_set_themeMode_AUTO"),
  "appLanguage.SYSTEM": () => t("w2_set_appLanguage_SYSTEM"),
  "appLanguage.en": () => t("w2_set_appLanguage_en"),
  "appLanguage.vi": () => t("w2_set_appLanguage_vi"),
  "appFont.SYSTEM": () => t("w2_set_appFont_SYSTEM"),
  "appFont.INTER": () => t("w2_set_appFont_INTER"),
  "appFont.GOOGLE_SANS": () => t("w2_set_appFont_GOOGLE_SANS"),
  "appFont.MAPLE_MONO": () => t("w2_set_appFont_MAPLE_MONO"),
  "audioQuality.LOW": () => t("w2_set_audioQuality_LOW"),
  "audioQuality.AUTO": () => t("w2_set_audioQuality_AUTO"),
  "audioQuality.HIGH": () => t("w2_set_audioQuality_HIGH"),
  "loudnessLevel.AGGRESSIVE": () => t("w2_set_loudnessLevel_AGGRESSIVE"),
  "loudnessLevel.LOUD": () => t("w2_set_loudnessLevel_LOUD"),
  "loudnessLevel.BALANCED": () => t("w2_set_loudnessLevel_BALANCED"),
  "loudnessLevel.QUIET": () => t("w2_set_loudnessLevel_QUIET"),
  "lyricsTextPosition.LEFT": () => t("w2_set_lyricsTextPosition_LEFT"),
  "lyricsTextPosition.CENTER": () => t("w2_set_lyricsTextPosition_CENTER"),
  "lyricsTextPosition.RIGHT": () => t("w2_set_lyricsTextPosition_RIGHT"),
  "lyricsAnimationStyle.None": () => t("w2_set_lyricsAnimationStyle_None"),
  "lyricsAnimationStyle.Fade": () => t("w2_set_lyricsAnimationStyle_Fade"),
  "lyricsAnimationStyle.Glow": () => t("w2_set_lyricsAnimationStyle_Glow"),
  "lyricsAnimationStyle.Slide": () => t("w2_set_lyricsAnimationStyle_Slide"),
  "lyricsAnimationStyle.Karaoke": () => t("w2_set_lyricsAnimationStyle_Karaoke"),
  "lyricsAnimationStyle.Apple": () => t("w2_set_lyricsAnimationStyle_Apple"),
  "lyricsAiTranslationMode.Literal": () => t("w2_set_lyricsAiTranslationMode_Literal"),
  "lyricsAiTranslationMode.Transcreation": () => t("w2_set_lyricsAiTranslationMode_Transcreation"),
  "lyricsAiActivationMode.Automatic": () => t("w2_set_lyricsAiActivationMode_Automatic"),
  "lyricsAiActivationMode.Manual": () => t("w2_set_lyricsAiActivationMode_Manual"),
  "lyricsDeepLFormality.default": () => t("w2_set_lyricsDeepLFormality_default"),
  "lyricsDeepLFormality.more": () => t("w2_set_lyricsDeepLFormality_more"),
  "lyricsDeepLFormality.less": () => t("w2_set_lyricsDeepLFormality_less"),
  "playerBackgroundStyle.BLURRED_ARTWORK": () => t("w2_set_playerBackgroundStyle_BLURRED_ARTWORK"),
  "playerBackgroundStyle.SOLID": () => t("w2_set_playerBackgroundStyle_SOLID"),
  "playerBackgroundStyle.GRADIENT": () => t("w2_set_playerBackgroundStyle_GRADIENT"),
  "playerBackgroundStyle.ANIMATED_GRADIENT": () => t("w2_set_playerBackgroundStyle_ANIMATED_GRADIENT"),
  "playerBackgroundStyle.LIQUID": () => t("w2_set_playerBackgroundStyle_LIQUID"),
  "playerThumbnailStyle.COMPACT": () => t("w2_set_playerThumbnailStyle_COMPACT"),
  "playerThumbnailStyle.FULLSCREEN": () => t("w2_set_playerThumbnailStyle_FULLSCREEN"),
  "playerThumbnailStyle.CANVAS": () => t("w2_set_playerThumbnailStyle_CANVAS"),
  "sliderStyle.DEFAULT": () => t("w2_set_sliderStyle_DEFAULT"),
  "sliderStyle.WAVY": () => t("w2_set_sliderStyle_WAVY"),
  "sliderStyle.SLIM": () => t("w2_set_sliderStyle_SLIM"),
  "sliderStyle.SQUIGGLY": () => t("w2_set_sliderStyle_SQUIGGLY"),
  "sliderStyle.LINEAR": () => t("w2_set_sliderStyle_LINEAR"),
  "sliderStyle.LINEAR_WAVY": () => t("w2_set_sliderStyle_LINEAR_WAVY"),
  "musicVideoQuality.AUTO": () => t("w2_set_musicVideoQuality_AUTO"),
  "musicVideoQuality.P2160": () => t("w2_set_musicVideoQuality_P2160"),
  "musicVideoQuality.P1440": () => t("w2_set_musicVideoQuality_P1440"),
  "musicVideoQuality.P1080": () => t("w2_set_musicVideoQuality_P1080"),
  "musicVideoQuality.P720": () => t("w2_set_musicVideoQuality_P720"),
  "musicVideoQuality.P480": () => t("w2_set_musicVideoQuality_P480"),
};

/** Schema keys that no Settings page of this package shows, with the reason. A key matching none of these and absent from `layout` fails the coverage test. */
export const hidden: { match: RegExp; reason: string }[] = [
  { match: /^(zingSource|nctSource|soundCloudSource|autoBestSource)/, reason: "Sources page (M3-3)" },
  { match: /^(discord|enableDiscord|lastFm|listenBrainz|spotifySession|innerTube|visitorData|dataSyncId|account|tokenLoginWarning)/, reason: "Integrations page (M3-3) / account state" },
  { match: /^(songCacheEnabled|maxSongCacheSize|maxImageCacheSize|audioCacheLocation|downloadLocation|customDownloadPath|autoDownload|downloadQueueJson|desktopStoppedDownloadIds|downloadedCollectionSort|cachedCollectionSort|keepDownloaded)/, reason: "Storage / Downloads pages (M4-2b)" },
  { match: /^(checkForUpdates|updateNotifications|updateChannel|updateCacheSource|updatePromptVersion|installedNightlyDigest|lastUpdateCheck|lastNotifiedUpdateVersion|lastRunAppVersion|launchesSinceUpdatePrompt|cachedAvailableUpdateJson|cachedUpdateReleasesJson|pendingUpdateReleaseJson)/, reason: "Updates page (M5-2)" },
  { match: /^(deviceConnect|listenTogether)/, reason: "Device Connect / Listen Together (M3-4b)" },
  { match: /^equalizer/, reason: "Equalizer page (M2-3b)" },
  { match: /^(desktopOnboarding|desktopPendingOnboarding|supportPrompt|devtools|desktopRenderBackend)/, reason: "onboarding / devtools state, not a user setting here" },
  { match: /^(desktopWindow|desktopMiniPlayerPosition|desktopSidebarWidth|savedWidth|savedHeight|sidebarNavItems|videoViewerVisible|isExpanded|isQueueLocked|playlistEditLock)/, reason: "window and layout state kept by the shell" },
  { match: /Json$|Ids$|Cache$|CacheJson$|Etag$|FetchedAt$|SourceUrl$|^pending|^lastLibrary|^last[A-Z]|^lastFm|Revision$|Epoch$|UndoHintShown$|Sorting|Sort$|SortDirection$|^library|^playlist|^likedSong|^homeSectionVisibility|^visibleAutoPlaylists|^searchHistory|^hasNewUploads|^speedDial|^databaseLikes|^playbackClientStats|^collectionCovers|^canvas|^animatedCover|^appleMusic|^enableAppleMusic|^artist|^blocked|^dislikedSong|^hiddenHome|^hiddenLibrary|^listenBrainz|^queued|^recentPlayed|^tempoPitch|^corrupt|^knownUpload|^musicVideoCache|^grid_|^library_|^density_|^macDefault|^waylandDefault|^systemInDarkTheme|^shuffleEnabled|^volume$|^previousVolume$|^githubNTransform|^playerConfigRemote|^iosCustom|^iosOnboarding|^audioTrackPlaybackParams$|^audioBoostDb$|^varispeed$|^appLayout$|^miniPlayerType$|^playerType$|^uiEnhancements$|^selectedThemeColor$|^themePaletteStyle$|^showMiniplayer$|^immersivePlayer$|^floatingSearch$|^youtubeCanvas|^lyricsShareImageStyle$|^lyricsHideStatusBarInFullscreen$|^lyricsOpenRouter|^aiSlopBlocklist|^animatedArtwork|^defaultOpenTab$|^lyricsAiApiKeys$|^activeLyricsTextPosition$/, reason: "internal state, caches or Android-style options without a desktop control" },
];
