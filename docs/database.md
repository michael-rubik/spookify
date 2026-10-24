# Database

Canonical schema lives in `supabase/schema.sql` and migrations in `supabase/migrations/`.

When changing schema, create a migration and keep `schema.sql` in sync.

Refer to `README.md` for detailed migration safety and reset workflows.

## Signup codes

Creating an account requires a signup code (`public.signup_codes`: `code`, `seats`,
`seats_used`). The client sends it as `signup_code` in the signUp metadata, and
`handle_new_user` redeems it atomically with account creation. An unknown or full code
aborts the insert into `auth.users`; Auth reports that only as "Database error saving
new user", which the sign-up form shows as the German "invalid code" message.

- Codes match ignoring case and surrounding whitespace and are unique.
- A seat is taken at account creation and is never freed, including when the user is
  deleted. Removing a code stops it working and nulls `users.signup_code_id`.
- Only active admins can read, add, resize, and remove codes (RLS). `seats_used` and
  `code` cannot be edited by clients, and seats cannot drop below `seats_used`.
- Every insert into `auth.users` needs a code, including accounts created from the
  Supabase dashboard (put `signup_code` in the user metadata).
- Email confirmation is off (`enable_confirmations = false` in `config.toml`, which
  `db push` does not apply). Also turn off "Confirm email" in the hosted project under
  Authentication → Providers → Email. `users.signup_email_status` was dropped.

## Permanent account deletion

Migrations apply in filename order; `20261025_permanent_account_deletion.sql` follows
the karaoke scheduling fix, whose scheduler it replaces so FK-cascade deletes close
queue gaps. Its definitions are also in `schema.sql`.

Lifecycle: an admin calls the `delete-account` Edge Function, which calls the
service-role-only `begin_account_deletion` RPC to set `users.deletion_pending_at`.
Database guards then reject all writes and uploads from that account, including with
already-issued access tokens (deleting an Auth user does not invalidate JWTs). The
function bans sign-in, removes owned Storage files in batches through the Storage API
(never by deleting `storage.objects` rows), deletes the Auth user, and confirms that
both the profile and Auth user are gone. FK cascades remove spooks, tags, and karaoke
songs. Cleanup is bounded per invocation; failures leave the account pending and the
admin UI offers retry. Missing files and an already-deleted Auth user are tolerated.

Limits: only files with `owner_id` (or legacy `owner`) of the user are discovered;
ownerless historical objects are not inferred from URLs, and Auth deletion fails
explicitly if other owned objects remain. Write admission uses one advisory lock
`(20261025, 1)`, which serializes guarded writes. Concurrent retries may race and one
fails explicitly. Development login accounts are synthetic and cannot be deleted.

## Karaoke queue

Apply `20261024_fix_karaoke_scheduling.sql` before deploying the updated karaoke UI.
Scheduling runs atomically in database triggers, serialized with a transaction-level
advisory lock. An idle queue starts a new song immediately; additions otherwise
follow the last live song. Archived songs never reserve a queue slot. Removing or
skipping a song closes its slot while preserving the current performance's start.
Owners and admins can remove songs; skipping and changing duration remain admin UI
controls. The private scheduling trigger can adjust other owners' timestamps, but
cannot be called directly through the API. Reading the queue does not write to it.

Development login mirrors these scheduling rules in local storage. The UI advances
the displayed status and countdown every second; refresh fetches other users' changes.
Database regression tests use an isolated in-memory Postgres instance (PGlite), not
the linked Supabase project.

## Votes

Apply `20261028_add_votes.sql` before deploying the Poll view. Admins start, end,
reset and delete votes through `security definer` functions; members cast one
anonymous ballot per vote with `cast_ballot`. Who voted (`vote_participation`) and
what was chosen (`vote_tallies`) live in separate tables with no link and no
timestamps, and tallies are readable only after the vote ends. See
`docs/adr/0001-anonymous-ballots.md`.

## Spookify

Apply `20261029_add_spookify.sql` before deploying the Spookify view. Songs
(`spookify_songs`) and swipes (`spookify_swipes`) are written only by the
`add_spookify_song` and `swipe_spookify_song` definer functions, which also award
`users.spookify_score`; clients hold no write grants, and a profile trigger rejects
any score change that those functions did not make. A track can enter the pool once,
so a repeat submission raises `Song already added` and pays nobody. A user swipes a
given song at most once and never sees their own songs, which `next_spookify_song`
enforces while picking a random unswiped song. Unlike votes, swipes are attributed
to the swiper, but each user can read only their own.

