# Icons

Every design uses **Material Symbols Rounded** (weight 400, optical size 24). Use the filled version (`FILL 1`) only for an active state: a vote you've cast, a saved item, a verified badge, stars.

- Package: `npm i material-symbols`, then `import "material-symbols/rounded.css"` once.
- Component: `code/ui/Icon.jsx`. `<Icon name="thumb_up" fill />`, or `Icon.of("share")` for the `icon` prop of the primitives.
- Sizes: 14 or 16 inside small buttons and chips, 18 in rows and menus, 20 to 22 in docks and tabs, 24 to 28 for empty states and hero icons.
- Color: inherit from text. Accent only for an active or primary meaning. Cyan for community or info.

The repo already ships `lucide-react` and `react-icons`. `ui.jsx` imports a few lucide icons so it runs out of the box. When you migrate a screen, switch it to Material Symbols so the glyphs match the mockups. Don't mix icon sets on one screen.

## Icons used in the designs
Material names, grouped by job. If you need an icon that isn't listed, pick from the same set and style.

- **Navigation:** home, explore, search, menu_book, arrow_back, arrow_forward, chevron_left, chevron_right, expand_more, keyboard_arrow_down, open_in_new, open_in_full, north_west, close, more_horiz, more_vert, drag_indicator, swipe_up, touch_app
- **Media / player:** play_arrow, play_circle, pause, pause_circle, stop, stop_circle, replay, replay_10, forward_10, fast_forward, skip_next, skip_previous, shuffle, repeat, volume_up, volume_off, closed_caption, subtitles, high_quality, speed, fullscreen, picture_in_picture_alt, aspect_ratio, autoplay, light_mode, dark_mode, screen_rotation, smart_display, view_day, movie, movie_edit, videocam, live_tv, sensors, graphic_eq, headphones, podcasts, music_note, album, library_music, queue_music, queue_play_next, playlist_add, playlist_play, video_library, equalizer, surround_sound, mic, mic_off, record_voice_over, fiber_manual_record, play_disabled, zoom_in, zoom_out, crop, content_cut, center_focus_strong, flip_camera_ios
- **Engagement:** thumb_up, arrow_upward, arrow_downward, chat_bubble, chat, forum, reply, share, ios_share, bookmark, bookmark_add, bookmark_added, favorite, local_fire_department, repeat, push_pin, flag, how_to_vote, back_hand, waving_hand, mood, emoji_events, celebration, star, stars, military_tech, workspace_premium, verified
- **Money:** account_balance_wallet, payments, volunteer_activism, bolt, redeem, card_giftcard, add_card, sell, storefront, shopping_bag, campaign, trending_up, monitoring, bar_chart
- **People / community:** person, person_add, person_off, group, group_add, groups, account_circle, switch_account, shield_person, hub, public, interests, tag, alternate_email
- **Create / edit:** add, add_circle, upload, upload_file, cloud_upload, publish, edit, edit_note, edit_square, add_a_photo, add_photo_alternate, image, photo_camera, photo_library, wallpaper, palette, brush, title, format_bold, format_quote, format_size, link, add_link, link_off, article, code, gif_box, translate, tune, filter_alt, grid_view, splitscreen, list, undo, save, content_copy, delete, delete_forever, delete_sweep
- **Status / system:** check, check_circle, done_all, error, warning, info, help, lightbulb, progress_activity, schedule, event, event_busy, timer, hourglass_bottom, history, history_toggle_off, lock, key, shield, verified_user, visibility, visibility_off, notifications, notifications_active, notifications_off, wifi, wifi_off, cloud_done, cloud_off, upload_off, vpn_lock, system_update, construction, bug_report, block, toggle_on, toggle_off, check_box, check_box_outline_blank, radio_button_unchecked, install_mobile, phone_iphone, smartphone, desktop_windows, devices, language, logout, login, mail, mark_email_read, rss_feed, download, sd_storage, cookie, copyright, settings, refresh, extension, qr_code_2

Toggles: the mockups draw `toggle_on` / `toggle_off` glyphs. In production, use the `<Toggle>` switch in `ui.jsx`, which is sized to match the glyph and is properly accessible.
