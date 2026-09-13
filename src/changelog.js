// 3Speak changelog (preview). NEWEST FIRST. One entry per commit to preview.
// Each `version` must line up with the APP_VERSION bumps in version.js.
// Entry `summary` should be 1–5 sentences, simple and user-facing — when a feature
// changes, name the button/page (and route) so people know where to find it.
//
// NOTE: production users start at the 1.0.0 baseline, so every entry sits ABOVE
// 1.0.0 — that way they see all of these when develop is pushed to production.
export const CHANGELOG = [
  {
    version: '1.78.68',
    date: '2026-09-11',
    summary:
      'Communities and badges now live together under Groups in the top bar, and you '
      + 'can create either one from there. A community is a space people join; a badge '
      + 'is an award you hand out. Once you have made a badge, an Award button on '
      + 'anyone\'s profile gives it to them, with no account switching and no keys to '
      + 'dig out.',
  },
  {
    version: '1.78.67',
    date: '2026-09-11',
    summary:
      'General interface fixes across the site. Profile pictures and banners uploaded '
      + 'through 3Speak now show up everywhere instead of a grey placeholder, avatars '
      + 'in the stories bar are no longer cropped, and badge pages list videos newest '
      + 'first.',
  },
  {
    version: '1.78.66',
    date: '2026-09-09',
    summary:
      'The badges on a profile now open here instead of sending you to PeakD. '
      + 'Click any badge someone holds to see everyone else who holds it and what '
      + 'they publish on 3Speak.',
  },
  {
    version: '1.78.64',
    date: '2026-09-08',
    summary:
      'The "Replace video" button in a video\'s Edit window now works on older videos '
      + 'too, including ones from before the current upload system whose file had gone '
      + 'missing. The video keeps its post, its date, its views and its place in your '
      + 'profile.',
  },
  {
    version: '1.78.63',
    date: '2026-09-04',
    summary:
      'The 3Speak Pro panel in your wallet now opens on a General tab, listing the '
      + 'benefits that apply to everyone first.',
  },
  {
    version: '1.78.62',
    date: '2026-09-04',
    summary:
      'The page tabs in the top bar now fold away behind the logo. Click it to show or '
      + 'hide them, and your choice is remembered.',
  },
  {
    version: '1.78.61',
    date: '2026-09-04',
    summary:
      'The home page now shows smaller video cards by default. You can change this in '
      + 'Settings.',
  },
  {
    version: '1.78.60',
    date: '2026-09-04',
    summary:
      'Pop-up messages now show a short heading saying what they are about, and sit below '
      + 'the title bar instead of covering the account menu.',
  },
  {
    version: '1.78.59',
    date: '2026-09-03',
    summary:
      'The Share menu on a video page now has an “Embed on a website” option. It gives you '
      + 'ready made HTML to paste into a blog or any other site, either a responsive size that '
      + 'fits the page it sits on or a fixed size like 560 x 315, and one click copies it to '
      + 'your clipboard.',
  },
  {
    version: '1.78.58',
    date: '2026-09-02',
    summary:
      'Video thumbnails show the video\u2019s length again. The duration was being drawn '
      + 'behind the picture, so it only appeared on cards whose image had not loaded yet.',
  },
  {
    version: '1.78.57',
    date: '2026-08-30',
    summary:
      'You can now set your channel trailer from a video’s Edit screen, not just while '
      + 'uploading. Open Edit on one of your landscape videos and turn on “Channel trailer”. '
      + 'It also shows when a video already is your trailer, so you can turn it off.',
  },
  {
    version: '1.78.56',
    date: '2026-08-27',
    summary:
      'Big uploads on mobile connections now finish instead of getting stuck near the end. '
      + 'Videos are sent in smaller pieces, so a weak signal no longer makes the last part of '
      + 'an upload retry over and over, and uploads now start on one connection and open more '
      + 'only once the first piece arrives. The upload screen also shows the correct confirmed '
      + 'amount instead of about half of it.',
  },
  {
    version: '1.78.55',
    date: '2026-08-27',
    summary:
      'The community picker when you publish now lists the communities you are subscribed to '
      + 'straight away, under Your communities, so you can pick one without searching. 3Speak '
      + 'stays pinned at the top, and if you are not subscribed anywhere yet you get a list of '
      + 'popular communities to choose from.',
  },
  {
    version: '1.78.54',
    date: '2026-08-27',
    summary:
      '3Speak now picks the best-connected Hive server when it starts and sticks with the ones responding fastest. Profiles, comment threads and posting all load more steadily.',
  },
  {
    version: '1.78.53',
    date: '2026-08-27',
    summary:
      'Posting a short, an audio snap or a community snap now lands the first time. 3Speak checks several Hive servers automatically instead of relying on just one.',
  },
  {
    version: '1.78.52',
    date: '2026-08-24',
    summary:
      'You can now copy a video\'s transcript with or without timestamps, and we remember which '
      + 'you prefer. Publishing a video and pressing "Go To My Profile" now takes you to your '
      + 'profile instead of back to the uploader.',
  },
  {
    version: '1.78.51',
    date: '2026-08-22',
    summary:
      'Uploads are more reliable on slow and mobile connections. You can now cancel an upload that is not moving, and the upload screen is simpler.',
  },
  {
    version: '1.78.50',
    date: '2026-08-22',
    summary:
      'Publishing right as an upload finishes now waits for the server to catch up instead of asking you to press Post again.',
  },
  {
    version: '1.78.49',
    date: '2026-08-22',
    summary:
      'Uploads are steadier on patchy mobile connections. If an upload switches to the more compatible method partway through, it now carries straight through to publishing, so your video lands the first time.',
  },
  {
    version: '1.78.48',
    date: '2026-08-22',
    summary:
      'Browser notifications are here. Turn them on from the bell or in Settings → Notifications, and 3Speak can reach you even when it\'s closed: new videos, shorts and audio from creators you follow, plus replies, mentions and new followers. You choose which ones.',
  },
  {
    version: '1.78.47',
    date: '2026-08-22',
    summary:
      'Browser tabs and shared links now lead with 3S, so a 3Speak tab is easy to spot. Community pages show the community\'s name instead of its id.',
  },
  {
    version: '1.78.46',
    date: '2026-08-20',
    summary:
      'Every channel now has a podcast feed at 3speak.tv/rss/username.xml, covering their videos and audio uploads. Subscribe in any podcast app or RSS reader, or use the new feed button on a profile.',
  },
  {
    version: '1.78.45',
    date: '2026-08-20',
    summary:
      'Videos with subtitles now have a Transcript tab beside the video, next to Reactions. Read along, click any line to jump there, switch language, or copy the whole thing.',
  },
  {
    version: '1.78.44',
    date: '2026-08-20',
    summary:
      'Videos posted outside a community no longer show a community name on the watch page.',
  },
  {
    version: '1.78.43',
    date: '2026-08-20',
    summary:
      'The Leaderboard (/leaderboard) now only shows the note about when watch-time tracking started on the boards it actually applies to, so the 7 and 30 day boards read clean.',
  },
  {
    version: '1.78.42',
    date: '2026-08-19',
    summary:
      'Links in video descriptions, comments and community posts now open in a new tab, so clicking one never costs you an upload in progress or your place in a video.',
  },
  {
    version: '1.78.41',
    date: '2026-08-19',
    summary:
      'Profile polish: 3Speak badges now match the Hive badges beside them for a calmer header, and a channel trailer\'s description takes the full width when there is no community post next to it.',
  },
  {
    version: '1.78.40',
    date: '2026-08-19',
    summary:
      'Empty tabs on your own profile now point you straight at what to do next: Videos, Shorts, Audio and Playlists each offer the matching upload or create button.',
  },
  {
    version: '1.78.39',
    date: '2026-08-19',
    summary:
      'The Overview tab on a profile now shows what is inside each playlist: one row of videos per playlist, right above the playlist covers. Hit View all to open the whole playlist.',
  },
  {
    version: '1.78.38',
    date: '2026-08-19',
    summary:
      'Profiles now show a creator\'s links page next to their Overview tab (/p/username), in 3Speak\'s own colours. Fold it away with the arrow in its corner and it stays folded until you bring it back. On phones there\'s a Links button under Message.',
  },
  {
    version: '1.78.37',
    date: '2026-08-17',
    summary:
      'The Leaderboard (/leaderboard) now shows your own position in a tidier card, with your profile picture sized to match the rest of the board.',
  },
  {
    version: '1.78.36',
    date: '2026-08-17',
    summary:
      'On your own profile you can now choose the order your Hive badges appear in: open the badge list, hit Arrange, drag them where you want them and save. The order is stored on your Hive account, so everyone sees your favourites first. 3Speak badges stay pinned at the front.',
  },
  {
    version: '1.78.35',
    date: '2026-08-17',
    summary:
      'Profiles now show the Hive badges a creator has earned, just above their 3Speak badges. The first few sit in the profile header, and "Show more" opens the full list with a short note on what each badge is for. 3Speak badges always come first.',
  },
  {
    version: '1.78.34',
    date: '2026-08-17',
    summary:
      'Video descriptions, comments and community posts now use Hive\'s official renderer, so text, mentions, tags and images look the same here as in other Hive apps. 3Speak videos and audio still open as players, and other links you paste stay as tidy clickable links.',
  },
  {
    version: '1.78.33',
    date: '2026-08-14',
    summary:
      'Announcing an OpenPod room now brings people straight into the conversation with a "Join the live session" link (/openpods), while solo streams keep their player so followers can watch right from their feed.',
  },
  {
    version: '1.78.32',
    date: '2026-08-14',
    summary:
      'Your 3Speak posts now describe themselves in a shared format that other Hive apps can read, so your videos, shorts and audio show up the way you meant them to wherever people follow you. It uses the open Hive standard from openattribute.app.',
  },
  {
    version: '1.78.31',
    date: '2026-08-13',
    summary:
      'Text stays selectable while a video plays, so you can copy from the description, comments and reaction threads without losing your selection.',
  },
  {
    version: '1.78.30',
    date: '2026-08-12',
    summary:
      'The same emoji picker now opens everywhere you write, from video descriptions to community posts and stream details, matching the one already used in chat and comments.',
  },
  {
    version: '1.78.29',
    date: '2026-08-12',
    summary:
      'Links inside video descriptions, posts and comments are now checked more strictly, so only genuine web links can open.',
  },
  {
    version: '1.78.28',
    date: '2026-08-12',
    summary:
      'Housekeeping: 3Speak\'s foundations got a big update, with security improvements throughout and a clear-out of unused code.',
  },
  {
    version: '1.78.27',
    date: '2026-08-11',
    summary:
      'Notifications read more naturally, with mentions and replies now worded correctly whether one other person is involved or several.',
  },
  {
    version: '1.78.26',
    date: '2026-08-11',
    summary:
      'Interests got easier to set: you can now pick a whole area (like Gaming) as an interest, and find any area just by typing its name. Discover follows your picks more closely, with related topics just behind them.',
  },
  {
    version: '1.78.25',
    date: '2026-08-11',
    summary:
      'Subtitles now load more dependably on the watch page. Turn them on with the CC button in the player and pick your language.',
  },
  {
    version: '1.78.24',
    date: '2026-08-11',
    summary:
      'Creator Analytics are sharper: each video now reports its true length, so the retention graph and the most replayed bar on your Analytics tab reflect how people really watch.',
  },
  {
    version: '1.78.23',
    date: '2026-08-11',
    summary:
      'Uploading is smoother: smaller files take a quicker single-step path, and larger uploads keep moving steadily from start to finish.',
  },
  {
    version: '1.78.22',
    date: '2026-08-11',
    summary:
      'Profile tabs now show counts at a glance: Videos, Shorts and Audio each display how many there are, alongside the Community and Playlists counts.',
  },
  {
    version: '1.78.21',
    date: '2026-08-11',
    summary:
      'Profile Overview links now go where you expect: Read more under the channel trailer opens that video, and Read more on a community post opens it in the Community tab.',
  },
  {
    version: '1.78.20',
    date: '2026-08-04',
    summary:
      'Community pages look tidier on a phone, with the community picture centred above its name.',
  },
  {
    version: '1.78.19',
    date: '2026-08-04',
    summary:
      'No channel trailer yet? Your profile now has an Upload a channel trailer button that takes you straight to the upload with the trailer option already ticked.',
  },
  {
    version: '1.78.18',
    date: '2026-08-04',
    summary:
      'Followers and Following now show who they actually are: each person\'s follower count, plus how many videos and shorts they have on 3Speak. Big lists load in pages as you scroll.',
  },
  {
    version: '1.78.17',
    date: '2026-08-04',
    summary:
      'Free live streams can now run for a full hour, and the stream setup screen shows exactly what 3Speak Pro adds.',
  },
  {
    version: '1.78.16',
    date: '2026-08-04',
    summary:
      '3Speak Pro has a fresh look in your wallet: perks grouped into tabs for uploads, live streaming and bonus features, with clear pricing and the free 24-hour trial in one place.',
  },
  {
    version: '1.78.15',
    date: '2026-08-04',
    summary:
      'The Wallet page is tidier: Overview and Transactions are now separate tabs, and your HIVE and HBD sit side by side, including on a phone.',
  },
  {
    version: '1.78.14',
    date: '2026-08-04',
    summary:
      'Profiles have a cover image: set yours when you sign up, or later from your profile. Notification avatars are clearer too.',
  },
  {
    version: '1.78.13',
    date: '2026-08-04',
    summary:
      'Profile tabs now sit on one line you can swipe through, and the Overview rows show many more videos and shorts — scroll them sideways.',
  },
  {
    version: '1.78.12',
    date: '2026-08-04',
    summary:
      'Profiles now open on a new Overview tab: a channel trailer plays at the top, followed by preview rows of your videos, shorts, audio and playlists. Mark any video as your trailer from its details while uploading.',
  },
  {
    version: '1.78.11',
    date: '2026-08-03',
    summary:
      'Discover leans a little more on the newest uploads, hovering a short shows its description, and the suggested creators row now scrolls with arrows.',
  },
  {
    version: '1.78.10',
    date: '2026-08-03',
    summary:
      'Chat keeps your unread count in step with your messages, and you can clear them all at once with Mark all as read on the chat page (/chat).',
  },
  {
    version: '1.78.9',
    date: '2026-08-03',
    summary:
      'Mobile navigation update: the + button for sharing moved up to the top bar, and Chat now sits in the middle of the bottom bar with your unread count on it.',
  },
  {
    version: '1.78.8',
    date: '2026-08-03',
    summary:
      'New on the home page: a row of the creators you follow who posted something you have not watched yet, showing how many new shorts and videos each of them has.',
  },
  {
    version: '1.78.7',
    date: '2026-08-03',
    summary:
      'Profiles now lead with your display name, with your @username and location underneath and a bigger profile picture.',
  },
  {
    version: '1.78.6',
    date: '2026-08-03',
    summary:
      'New to 3Speak? A short welcome introduces what you can do here: videos, shorts, live streams and communities, and helps you set up your profile in one step.',
  },
  {
    version: '1.78.5',
    date: '2026-08-03',
    summary:
      'You can now edit your profile on 3Speak: press Edit (or your picture) on your profile page to set your profile picture, display name, bio and location. It saves to your Hive account, so every Hive app shows it.',
  },
  {
    version: '1.78.4',
    date: '2026-07-29',
    summary:
      'Video cards on community pages now show the topic and comment count, matching the cards in the feeds and on profiles.',
  },
  {
    version: '1.78.3',
    date: '2026-07-28',
    summary:
      'When you replace a video, the upload now shows which server it is going to, and the confirmation reminds you the new file needs a few moments to finish encoding.',
  },
  {
    version: '1.78.2',
    date: '2026-07-28',
    summary:
      "Small polish: the feedback button no longer sits over the mini player on mobile, the chat icon's unread count lines up properly, and the About page reads correctly in light mode.",
  },
  {
    version: '1.78.1',
    date: '2026-07-28',
    summary:
      'Signing in and switching accounts is smoother, with 3Speak offering only the options that match how you logged in.',
  },
  {
    version: '1.78.0',
    date: '2026-07-28',
    summary:
      'You can now swap the video file on a post you already published. Open Edit on your video and use Replace video: your likes, payout, comments, upload date and its place on your profile all stay exactly as they are.',
  },
  {
    version: '1.77.5',
    date: '2026-07-28',
    summary:
      'Videos on the watch page start sooner: playback now begins loading immediately instead of waiting for the rest of the page details.',
  },
  {
    version: '1.77.4',
    date: '2026-07-28',
    summary:
      '3Speak now starts noticeably faster. Each page loads only what it actually needs, so the app appears sooner and moves quicker as you browse.',
  },
  {
    version: '1.77.0',
    date: '2026-07-25',
    summary:
      'Spotlight link pages can now feature your videos and shorts, playing right on the page in the 3Speak player, with shorts shown vertically.',
  },
  {
    version: '1.76.0',
    date: '2026-07-24',
    summary:
      'New: your own link page. Every creator gets a Spotlight page at 3speak.tv/links/yourname, built from the new Links tab on your profile. Add link buttons, embed your videos or latest posts and images, then style it with backgrounds, fonts, motion and ready-made templates.',
  },
  {
    version: '1.75.0',
    date: '2026-07-24',
    summary:
      'When you pick your interests in the welcome popup, the Home feeds now update right away to match, without reloading the page.',
  },
  {
    version: '1.74.0',
    date: '2026-07-24',
    summary:
      '3Speak now starts in dark mode for new visitors. Your saved choice still applies, and you can switch anytime in Settings.',
  },
  {
    version: '1.73.0',
    date: '2026-07-23',
    summary:
      'You can now add a topic tag to a video even after its rewards window has ended, so it still helps sort content by topic.',
  },
  {
    version: '1.72.0',
    date: '2026-07-22',
    summary:
      'New Review button floating on every page: rate 3Speak and send feedback in a few taps.',
  },
  {
    version: '1.71.0',
    date: '2026-07-22',
    summary:
      'Community pages got an upgrade: a Subscribe button that shows whether you are already subscribed, live stats from Hive (subscribers, active posters, posts and more), and New/Trending are now proper tabs — with the community description moved beside the video grid on desktop.',
  },
  {
    version: '1.68.0',
    date: '2026-07-19',
    summary:
      'Large video cards now show the topic (for example Entertainment or Food & Outdoors) next to the view count, based on the automatic tagging.',
  },
  {
    version: '1.67.0',
    date: '2026-07-19',
    summary:
      'Video cards now show the comment count alongside views and likes — in the feeds and in the More videos list on a watch page.',
  },
  {
    version: '1.66.0',
    date: '2026-07-19',
    summary:
      'New Popular creators row on Discover: creators from the trending list you are not following yet, with their follower count and a Follow button.',
  },
  {
    version: '1.65.0',
    date: '2026-07-19',
    summary:
      'Shorts can now be up to 2 minutes long, instead of 60 seconds. The upload limit and the hints in the Short uploader and the React-video box have been raised to match.',
  },
  {
    version: '1.64.0',
    date: '2026-07-18',
    summary:
      'Recently updated public playlists now show up as their own card in the home feeds, and the feeds respect a creator’s choice to keep a video out of them.',
  },
  {
    version: '1.62.0',
    date: '2026-07-18',
    summary:
      'New topic picker when you vote: choose a broad category (Entertainment, Tech & Science, …) and then, if you like, a specific topic. The leaderboard groups its topics the same way, and picking a category there now covers all the topics under it. The vote dialog also remembers your last vote weight, kept separately for videos, shorts and comments.',
  },
  {
    version: '1.60.0',
    date: '2026-07-18',
    summary:
      'The Upload menu is now called Share, with a new Community Snap entry (your profile\'s Community tab). Logged-out visitors get an About 3Speak button next to Log in, and the About page now follows the app\'s light and dark theme.',
  },
  {
    version: '1.59.0',
    date: '2026-07-18',
    summary:
      'GIFs and emojis in comments and posts, using the same pickers as chat. Look for the smiley and GIF buttons under the comment box on the watch page, shorts and community posts, and in the video and community post editors.',
  },
  {
    version: '1.58.0',
    date: '2026-07-16',
    summary:
      'Community posts got a round of polish: edit your own posts with the pencil on the post card, and like/comment counts now update instantly after you vote or reply. In the home feeds, comments on a community post open in a popup, and your own posts live on your profile’s Community tab instead of appearing in your own feed.',
  },
  {
    version: '1.57.0',
    date: '2026-07-16',
    summary:
      'New Community tab on creator profiles: post short written updates ("snaps") to your followers, with tags, images and links. Community posts also show up between the videos in your home feeds, where you can like, comment, and follow the creator right there. Discover and New Content show the latest from everyone; your Interests and Follow Feed show posts from the people you follow.',
  },
  {
    version: '1.56.0',
    date: '2026-07-15',
    summary:
      'Playback polish, especially for older videos: a new 3Speak loading animation while a video starts up, plus smoother, steadier playback.',
  },
  {
    version: '1.55.0',
    date: '2026-07-12',
    summary:
      'Shorts now also show up between the recommended videos on a watch page, picked to match the topic of the video you’re watching. Don’t want shorts mixed into your lists? Turn off \u201CShorts inside the feeds\u201D in Settings → Shorts. On the Stories view, the comments panel no longer covers the creators bar and now closes away completely.',
  },
  {
    version: '1.54.0',
    date: '2026-07-12',
    summary:
      'Shorts now appear inside the home feeds — a row of them every couple of rows of videos. Discover and Interests show the usual shorts, the Follow Feed shows only shorts from people you follow, and New Content shows the newest first. The Trending tab has been removed.',
  },
  {
    version: '1.53.0',
    date: '2026-07-12',
    summary:
      'Settings is reorganised into tabs — General, Shorts, Content, Interests and Version — so options are easier to find. The browser tab now also shows which page you’re on instead of always saying “3Speak”.',
  },
  {
    version: '1.52.0',
    date: '2026-07-12',
    summary:
      'Shorts overhaul. Switch between “Discover” and “My interests” with the toggle at the top-left, save a short to Watch Later with the new bookmark button, and swiping no longer skips over videos. The comment bar under a short and “open shorts on start” are now optional in Settings → Shorts.',
  },
  {
    version: '1.51.0',
    date: '2026-07-12',
    summary:
      'New Leaderboard page (/leaderboard) ranking the top creators, with a “Top 10 Video Creator” badge shown on their profiles.',
  },
  {
    version: '1.50.0',
    date: '2026-07-12',
    summary:
      'The app is a lot lighter. Thumbnails and avatars are now served at sensible sizes (some thumbnails were several megabytes), feeds send far less data, and a card only loads its video when you actually look at it. Pages should feel noticeably quicker — especially on mobile data.',
  },
  {
    version: '1.49.0',
    date: '2026-07-12',
    summary:
      'Feeds are more personal. A new Discover row and an Interests row pick videos from the topics you choose and from what people actually watch — not just from votes. You can also say what you don’t want: “Not interested” and “Don’t show this creator” in a card’s ⋮ menu.',
  },
  {
    version: '1.48.0',
    date: '2026-07-12',
    summary:
      'You can now tag videos with a topic. Pick one in the vote dialog when you vote, or use “Add tag” in a video card’s ⋮ menu to tag without voting. Tags are shared by everyone and help the right videos reach the right people.',
  },
  {
    version: '1.47.0',
    date: '2026-07-09',
    summary:
      'Home page tidy-up: on desktop the section tabs (Trending, New, Follow…) now scroll you straight to each row, and on mobile promoted videos live in the Follow tab. Post descriptions are cleaner too — auto-embedded links no longer duplicate the video player.',
  },
  {
    version: '1.46.0',
    date: '2026-07-08',
    summary:
      'Feeds are smarter now: they rank videos partly by how much people actually watch them and lean toward the interests you’ve picked — across Home, Trending, Follow and tag pages. Also new: a “Private mode” setting that keeps your IP out of watch stats (only an anonymous id is used).',
  },
  {
    version: '1.45.0',
    date: '2026-07-07',
    summary:
      'Videos you publish now embed and play correctly on other Hive apps like PeakD and Ecency — not just on 3Speak — so your posts look right everywhere they’re seen. Uploads are also a bit more reliable now, preferring the faster upload servers.',
  },
  {
    version: '1.44.0',
    date: '2026-07-07',
    summary:
      'Your feeds now hide videos you’ve already watched by default, so Home, Trending and the Follow Feed keep surfacing fresh content instead of repeats. You can switch this off any time under Settings → “Hide watched”.',
  },
  {
    version: '1.43.0',
    date: '2026-07-07',
    summary:
      'New “Stats” tab on your profile: watch time and views for a time range you pick, your best-performing videos, per-video insights like where people drop off and the moments they replay most, plus viewer demographics. Your own videos also get a “Stats” button on the watch page.',
  },
  {
    version: '1.42.0',
    date: '2026-07-06',
    summary:
      'Cleaner player controls on phones: the timeline and play buttons now fade away together while you’re just watching (they no longer stay stuck at the bottom), and they show for a few seconds when a video opens so you can see where everything is.',
  },
  {
    version: '1.41.0',
    date: '2026-07-06',
    summary:
      'The watch page timeline now has a “most replayed” graph just above the scrubber — taller sections are the moments people watch and rewatch most, so you can jump straight to the highlights.',
  },
  {
    version: '1.40.0',
    date: '2026-07-06',
    summary:
      'Easier to aim when scrubbing: hover or drag along the video timeline and a small preview of that moment pops up above the bar, so you can find the right spot before you jump there.',
  },
  {
    version: '1.39.0',
    date: '2026-07-05',
    summary:
      'Video uploads are more reliable now. If your network blocks a normal upload (common on some mobile or work connections), it automatically switches to a more compatible method that resumes if the connection drops. You can also turn it on yourself with the new “Reliable upload” checkbox on the upload screen.',
  },
  {
    version: '1.38.0',
    date: '2026-07-04',
    summary:
      'Tags are handled more consistently everywhere. The uploader now shows a live tag count and includes the community tag right in your tag list, so the total can never sneak past 10, and it no longer adds hidden “3speak” or “short” tags. The Edit page uses the same limit, and the community tag is shown but can’t be removed.',
  },
  {
    version: '1.37.0',
    date: '2026-07-04',
    summary:
      'You can now edit your own shorts. Open a short you posted and tap Edit to change its description, tags, thumbnail and settings (unlist/re-list, mark adult/NSFW). Unlisted shorts now also show on your own profile with an “Unlisted” badge so you can find and re-list them.',
  },
  {
    version: '1.36.0',
    date: '2026-06-26',
    summary:
      'The video watch page has a cleaner desktop layout: the player sits flush at the top, the title shows views, age, rewards and votes beside it, and all the action buttons (Vote, Tip, Reshare, Clip, Share, Promote, Playlist, Report) are now consistent pill buttons in one tidy row, with the description in a rounded card below.',
  },
  {
    version: '1.35.0',
    date: '2026-06-26',
    summary:
      'Watch pages are more reliable: video pages now load their details directly from Hive and 3Speak’s own services instead of a separate API, so they keep working even when that API is down. This also trims an external dependency under the hood.',
  },
  {
    version: '1.34.0',
    date: '2026-06-26',
    summary:
      'The review step before publishing a video now looks just like the finished post: your video player (showing the thumbnail until you press play), then the title and the description exactly as viewers will see them — YouTube links stay as normal links instead of turning into embeds. Community, payout, beneficiaries, tags and the other publish settings are listed below the post.',
  },
  {
    version: '1.33.0',
    date: '2026-06-25',
    summary:
      'Sharing a video or short now shows a proper preview. When you paste a 3Speak link on Twitter/X, Discord, Telegram, WhatsApp and similar, the post unfurls with the video’s thumbnail, title and description instead of the plain 3Speak logo.',
  },
  {
    version: '1.32.0',
    date: '2026-06-25',
    summary:
      'YouTube links in a video’s description now stay as normal clickable links instead of being turned into an embedded player, so descriptions with two links on one line (e.g. “Source: A & B”) keep their layout.',
  },
  {
    version: '1.31.0',
    date: '2026-06-22',
    summary:
      'The quick Edit on a video (the pencil) now has the same controls as the full Edit page: unlist, mark adult/NSFW, allow or block remix/clip, and promote. The pre-publish review step is cleaner, and on mobile the subtitles menu now opens centred in fullscreen instead of being cut off at the bottom.',
  },
  {
    version: '1.30.0',
    date: '2026-06-22',
    summary:
      'You can now promote any video so it shows first in the Recommended list (with a “Promoted” tag) and in a Promoted row on the home page. Tap Promote on a video (also offered right after uploading and on the Edit page), choose 1–7 days, and pay in HBD or HIVE from your own wallet.',
  },
  {
    version: '1.29.0',
    date: '2026-06-22',
    summary:
      'The final review step before publishing a video is redesigned and now shows everything you picked at a glance — community, payout, beneficiaries, tags and the remix setting.',
  },
  {
    version: '1.28.0',
    date: '2026-06-22',
    summary:
      'You can now mark a video as adult/NSFW — either while uploading (Add details) or later from its Edit page. Adult videos are hidden from feeds and search for viewers who haven’t turned on NSFW.',
  },
  {
    version: '1.27.0',
    date: '2026-06-22',
    summary:
      'You can now unlist a video from its Edit page to hide it from all feeds and search while it stays playable by direct link. Unlisted videos remain on your own profile with an “Unlisted” badge so you can re-list them anytime.',
  },
  {
    version: '1.26.0',
    date: '2026-06-22',
    summary:
      'Fixed: on mobile, you can now open the subtitles and quality menu while a video is playing in fullscreen.',
  },
  {
    version: '1.25.0',
    date: '2026-06-22',
    summary:
      'YouTube links inside a post now stay as normal clickable links instead of being turned into an embedded player.',
  },
  {
    version: '1.24.0',
    date: '2026-06-22',
    summary:
      'Fixed the comment box at the bottom of mobile Shorts — it was too tall and covered part of the video description.',
  },
  {
    version: '1.23.0',
    date: '2026-06-19',
    summary:
      'On mobile, switch on Large cards to get a full-width video feed where the centred video auto-plays a muted preview as you scroll. Turn off Large cards or Video previews in Settings to disable it.',
  },
  {
    version: '1.22.0',
    date: '2026-06-19',
    summary:
      'Hover a video card on desktop to play a muted preview — with a draggable timeline and subtitles when available. You can switch previews off under Settings → Video previews.',
  },
  {
    version: '1.21.0',
    date: '2026-06-19',
    summary:
      'Video cards are bigger and now a consistent 16:9 on the home, profile and playlist pages. Prefer the old compact look? Switch from Large to Small cards in Settings → Appearance.',
  },
  {
    version: '1.20.0',
    date: '2026-06-18',
    summary:
      '3Speak now notices when a newer version is available and shows a “Refresh” prompt, so you get the latest updates without manually reloading the page.',
  },
  {
    version: '1.19.0',
    date: '2026-06-17',
    summary:
      'Shorts on desktop: scroll with your mouse wheel to move between shorts (like the up/down arrow keys), the action buttons are smaller and sit at the bottom, and the up/down navigation arrows now stay on the far right — with the comments panel opening to their left.',
  },
  {
    version: '1.18.0',
    date: '2026-06-17',
    summary:
      'The community picker when uploading now lists the communities you’re subscribed to (sorted by size) right under the default one, so you don’t have to search for your usual communities.',
  },
  {
    version: '1.17.0',
    date: '2026-06-15',
    summary:
      'The community picker when uploading is redesigned: each community shows a card with its subscriber count and bio, and you can expand it to read the full About and rules. Video and audio cards now gently zoom on hover, and audio cards now match the look of video cards (16:9 cover, author with a follow button).',
  },
  {
    version: '1.16.0',
    date: '2026-06-15',
    summary:
      'Videos posted to Hive now include a “Watch on 3Speak” link at the bottom that opens the right page (the shorts player for shorts, the watch page for videos). A video’s link is now based on its title instead of its description (shorts still use the first words of their text).',
  },
  {
    version: '1.15.0',
    date: '2026-06-15',
    summary:
      'You can now edit or delete your own chat messages from the ⋯ menu on a message (edited ones show an “edited” mark). Starting a new chat now only accepts real Hive usernames.',
  },
  {
    version: '1.14.0',
    date: '2026-06-15',
    summary:
      'Cleaner profile page: the Videos/Shorts/Audio/Playlists tabs now look like proper tabs with a red underline, and opening a short or playlist then pressing the browser back button returns you to the same tab. Shorts thumbnails fit their cards instead of stretching.',
  },
  {
    version: '1.13.0',
    date: '2026-06-14',
    summary:
      'Big chat upgrade: send GIFs and emojis (with inline :shortcode: typing), paste images into a chat, and see rich cards for 3Speak/Hive links. Messages now do multiple lines, quoting, forwarding, timestamps and full-screen image view. Shorts show view counts, and creator profiles have a “Write message” button.',
  },
  {
    version: '1.12.1',
    date: '2026-06-13',
    summary:
      'Chat polish: images shared in a chat now show up inline instead of as a raw link, and your own messages now use an easy-to-read grey bubble.',
  },
  {
    version: '1.12.0',
    date: '2026-06-13',
    summary:
      'New 3Speak Chat: message any Hive user with direct messages, and join channels, from the new chat icon in the top bar (or the /chat page). It connects on its own — no extra signature popup.',
  },
  {
    version: '1.11.1',
    date: '2026-06-12',
    summary:
      'Your video now starts uploading in the background as soon as you reach the “Add details” step — usually ready by the time you press publish — with a progress bar under the steps showing how it’s going. Uploads are also spread across multiple servers now, keeping them fast even when lots of people upload at once.',
  },
  {
    version: '1.11.0',
    date: '2026-06-11',
    summary:
      'Your scheduled videos now appear in your profile’s Videos list with a “Scheduled” date badge, in the spot they’ll publish. You can open one to watch it before it goes live, and use the pen (edit) button on its page to change the details, reschedule, or cancel it. The editor now opens as a popup right on the video, so you stay where you are.',
  },
  {
    version: '1.10.7',
    date: '2026-06-11',
    summary:
      'Before an upload starts, 3Speak now checks you have enough Hive Resource Credits (RC) to publish. If you’re too low it explains why and estimates when your RC will have refilled enough, instead of letting the whole upload run and then fail. This applies to both video and audio uploads.',
  },
  {
    version: '1.10.6',
    date: '2026-06-11',
    summary:
      'When you’re logged in with a Hive wallet and tap “Change account”, it now opens the account switcher directly instead of the sign-up / log-in screen.',
  },
  {
    version: '1.10.5',
    date: '2026-06-11',
    summary:
      'Tapping “Edit Video” on your profile now shows a short guide: you can edit any of your videos from its page using the pen button, which the guide highlights for you.',
  },
  {
    version: '1.10.4',
    date: '2026-06-11',
    summary:
      'Fixed the emoji picker in the video description box (the upload “Add details” step) being cut off — the full picker now shows instead of being clipped by the box.',
  },
  {
    version: '1.10.3',
    date: '2026-06-09',
    summary:
      'On desktop, the Shorts page (/shorts) now opens the comments panel by default so you can read along while watching. On mobile it stays closed (tap the comment icon to open).',
  },
  {
    version: '1.10.2',
    date: '2026-06-09',
    summary:
      'Scheduling a video now works no matter how you’re logged in. Before, scheduling (and editing or cancelling a scheduled post on the Edit scheduled post page) asked you to sign a message, which failed for HiveSigner and ManteAuth logins — that signature step is gone, so it just works.',
  },
  {
    version: '1.10.1',
    date: '2026-06-09',
    summary:
      'Uploading a video your browser can’t read or preview — such as iPhone HEVC/H.265 .MOV files — now works smoothly: it no longer fails on the thumbnail step, and the upload and preview steps show a clear note instead of a broken player. The file still uploads and is converted for playback.',
  },
  {
    version: '1.10.0',
    date: '2026-06-09',
    summary:
      'Navigation refresh: a Settings (cog) button in the top bar opens settings directly, and logged-out visitors get a clearer red “Log in” button. On mobile, the profile menu in the bottom bar now matches the desktop menu. You can also drag & drop files into the video uploader, the thumbnail picker, and the audio cover spots.',
  },
  {
    version: '1.9.13',
    date: '2026-06-08',
    summary:
      'Fixed video and short uploads that could fail to publish for some accounts — for example 3Speak Pro members with no beneficiaries set. Publishing now works reliably for everyone.',
  },
  {
    version: '1.9.12',
    date: '2026-06-08',
    summary:
      'The cover you choose now sticks to voice memos and snap audio — it’s saved with the post and shows on the Audio page (/audio). Before, a recording could end up with no cover.',
  },
  {
    version: '1.9.11',
    date: '2026-06-08',
    summary:
      'Audio now shows an icon for each type — song, podcast, voice message and more — on the Audio page (/audio) and its filter chips.',
  },
  {
    version: '1.9.10',
    date: '2026-06-08',
    summary:
      "Fixed view counts on Shorts and videos so plays are counted again. Shorts opened from a shared link now load and play correctly, and on a Short whose original post isn't available the like, comment and reshare buttons are turned off instead of showing an error.",
  },
  {
    version: '1.9.9',
    date: '2026-06-07',
    summary:
      'Notifications have a new look that matches 3Speak — they stack in a list, have a close (×) button, and you can swipe them away to the right.',
  },
  {
    version: '1.9.8',
    date: '2026-06-07',
    summary:
      'Image uploads for thumbnails and covers are fixed — including the cover picker when you create a playlist in the audio uploader.',
  },
  {
    version: '1.9.7',
    date: '2026-06-07',
    summary:
      'Publishing is more reliable across all logins. The first time you upload you may be asked to authorize @threespeak to post on your behalf — then videos, shorts, audio, and video reactions all publish smoothly.',
  },
  {
    version: '1.9.6',
    date: '2026-06-05',
    summary:
      "On mobile, tap your avatar in the bottom bar to see the app version and which Hive node you're connected to. The “what's new” popup is also easier to browse — arrow buttons on desktop and swipe-to-snap on mobile.",
  },
  {
    version: '1.9.5',
    date: '2026-06-05',
    summary:
      "Settings now shows the app version and which Hive node you're connected to. The main page also loads thumbnails a little faster.",
  },
  {
    version: '1.9.4',
    date: '2026-06-05',
    summary:
      'On a video page you can now click the vote count to pin the list of voters — it shows everyone who voted and scrolls. The payout popover also shows an estimated HIVE/HP split.',
  },
  {
    version: '1.9.3',
    date: '2026-06-05',
    summary:
      'The 3Speak Pro section on your Wallet page has a cleaner two-column layout with calmer colours.',
  },
  {
    version: '1.9.2',
    date: '2026-06-05',
    summary:
      'A visual refresh for dark mode — calmer colours with less red and outlined buttons. The notifications bell now shows a small dot instead of a number.',
  },
  {
    version: '1.9.1',
    date: '2026-06-04',
    summary:
      "3Speak now has a changelog! From now on, whenever we ship an update you'll see a short note like this explaining what's new. It pops up automatically after an update — nothing for you to do.",
  },
  {
    version: '1.9.0',
    date: '2026-06-03',
    summary:
      'A big update to make 3Speak faster and more complete. Feeds load quicker, Community pages now show every video posted to that community, and view counts are back on video and audio cards. We also added a screen for scheduled posts and made uploads larger and faster.',
  },
  {
    version: '1.8.0',
    date: '2026-05-20',
    summary:
      'Pay-per-listen arrived for audio and Pro members get a news ticker. 3Speak now also picks a fast, reliable Hive connection automatically — you can choose your own in the connection settings.',
  },
  {
    version: '1.7.0',
    date: '2026-05-06',
    summary:
      'Audio comes to 3Speak. Share a podcast or music track from the upload menu and listen with the new built-in audio player, plus new profile and social links.',
  },
  {
    version: '1.5.0',
    date: '2026-04-10',
    summary:
      '3Speak Pro is here. Subscribe for premium perks and show a Pro badge on your avatar across the site. There is a free trial too — find it on your Wallet page.',
  },
  {
    version: '1.4.0',
    date: '2026-04-07',
    summary:
      'Notifications! A new bell icon in the top bar shows your comments, follows, mentions and rewards. They are grouped together, big votes get a "whale" alert, and there is a full Notifications page.',
  },
  {
    version: '1.3.0',
    date: '2026-04-06',
    summary:
      'You can now edit your own videos. Open one of your videos and use the Edit button to change the title, tags, description, or thumbnail.',
  },
  {
    version: '1.2.1',
    date: '2026-04-04',
    summary: 'The Hive login popup (HiveAuth) is clearer, with improved text and layout.',
  },
  {
    version: '1.2.0',
    date: '2026-04-01',
    summary:
      'Playlists got better. You can now search your playlists, collapse result groups, and use quick filter chips to find what you want.',
  },
  {
    version: '1.1.0',
    date: '2026-03-26',
    summary:
      'Easier browsing. Tag pages now have filters for type and date, tabs show how many videos they contain, and specially curated videos get a badge.',
  },
  {
    version: '1.0.3',
    date: '2026-03-20',
    summary:
      'Mobile polish: a smaller tipping popup, a fixed comment box, and better title spacing on phones.',
  },
  {
    version: '1.0.2',
    date: '2026-03-12',
    summary:
      'Cleaner posting. Titles and short descriptions now show a character limit as you type, and new posts use tidier links.',
  },
  {
    version: '1.0.1',
    date: '2026-03-08',
    summary:
      "You can now report content. Use the new Report option in the “⋯” menu on any video, comment, or user profile.",
  },
];

// Semver compare of "x.y.z" — returns >0 if a is newer than b.
function compareVersions(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  return 0;
}

// All changelog entries strictly newer than `version` (newest first).
export function changelogSince(version) {
  if (!version) return [];
  return CHANGELOG.filter((e) => compareVersions(e.version, version) > 0);
}