Apply `20261038_spookify_daily_song_limit.sql` for the daily song cap. A user can add at
most `daily_song_limit` songs (default 10) per day; `add_spookify_song`
raises `Daily song limit reached` beyond that. The value lives in `app_settings` and admins
change it from the Admin page through `set_daily_song_limit`.

Apply `20261039_battle_pass_levels.sql` to tie the limit to the battle pass. A user's limit is
`daily_song_limit` plus the `bonus_songs` of every row in `battle_pass_levels` whose `xp_required` their
XP has reached (level 1 is the lowest threshold). XP is recomputed server-side by `private.user_xp` with the
same sum the pass shows. Admins add, edit and delete levels on the Admin page; members can read them.
`my_song_allowance` returns the caller's XP, level, limit and songs added today.

Apply `20261030_add_spookify_fmk.sql` for Spookify FMK. A user's tier per song lives in
`spookify_fmk_tiers` (points from sing and listen, plus a deleted flag) and the songs that
already shared a round in `spookify_fmk_pairs`; both are readable only by their owner and
written only by `submit_spookify_fmk`, which re-checks that the three songs share a tier,
have never met, are not the caller's own, and then awards the round's points.
`next_spookify_fmk` deals a random trio from the lowest tier that still has one.

Apply `20261031_spookify_game_scores.sql` for per-game scores. `users` keeps three
server-written columns, `submitter_score` (Add song to game), `tinder_score` and
`fmk_score`, and `spookify_score` is their sum (the number the badge uses). Adding a song
pays nothing. A right swipe pays the swiper 1 and a left swipe 0.5; a right swipe also pays the
submitter 1. An FMK round pays the player 1, the submitter of the sung song 1 and the
submitter of the listened song 0.5. The migration rebuilds existing scores from swipe
history; old add-song points are dropped and FMK scores start at 0.

Apply `20261032_spookify_song_points.sql` for the song leaderboard. `spookify_songs.points`
holds what a song has earned for its submitter (right swipe 1, sing 1, listen 0.5), written
only by `private.award_song` from the swipe and FMK functions, and it is the number the song
leaderboard ranks by. The migration also rebuilds each submitter's score from those points,
so a left swipe no longer pays the submitter.

Searching Spotify goes through the `spookify-search` Edge Function so the Spotify
client secret stays on the server; it uses the Client Credentials flow, which reaches
the public catalogue only. The app links out to Spotify instead of playing audio, so
no guest needs a Spotify account.

Apply `20261041_hide_costumes.sql` for the costume switch. `app_settings.costumes_hidden`
(0/1) is flipped by admins through `set_costumes_hidden(boolean)`; `costumes_hidden()` is
readable before sign in so the signup form can show it. `users.costume` is no longer
selectable by clients: they call `visible_costumes()`, which returns everyone's costume
while shown and only the caller's own while hidden. Select `USER_COLUMNS`
(`src/utils/costumes.ts`) instead of `*`, and grant any new `users` column explicitly.

## Clicker fights

Apply `20261042_clicker_fights.sql`. Players with at least 250 lifetime clicks (fighters)
may call `call_clicker_fight()`; one fight runs at a time for `fight_duration_minutes`
(`app_settings`, default 5). Only clicks beyond 250 score, recorded by `register_clicks`
in `clicker_fight_scores`. Fights close lazily on the next `clicker_fight_state`,
`call_clicker_fight`, `register_clicks` or `my_badge_progress` call; top scorers (ties
included, at least two fighters) win and count towards the `fight-winner` badge. Calls
per day are `daily_fight_limit` (default 1) plus `battle_pass_levels.bonus_fights`
of unlocked milestones. Admins edit the settings through `set_clicker_fight_settings`.
`fight-winner` is a tenth regular badge, so Winner winner now needs it. The migration swaps
existing Winner winner holders to the `legacy-winner` badge (100 XP, off the track). See
`docs/adr/0002-clicker-fights-retire-winner-winner.md`.

## End-to-end tests

`npm run test:e2e` runs Playwright against a throwaway Postgres + PostgREST in a
podman pod (`podman machine start` first), never the hosted project. The voting
story uses one admin and four member browser contexts, and the teardown asserts
that no vote data remains before the pod is removed.
