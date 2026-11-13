# Screen map

Every design file, every section in it (the IDs like **40b** appear as badges in the files), and where it lives in `Mantequilla-Soft/new-3speak-tv` (branch `production`). Refer to sections by ID when you discuss them.

How to read a design file: open it in a browser. Each section shows the desktop layout, and sometimes the mobile one (the 390×844 phone frame). The **Dark / Light** theme prop sits in the file's logic class (`themes`). Both themes use the same tokens as `code/tokens.css`.

**Main screens** (02, 07, 17–29) are full-fidelity layouts.  
**Depth boards** (30–49) are inventories of every state, message and edge case for a feature, drawn compactly. Build them at the sizes in STYLE_GUIDE.md, not at the board's density.

## 02 Watch v2
File: `designs/3Speak App 02 Watch v2.dc.html`  
Repo: src/page/Watch.jsx, components/playVideo/*, VideoControls · locales: watch, player, comments  
Watch v2: less like YouTube

## 07 Dialogs v2
File: `designs/3Speak App 07 Dialogs v2.dc.html`  
Repo: components/modal/*, Playlist modal, Share, Report, Login (page/Login/*) · locales: modals, playlists, auth  
Dialogs v2: a 3Speak dialog style, less like YouTube
- **07a** Save to playlist: playlist tiles with covers
- **07b** Share: Hive-native first, link with QR, embed in a tab
- **07c** Report: reason tiles, then one short follow-up
- **07d** Account menu as a control centre, and the video action menu as a tile grid
- **07e** Log in: split panel with the community, not a plain form
- **07f** Confirm as a bottom bar, toasts as a top "island"
- **07g** Mobile: the same dialogs as bottom sheets

## 17 Sheets
File: `designs/3Speak App 17 Sheets.dc.html`  
Repo: TipModal, Promote, ScheduledPostEditor, Beneficiary_modal, Wallet transfer, CreateCommunity · locales: engagement, ads, studio, wallet  
Sheets: dialogs from the other files, redone in the 07 v2 style
- **17a** Tip (from 06)
- **17b** Vote with weight (from 09), shown when earnings are on
- **17c** Promote (from 06)
- **17d** Schedule (from 12): quick slots before the calendar
- **17e** Share rewards / beneficiaries (from 12)
- **17f** Send / transfer (from 15)
- **17g** Create community (from 14)
- **17h** Summary (from 09) as a sheet with chapters
- **17i** Small confirmations as bottom bars and the top island (RC, badge, review)

## 18 Shorts Audio Live Settings v2
File: `designs/3Speak App 18 Shorts Audio Live Settings v2.dc.html`  
Repo: page/Short.jsx, page/Audio.jsx, page/WatchStream.jsx, SettingsModal · locales: shorts, audio, live, settings  
Shorts, Audio, Live and Settings in the Watch v2 style
- **18a** Shorts v2: tile dock, community strip, discussion always open
- **18b** Audio v2: timestamped notes on the waveform, a tile dock, the queue beside it
- **18c** Live v2: chat always beside the stream, tile dock, goal and guest strip
- **18d** Settings v2: sections as tiles, toggles grouped in cards, desktop and mobile

## 19 Gap Fill
File: `designs/3Speak App 19 Gap Fill.dc.html`  
Repo: VideoControls, PostView, TagFeed, Groups, Chat extras, TipModal parts, small modals, Incubation/*, ObsOverlay  
Gap fill: screens and controls found in the codebase scan
- **19a** Player controls, everything in VideoControls: chapters, most-replayed heatmap, comment markers, seek preview, react-to-moment, size, autoplay, ambient glow, CC, speed, quality
- **19b** Text post (PostView /post/:author/:permlink) and the post composer (EditorModal, MarkdownComposer, TiptapEditor)
- **19c** Tag feed (TagFeed /t/:tag), plus the feed toolbar (FeedToolbar) and the "New from following" strip (NewFromFollowing)
- **19d** Groups index (/groups: CommunitiesRender, GroupSort, CommunitiesTags, and the Badges tab)
- **19e** Chat extras: share to chat (ShareChooserModal), composer tools and the emoji/GIF picker (ChatComposerTools, EmojiGifPicker), link card, image lightbox
- **19f** Tip extras (TipModal: MonthlyField, OtherWays, WalletTip, Success) and the standalone /tip page (TipPopup)
- **19g** Small modals: tag picker (AddTagModal, TagsV2Picker), new playlist type (PlaylistTypePicker), Short caption (ShortTextModal), edit hint (EditVideoHintModal), scheduled post editor (ScheduledPostEditor)
- **19h** Incubating creator profile (IncubatingProfile, IncubatingActivity, IncubationBell, IncubationTips, GraduatedFollowsPrompt) and the backfill table (BackfillTable)
- **19i** Streamer tools: OBS overlay and OBS chat overlay (ObsOverlay, ObsChatOverlay), with the follower ticker (SubscriberTicker)
- **19j** Account edge cases: data request (DataRequestForm), sign-in callback (AuthCallback, ManteAuthCallback), Following feed empty state (FollowFeed)

## 20 Home Channel Community v2
File: `designs/3Speak App 20 Home Channel Community v2.dc.html`  
Repo: page/HomeGrouped.jsx, page/ProfilePage.jsx, components/Communities/* · locales: feeds, profile, communities  
Consistency pass 1: Home, Channel and Community in v2
- **20a** Home v2 (replaces 01)
- **20b** Channel v2 (replaces 03a)
- **20c** Community v2 (replaces 03b)

## 21 Search Studio Wallet v2
File: `designs/3Speak App 21 Search Studio Wallet v2.dc.html`  
Repo: NavSearch, page/Discover.jsx, embed-studio/*, studio/*, page/Wallet.jsx · locales: nav, upload, studio, wallet  
Consistency pass 2: Search, Discover, Studio, Upload and Wallet in v2
- **21a** Search v2 (replaces 05a)
- **21b** Discover v2 (replaces 05b)
- **21c** Upload details v2 (replaces 04b): a stepper of tiles, choices as tiles, settings in a side sheet
- **21d** Studio v2 (replaces 04c): content as cards, not a table
- **21e** Wallet v2 (replaces 06a)

## 22 Watch Extras Live v2
File: `designs/3Speak App 22 Watch Extras Live v2.dc.html`  
Repo: Watch side panels, mini player, live/*, OpenPods · locales: watch, live, comments  
Watch extras and Live, redrawn in v2 (replaces 09 and 10)
- **22a** Watch side column tabs: Discussion, Transcript (Transcript), Blog (BlogContent). Translate the title (TitleTranslate) and a timeline toast on the player (TimelineToasters)
- **22b** React to a video (ReactVideoModal, ReactionPlayer): record your reaction beside the original. Supporters (SupportersList), mini player (MiniPlayer), playlist bar (PlaylistBar)
- **22c** Go live (OpenPodPublish): stream templates (StreamTemplates), announcement (AnnounceOptions), guests (GuestListEditor), as one sheet next to the preview
- **22d** OpenPod audio room (OpenPodModal, OpenPodsLiveStrip), and a stream pre-roll (LivePreroll, LiveAdLayer) on mobile

## 23 Onboarding Studio Tools v2
File: `designs/3Speak App 23 Onboarding Studio Tools v2.dc.html`  
Repo: Incubation/*, welcome, embed-studio (record, timeline, thumbnail), CreatorStats, YoutubeImportPage · locales: incubation, upload, stats, ytimport  
Onboarding and Studio tools, redrawn in v2 (replaces 11 and 12)
- **23a** Onboarding on mobile: welcome (WelcomePrompt), track (TrackChooser), interests (InterestsPrompt), profile (ProfileEditModal), a tour spotlight (WelcomeTour)
- **23b** Incubation progress (IncubationProgressPanel, NavProgress), graduation (GraduationPrompt), handle taken (HandleTakenPrompt), add account (AddAccount), active key (ActiveAuthModal)
- **23c** Record and edit (EmbedCameraRecord, EmbedTimeline, TimelineEditor), and the thumbnail editor with its tools (ThumbnailEditorModal: Frame, Text, Sticker)
- **23d** Edit video (EditVideoModal), video stats (VideoStats, CreatorStats), YouTube import (YoutubeImportPage, ImportBatch), upload limits (UploadGate, UploadBlockNotice)

## 24 Audio Profile Extras v2
File: `designs/3Speak App 24 Audio Profile Extras v2.dc.html`  
Repo: AudioUploadModal/*, Podcasts/*, Userprofilepage/*, page/Spotlight.jsx · locales: audio, profile, spotlight  
Audio, podcasts and profile extras, redrawn in v2 (replaces 13 and 14)
- **24a** Audio upload (AudioUploadModal) with the cover designer (CoverDesigner) and audiogram Shorts (AudiogramShortsSection, ShortThumbDesigner)
- **24b** Podcasts tab (PodcastsTab, ContinueListening, DownloadsSection), an episode (EpisodeView, AudioCommentPanel, AudioHype), the podcast tip (PodcastTipModal) and the audio picture-in-picture (AudioPip)
- **24c** Customize your channel (ProfileLayoutEditor, ProfileLayoutTour), channel trailer (ChannelTrailer), followers (Follower)
- **24d** Links page (Spotlight /links/:handle, SpotlightEditor, ArrangeGrid, SocialLinks, AddSocialLink), story viewer (ShortsStories, StoryOwnerTools), snap composer (SnapComposer), watched list (WatchedView)

## 25 Ads Pro Utility v2
File: `designs/3Speak App 25 Ads Pro Utility v2.dc.html`  
Repo: page/Advertise.jsx, ads/*, AdsPrompt/*, Pro, page/Galaxy.jsx, page/Surf.jsx, EmbedPlayer · locales: ads, galaxy, misc  
Ads, Pro and utility screens, redrawn in v2 (replaces 15 and 16)
- **25a** Advertise (Advertise, AdWizard, AdMarketPanels, DayRateChart, FundsNotice)
- **25b** Ads in the player (AdOverlay, AdSkip, BannerClick, TickerCrawl, ShortsAdOverlay), viewer ad settings (AdsPrompt, AdSettingsDialog, ViewerRewardsPrompt), Pro (ThreeSpeakPro, ProPlansPanel)
- **25c** Transaction history (TrxHistory), advertiser admin (AdvertiserAdminPanel, BrandProfileForm, AdvertiserContactForm)
- **25d** Galaxy (GalaxyScene), Surf mode (Surf, SurfBar), embed player (EmbedPlayer)
- **25e** System states: cookies (CookieConsent), offline (OfflineBanner), announcement (AnnouncementModal), what's new (ChangelogModal), review (ReviewModal, ReviewFab), support (SupportModal), QR (QrCode_modal), emergency (EmergencyScreen), skeletons

## 26 Notifications Leaderboard Recap Info v2
File: `designs/3Speak App 26 Notifications Leaderboard Recap Info v2.dc.html`  
Repo: page/Notifications.jsx, nav/NotificationBell, Chat/*, page/Leaderboard.jsx, page/Recap.jsx, Badges, LandingPage/*, Faq, Legal, NotFound  
Notifications, chat, leaderboard, live grid, Recap, badges and info pages, redrawn in v2 (replaces 03c, 05c–d, 06c–d, 08)
- **26a** Notifications sheet (NotificationBell, StoryNotifications, PodcastNotifications) and chat (ChatPage, ChatOverlay)
- **26b** Leaderboard (Leaderboard, PodiumStage, LeaderboardBadges) and the Live grid (LiveStreamRow, OpenPods)
- **26c** Recap (Recap, RecapScene) and badges (BadgePage, BadgesRender, HiveBadges)
- **26d** Info pages: About (AboutPage), FAQ (Faq), Legal (Legal), Invite (InviteLinks, InvitePage), Translate (Translate), 404 (NotFound)

## 27 Global Audio Player v2
File: `designs/3Speak App 27 Global Audio Player v2.dc.html`  
Repo: components/GlobalAudioPlayer/* · locales: audio, player  
Global audio player, every state (GlobalAudioPlayer, Waveform, PlayerMenu, PlayerShare, AudioCommentPanel, AudioHypeButton, AudioPip, AudioPlayerInline)
- **27a** Expanded desktop overlay: opens over any page from the mini player. Waveform with comment pins, queue editing, comments panel, hype
- **27b** Player menu (PlayerMenu): speed, sleep timer, playlist, go to creator, report. Share (PlayerShare) with a start-time clip. Comments panel (AudioCommentPanel). Hype states (AudioHypeButton)
- **27c** Every size of the player: docked bar on desktop, mini bar on mobile, floating picture-in-picture (AudioPip), inline in a post (AudioPlayerInline), lock-screen media card
- **27d** Mobile: full-screen queue, menu as a bottom sheet, comments while listening

## 28 Comments Cards Playlists Audio v2
File: `designs/3Speak App 28 Comments Cards Playlists Audio v2.dc.html`  
Repo: CommentSection, Cards/Card3, ShortsRow, SuggestedCreators, NavSearch dropdown, page/PlaylistView.jsx · locales: comments, cards, playlists  
Final gap fill 1: comments, card states, desktop search, playlists, audio browse
- **28a** Full comments (CommentSection, commentTools, CommentVoteTooltip): sort, threads, collapse, edit and delete, the comment vote slider, editor tools
- **28b** Card states (Card3, CardThumbnail, CardOptionsMenu, CardVoteTooltip, PayoutAmount, LazyPayout, useHoverPreview), the Shorts row on Home (ShortsRow), creator suggestions (SuggestedCreators, PopularCreators)
- **28c** Desktop search dropdown (NavSearch, SearchList): suggestions, recent, quick results by type
- **28d** Playlist page v2 (PlaylistView, VideoPlaylists, PlaylistFollowButton) and playlist cards (PlaylistCard, PlaylistFeedCard, WatchLaterPlaylistCard, WatchedPlaylistCard)
- **28e** Audio browse page v2 (Audio, AudioTile, AudioItemView, AudioPlaylistTile, AudioAuthorBadge, AudiogramEpisodeLink)

## 29 Account Settings Moderation v2
File: `designs/3Speak App 29 Account Settings Moderation v2.dc.html`  
Repo: CreateAccountPanel, SettingsModal (all sections), Communities moderation, AwardBadgeModal, HiveImageUploader, EgressStream, InvitePopup, PullToRefresh  
Final gap fill 2: sign up, every settings section, community moderation, the last utilities
- **29a** Create an account (CreateAccountPanel, LoginNew, KeyChainLogin, Auth_modal, VerifyAuthModal): handle, email, key backup, done
- **29b** Every settings section (SettingsModal, ProfileModal, ProfileFields, LanguagePicker, ThemeToggle): Account, Notifications, Privacy and safety, Wallet and rewards, Keys and security, Language
- **29c** Community moderation (CommunityExtras, Community_modal): queue, roles, settings, mute and pin. Award a badge (AwardBadgeModal, HiveBadges)
- **29d** Last utilities: image upload (HiveImageUploader /image), restream out (EgressStream), invite popup (InvitePopup), pull to refresh (PullToRefresh), the Shorts loading screen (ShortsLoadingScreen), Shorts on start (OpenShortsOnStart)

## 30 Stories Stream Tools Errors v2
File: `designs/3Speak App 30 Stories Stream Tools Errors v2.dc.html`  
Repo: ShortsStoryFeed, stream clip/boost tools, banners, RouteErrorBoundary  
Final gap fill 3: stories, stream tools, banners, badges, error page
- **30a** Stories: watching someone's story (ShortsStoryFeed), creating one (StoryCreatorCard), replying
- **30b** Stream tools for viewers: Clip (StreamClipButton), Boost (StreamBoostButton), Report (StreamReportButton), fullscreen (StreamFullscreenButton), watermark (StreamWatermark), sign-in prompt (StreamSignInButton)
- **30c** Banners and badges: scheduled posts (ScheduledPostsBanner), welcome (WelcomeBanner, IncubationWelcome), publish backlog (BacklogPrompt), supporter rings (SupportersBadges), author and AI/premium badges (AuthorBadge, AiBadge, PremiumBadge), translate button states (TranslateButton)
- **30d** Something went wrong (RouteErrorBoundary), desktop and mobile

## 31 Creator Monetization Depth v2
File: `designs/3Speak App 31 Creator Monetization Depth v2.dc.html`  
Repo: CreatorStats, publish flow, gated videos, ads booking · locales: stats, upload, watch, ads  
Depth pass 1, from the app's text files (src/locales/en): creator stats, publishing states, gated videos, ad booking, Lightning
- **31a** Creator stats in depth (stats.json: ranges, sources, demo, when, compare, trend, tiles)
- **31b** Publishing (upload.json: review, publishing, done, errors). Review checklist, the broadcast steps to Hive, success, and a failed upload
- **31c** Gated and locked videos (watch.json: gated, locked; gated/GuestListEditor): members-only, supporters-only, and region or age locked
- **31d** Ad booking in depth (ads.json: book, flight, inventory, slot, attach, creative, creativeStatus, tickerStyle, apply, mine, listenPrompt, audio)
- **31e** Lightning and support links (settings.json: lightning, supportLinks, referrals), plus "who you support" on a profile (profile.json: supports)

## 32 Social System Depth v2
File: `designs/3Speak App 32 Social System Depth v2.dc.html`  
Repo: Chat/*, remix chains, Galaxy controls, OBS, translator · locales: chat, shorts, galaxy, live, translator, settings  
Depth pass 2, from the app's text files: chat rooms, Short remix and chains, reblog, notification summary, Galaxy controls, OBS setup and lobby, translator, settings extras, system notices
- **32a** Chat in depth (chat.json: newDm, newRoom, channels, thread, leave, markRead, gate)
- **32b** Shorts in depth (shorts.json: remix, chain, playbackMode, watchLater, storyExpired, glow) and reblog (common.json: reblog)
- **32c** Notifications summary and grouping (notifications.json: buckets, summary, group, empty), community picker (communities.json: picker)
- **32d** Galaxy controls (galaxy.json: mode, depth, find, legend, filters, stats, history, circles, desktopOnly)
- **32e** Live in depth (live.json: obs, lobby; misc.json: streamVod): OBS setup with stream key, viewers waiting in the lobby, and the stream replay
- **32f** Translator workspace (translator.json: verify, columns, add, proofread)
- **32g** Settings extras and system notices (settings.json: postingAuth, connectionsTabs, shorts, feed, interests, appearance; app.json: update; misc.json: hiveApi, appUpdate)

## 33 Final Passes v2
File: `designs/3Speak App 33 Final Passes v2.dc.html`  
Repo: Watch states, page/EditVideo.jsx, page/YoutubeImportPage.jsx, welcome · locales: watch, ytimport, welcome  
Final passes: watch.json, welcome.json, ytimport.json, plus a keyword search across every text file
- **33a** Watch-page states (watch.json: topics, tag this video, off-chain vote, clip from video, timeline links, tip nudge, scheduled, media errors, Pro preview, locked)
- **33b** Edit video in full (watch.json: edit): Details, Media and Settings tabs, replace the video file, listing, remix, ads, trailer, NSFW, chapters and links
- **33c** Import from any platform (ytimport.json): YouTube, TikTok, Instagram, BitChute, Rumble. Videos, Shorts and Livestreams, paste a link, the manual-download fallback, a batch status list, limits
- **33d** Welcome banner and desktop tour (welcome.json: banner points, tour steps with spotlight)
- **33e** Keyword pass: install the app (nav.json: installApp, iosInstallHint), push notifications per device (nav.json: push*), cast audio to another device (audio.json: cast), podcast RSS import, Lightning QR and podcast embed (audio.json, misc.json), "have us make the ad" and forecast credit (ads.json: production, tiers, forecast), keep a story as a Short (shorts.json), offline live chat (live.json)

## 34 Passes 3 and 4 v2
File: `designs/3Speak App 34 Passes 3 and 4 v2.dc.html`  
Repo: page/Surf.jsx, Home customizer, Discover filters, audio effects, toasts · locales: feeds, audio, toastCategories  
Passes 3 and 4: a feature-keyword search, plus feeds.json and toastCategories.json read line by line
- **34a** Channel Surfing in full (feeds.json: surf): TV-style channel guide, remote, Zap, Surprise me, tuning and empty channels
- **34b** Customize Home sections (feeds.json: home.sections, dragToReorder, viewAll, firstUploads) and Discover search filters (feeds.json: discover.filters, dates, tag, community, boostRecent, allHidden)
- **34c** Audio extras (audio.json: effects, filters, categories, musicGenre, podcast roles with co-host), Lightning through v4v.app (settings.json: toV4v, useV4v), Galaxy background music (galaxy.json: music)
- **34d** Toast system (toastCategories.json, 38 categories): one toast shape whose icon and colour come from the category. Examples below.

## 35 Upload Depth v2
File: `designs/3Speak App 35 Upload Depth v2.dc.html`  
Repo: embed-studio/*, studio/*, UploadLinks · locales: upload  
Pass 5: upload.json read line by line. Teleprompter, upload resilience, the full publish options, watch-ad-to-publish, the activity log, timeline links
- **35a** Selfie teleprompter (record: script, voice scrolling, presets, text style, orientation, voice test, leave dialog)
- **35b** File checks and upload resilience (select, preview, progress): authorize first, Shorts rules, HEVC preview, resumable chunks, retries and switching method, post as a 24h story
- **35c** Every publish option (details: community, rewards, beneficiaries, remix with 5% to the original, NSFW, add to my blog, ads, ad rolls, members-only with guest list, trailer, schedule)
- **35d** Review with watch-ad-to-publish (review: watchAdToPublish, watchSponsorFirst), the publishing activity log (publishing.log), done with feedback (done.feedback)
- **35e** Timeline link editor (timeline.form: paste a link, 3Speak video, Profile), zoom, full width, chapter errors. Drafts filter (drafts.filters)

## 36 Audio Depth v2
File: `designs/3Speak App 36 Audio Depth v2.dc.html`  
Repo: AudioUploadModal/*, Podcasts/*, GlobalAudioPlayer · locales: audio  
Pass 6: audio.json read line by line. Audio upload modes and earnings, albums, player clips, the podcast app in depth
- **36a** Audio upload (upload: steps, source, titles, mode, earnings, playlist/album, tracks, review, discard)
- **36b** Player extras (player: clipMake, copyAt, download progress, chapters prev/next, hide idle, continue at; tile: Add all / Add new; page: sections, duration filter, Explore/Player tabs)
- **36c** Podcast app (podcasts: views Mine/Discover/Trends, search shows/people, RSS link, OPML, trending by language and category, top charts by country, external chip)
- **36d** Podcast show and episode (seasons, episode search, filters with New inbox, Unplayed and In progress, trailer and bonus badges, Start here, hosts and guests, live episodes, notify, auto-queue, highlights, show notes, video podcast, value-for-value split tip, downloads storage, offline)

## 37 Profile Depth v2
File: `designs/3Speak App 37 Profile Depth v2.dc.html`  
Repo: page/ProfilePage.jsx, Userprofilepage/* · locales: profile  
Pass 7: profile.json read line by line. Every profile tab, supporters, Pro members, streams, profile actions, snap options, the layout editor in full
- **37a** Profile tabs and actions (tabs, page: hide from feeds, report, link external profile, message; stats; subscriberTicker; supports with hide tip; streams; uploads.processing)
- **37b** Empty states for owner and visitor (empty.*), mobile profile action button (fab), add a trailer (trailer.addTitle), snap options: Not interested, Don't show this creator, edit, rewards and beneficiaries (snaps.*), linked profile verification (social.*)
- **37c** Profile layout editor in full (layout: drag, new row, resize, dock to a full-height column, section settings, hidden tray, desktop/mobile, match desktop, undo/redo, reset, add a playlist section, the 8-step tour)

## 38 Settings Depth v2
File: `designs/3Speak App 38 Settings Depth v2.dc.html`  
Repo: SettingsModal/* · locales: settings  
Pass 8: settings.json read line by line. The real tab structure, ads and revenue split, viewer and listener rewards, notification kinds, appearance, Shorts and feed options, about, referrals
- **38a** Settings tabs as in the code (tabs: General, Content, Connections, Ads and rewards, About). Ads and rewards tab
- **38b** General and Content tabs (notifications kinds and groups, device, iPhone note; appearance; shorts; feed: hide AI, private mode; interests)
- **38c** Connections and About tabs (Lightning own address with validation and public note; support links sites; about: version, Hive RPC node; data request done with reference)

## 39 Live Chat Depth v2
File: `designs/3Speak App 39 Live Chat Depth v2.dc.html`  
Repo: live/*, page/WatchStream.jsx, Chat/*, ObsChatOverlay · locales: live, chat  
Pass 9: live.json and chat.json read line by line. Stream Studio steps, OBS templates and stream secret, stream ended, report, recording publish, chat connect, rooms, channels, message actions, share options
- **39a** Stream Studio (obs.tabs, steps, pickTemplate, form: visibility, boosts, payout account, publish recording, allow clips, announce; announce: locked 10% fee)
- **39b** OBS templates (obs: template cards with Offline/Connecting/Live/Ending, stream secret reveal and reset, chat dock URL, WHIP guide, stuck, daily limit, Pro required)
- **39c** After the stream and safety (modal: stream ended, how was it, post a story; report reasons; publish OpenPod recording; lobby: enable hosting; connecting)
- **39d** Chat in depth (gate: connect via Snapie, needs a Hive account; newDm; newRoom with invites; channels browser; thread: edit, delete, quote, forward, typing; share: embed size, send in chat, for Hive post)

## 40 Engagement Communities Depth v2
File: `designs/3Speak App 40 Engagement Communities Depth v2.dc.html`  
Repo: TipModal, vote, components/Communities/* · locales: engagement, communities  
Pass 10: engagement.json and communities.json read line by line. Tip methods and Lightning invoices, monthly support, voters, voting with a topic, the community directory and page in full, creating a community or badge account
- **40a** Tip in full (tip: HIVE/HBD, Lightning, More ways; Lightning invoice QR and waiting; logged-out wallet picker with HiveSigner; monthly until a date, stop), voters list, vote with a topic
- **40b** Community directory and page in full (directory sorts, create locked until Hive account; page: KPIs, New/Trending/Top/Discussion tabs, time windows, pinned Start here, top creators this month, team roles, surf this community, new since your last visit, upload here)
- **40c** Create a community or badge account (create: picture, name and availability, key download, sign with active key and 3 HIVE fee, done, failed; badge variant)

## 41 Spotlight Recap Badges Depth v2
File: `designs/3Speak App 41 Spotlight Recap Badges Depth v2.dc.html`  
Repo: page/Spotlight.jsx, page/Recap.jsx, Badges/*, playlist modals, page/Notifications.jsx · locales: spotlight, recap, badges, playlists, notifications  
Pass 11: spotlight, recap, badges, playlists, notifications and wallet text files read line by line. Spotlight editor in full, the year recap slides, badge directory, page, award and arrange, save-to-playlist and album editing, grouped notifications
- **41a** Spotlight editor in full (templates with Undo, add a block of 5 types, link block with type, platform and icon, style with Apply to all, page style solid/gradient/image, buttons soft/fill/outline, font, motion; drag to arrange; live preview)
- **41b** Your year on 3Speak (intro, uploads, watch time per week with best week, income pillars on a log scale split by on 3Speak / elsewhere and creator / viewer, best leaderboard step; loading steps; empty state; slide nav and tips)
- **41c** Badges (directory with intro, sorts and Held; badge page with KPIs, Videos / Recipients and the publishing summary; award a badge; arrange your badges with Always shown first)
- **41d** Save to playlist (Watch Later, your playlists with Added, create new with privacy, tags and audio kind), album playlist editing with unsaved-changes bar, notifications grouped by day with categories, Activity summary and expandable vote groups

## 42 Auth Nav Invites Depth v2
File: `designs/3Speak App 42 Auth Nav Invites Depth v2.dc.html`  
Repo: page/Login/*, nav/*, page/Invite/* · locales: auth, nav, modals  
Pass 12: auth.json, nav.json and modals.json read line by line. Welcome and sign-in in full, switching accounts, signing with active authority, posting authority, account menu, push and story notifications, invite links
- **42a** Welcome to 3Speak (Butter Auth recommended, any Hive wallet, sign-up blocked on VPN, opening sign up), switch account and remove from list, Keychain QR, confirm with active authority (wallet or private active key), authorize posting authority and verifying
- **42b** Account menu (voting power and resource credits, My Channel, Publish backlog, Analytics, Invite links, Change account, Logout, socials, theme), bell with push on/off and blocked, stories and new podcast episodes, whale/orca vote groups, install app with the iOS hint, hide pages
- **42c** Invite links (stats left, used, created, invited; resets note; who joined with states; paused and used-up; no links yet)

## 43 Comments Transcript Modals Depth v2
File: `designs/3Speak App 43 Comments Transcript Modals Depth v2.dc.html`  
Repo: CommentSection, transcript panel, modal/*, CookieConsent, Cards status, NotFound, LandingPage · locales: comments, modals, consent, cards, pages, tags  
Pass 13: comments, posts, cards, consent, tags, pages and the rest of modals.json read line by line. Comment composer and pins, transcript with search and caption editing, linked profiles, report, the editor render flow, feedback, storage consent, card states, 404 and About
- **43a** Comments in full (Comment / React tabs, Write / Preview, add or drop an image, sort Newest / Oldest / Popular, pinned by creator, hidden comment, translation, open in Shorts), transcript (language, search with matches, timecodes, copy, edit captions), live VOD processing and sign-in prompts
- **43b** Linked external profiles (list, three-step verify with hash, errors), report with reasons per type, tag this video with the 36 topics and an existing tag, the edit-video hint, the video editor's render flow and Post it as Story or Short
- **43c** Feedback (contextual titles, stars, what it's about, would you recommend), cookies and browser storage with and without ads, card status badges and watching now, 404, About page sections

## 44 System Welcome Studio Depth v2
File: `designs/3Speak App 44 System Welcome Studio Depth v2.dc.html`  
Repo: App.jsx system banners, RouteErrorBoundary, page/Invite, welcome, UploadLinks, ScheduledPostEditor, MarkdownComposer · locales: app, misc, studio  
Pass 14: app.json, misc.json and studio.json read line by line. Account blocks, outage, update and changelog, route errors, invite landing, welcome for creators and advertisers, the profile fields, the full Create menu, embeds, scheduled post editing and the description composer
- **44a** System states (banned, upload disabled with a team note, infrastructure issues, new version available, updating for an upload, we shipped an update with categories, page didn't load and page broke with details, HiveAuth approval)
- **44b** Invite landing (fast track or free profile), Welcome for creators and for advertisers (six things each), the profile fields (banner 2800 × 684, picture, display name, bio, location), interests
- **44c** Create menu in full (Video, Audio, Live, Others; 10 entries), studio start (edit your draft or create new; HEVC preview note), embed audio / playlist / podcast (with title, compact, minimal, responsive), edit scheduled post (calendar, manual date, past warning, range, payout, cancel), description composer (toolbar, editor / split / preview, emoji and GIFs)

## 45 Stats Shorts Translator Depth v2
File: `designs/3Speak App 45 Stats Shorts Translator Depth v2.dc.html`  
Repo: CreatorStats, page/Short.jsx, page/WatchStream.jsx, page/WatchedView.jsx, page/Leaderboard.jsx, page/Translate/* · locales: stats, shorts, misc, translator  
Pass 15: stats, shorts, translator and the rest of misc.json read line by line. Per-video stats and audience, Shorts feed modes and story tools, the live stream watch page, watch history, leaderboard metrics, the translation editor
- **45a** Stats in depth (per video: unique viewers, avg speed, retention with drop-off and early drop, most replayed hot spot; audience: viewer locations map / breakdown, new vs returning, 3Speak vs embed player, devices and browsers; compare videos; private footnote)
- **45b** Shorts in full (Discover / My interests with the exhausted note, playback mode Auto-Replay / Auto-Swipe / Manual, ambient light, curated caption with show original, reaction chain and remix limits, post removed, audiogram full episode, rotate device), story tools (seen by, keep as short) and story expired, story card with streak and rep
- **45c** Live stream watch page (vertical / full view, drag to look around, swipe for the next stream, hide controls, vote and comment, more #tag, not live and not found, VOD upload progress), watch history (videos, shorts, audio; track history; remove), leaderboard metrics in Video / Streaming / Stories with sub-metrics and rank badges
- **45d** Translation editor (invited translators only, confirm account, language and areas, missing only / edited by community / not proofread, key / English / translation rows with plurals, community badge, reset, proofread marks and progress, unsaved bar, add a language with RTL)

## 46 Warm-up Depth v2
File: `designs/3Speak App 46 Warm-up Depth v2.dc.html`  
Repo: components/Incubation/* (IncubatingProfile, IncubationProgressPanel, BackfillTable, GraduationPrompt) · locales: incubation  
Pass 16: incubation.json read line by line. The warm-up in full: picking a path, the goal list per path with what counts, the warm-up profile for owner and visitor, advertiser brand and private contact, graduation, publishing the backlog to Hive, and the edge cases
- **46a** Warm-up intro (welcome, you are in your warm-up, what you can do now, the path and its perks), what brings you to 3Speak (five tracks), tip cards, nav progress ring
- **46b** Your path to a Hive account (goals grouped Create / Watch and join in / Find your people / Give it a few days, each with why and what counts, done state, optional social link, review pending or done), warm-up profile with owner and visitor notes, tabs and unlocks
- **46c** Advertiser warm-up (brand profile, private business contact with the address-or-website rule), admin view, graduation for creator / viewer / advertiser, someone you follow got upgraded, name taken, reconnect your session
- **46d** Publish what you made earlier (backlog prompt, timeline / by type, status per item, select and publish, one video every 5 minutes, out of resource credits, waiting on someone else, not coming across, nothing left)

## 47 Advertise Depth v2
File: `designs/3Speak App 47 Advertise Depth v2.dc.html`  
Repo: page/Advertise.jsx, AdsPrompt/*, ads overlay/ticker/gate, promote + ad wizard · locales: ads  
Pass 17: ads.json read line by line. The Advertise page in full (three steps, formats, audience, price explorer), enrolling a product and its ad, booking and paying, flights and delivery, the ads viewers see, and the creator and viewer prompts
- **47a** Advertise: General tab (your ad live in three steps, format groups Takes the screen / Over the picture / Before an upload / In the audio player, audience numbers with the quality note, work out your price chart), Enroll your ad / My products tabs
- **47b** Enroll your ad (steps Your product / Your ad / Book a slot; register a product with category, budget, markets and concept; what are you running; ticker editor with crawl or hold, timing check and listen; how your ad is labelled; have us make it with four tiers; saved but not finished)
- **47c** Book and pay (days with saving, start date, when in the video with places left and shared positions, video length filter, audio too, total with credit, forecast; pay with wallet or memo, wrong account, confirming; no funds with exchange steps), My products with flights, blocked reasons, delivery and credit, book again
- **47d** What viewers see (video roll with continues-in and skip, stream starts in, tap for sound, ticker, sponsor gate before Post Video), ads on your videos for creators (four points, step 2 of 2, split), get paid for watching, earn for listening too, promote this video (boost in feeds or run it as an ad) and the run-as-an-ad wizard

## 48 Galaxy Player FAQ Depth v2
File: `designs/3Speak App 48 Galaxy Player FAQ Depth v2.dc.html`  
Repo: page/Galaxy.jsx, VideoControls settings, reactions, page/Faq.jsx, announcement · locales: galaxy, player, faq, announcement, common  
Pass 18: galaxy, player, faq, announcement, common and editor text files read line by line. The Hive galaxy in full, player sizes and subtitle styling, video reactions, hype and reblog, team announcements with replies, the FAQ page
- **48a** Hive galaxy (Following / Followers / Friends, scan depth Orbit to Deep space, find or explore, legend, filters, circles, creators to discover, star card, back and forward, music, mapping progress, desktop-only)
- **48b** Player extras (react to this moment, marker replies, player size, autoplay, ambient light, subtitle styling, next video in, reactions panel with sizes S to Cinema), post a video reaction (record or upload, show in Shorts, authorize @threespeak), inline can't play, hype and reblog, team announcement with reply
- **48c** FAQ page (five groups, 25 questions, an open answer with links, copy link to a question, still have a question)

## 49 Legal Batch Import Depth v2
File: `designs/3Speak App 49 Legal Batch Import Depth v2.dc.html`  
Repo: page/Legal.jsx (English-only body), page/ImportBatch.jsx, page/FirstUploads.jsx, page/EmbedPlayer.jsx  
Pass 19: page files with hard-coded English (Legal.jsx, ImportBatch.jsx, FirstUploads.jsx, EmbedPlayer.jsx). The data page, the batch import form and status, the First Uploads feed and the bare embed player
- **49a** How 3Speak handles your data (English-only notice, not-a-policy banner, public blockchain first, eight sections with the processing table, retention and rights)
- **49b** Batch import (Import 5 videos: Content and Settings steps with the upload settings tiles, shorts note, spacing, posting permission; batch status per video with scheduled-in times and stop confirm)
- **49c** First Uploads feed (header icon, grid, loading more, fetch error) and the bare embed player inside Spotlight (landscape, 9:16 short with no autoplay, video unavailable)
