# Project Plan

## Plan: Social feature expansion

TL;DR: Extend the existing Supabase-backed React app in small, table-driven phases: add user profile metadata and media storage, introduce badge and spook tables with admin-triggered recomputation, then add a karaoke queue with time-based refresh logic. This fits the current architecture because the app already centralizes auth/session handling in `src/App.tsx`, keeps a mirrored profile in `supabase/schema.sql`, and uses direct Supabase queries from small feature components like `src/components/clicker.tsx`.

**Steps**
1. Baseline schema extension and storage setup
	- Add new DB columns and tables for avatar URLs, badges, spooks, and queue entries in `supabase/schema.sql`.
	- Add a storage bucket for profile avatars and spook uploads with RLS policies for authenticated uploads and public reads.
	- Add helper functions to compute badge eligibility and queue state; keep the logic near the data layer rather than in React state.
	- Dependency: this foundation is required before view code and admin tools can work reliably.

2. Profile picture and badge data model
	- Extend the `public.users` row with `avatar_url` and badge-related metadata if needed; keep the profile update flow in `src/App.tsx` aligned with the current `ProfileDraft` pattern.
	- Add `public.badges` and `public.user_badges` tables so the app can store earned awards and maintain a reusable badge catalog.
	- Implement a `500 click` badge rule in the database or a server-side function, with a refresh action that recalculates badges for all users after click count changes.
	- Parallel with step 3: UI can be built once the schema contract is stable.

3. Spooks feed and tagging UX
	- Add `public.spooks` with fields for `user_id`, `caption`, `image_url`, `created_at`, and optional `tagged_user_id` or a join table if many tags are needed.
	- Build a list feed and create form in the app shell using the same direct Supabase pattern already used in `src/App.tsx` and `src/components/clicker.tsx`.
	- Allow each user to upload an image, create a caption, and select tagged users from the existing user list; keep reads public and writes limited to the authenticated creator or admin.
	- Dependency: profile and badge schema must exist before spook feed can show user avatars and badge status consistently.

4. Karaoke queue model and refresh logic
	- Create `public.karaoke_queue` with per-song fields such as `id`, `song_title`, `artist`, `requested_by`, `created_at`, `status`, `started_at`, `duration_seconds`, and `position`.
	- Build a list panel with “add song”, “skip as admin”, and “current now/next/up next” state that calculates the active track based on elapsed time from `started_at` and default duration of 300 seconds.
	- Add a global refresh action that rehydrates queue state and advances songs that should already have been played using the server-side timestamp logic rather than client-side drift.
	- Keep default song length at 5 minutes and ensure that all clients derive the same ”should play now” result from the same queue timestamps.

5. Admin controls and refresh triggers
	- Add admin-only actions in the dashboard-level state in `src/App.tsx`: trigger badge refresh, force queue refresh, and skip karaoke tracks.
	- Reuse the existing `is_admin` flags and update pattern from the current user management screen rather than inventing a second auth gate.
	- Expose a single refresh action for users and a stricter admin action for moderation, matching the requirement that “every user may trigger a refresh” while only admins can skip songs.

6. Frontend integration and polish
	- Add dedicated tabs or panels for profile, clicker, badges, spooks, and karaoke in the app shell, preserving the current single-page behavior in `src/App.tsx`.
	- Show badge state, queue timing, and spook media in a simple, consistent card layout; maintain optimistic UI where feasible but persist authoritative data with Supabase.
	- Add loading, empty-state, and error messaging to match the current UX style.
	- Dependency: all storage and schema changes should be complete before the UI is finalized.

**Relevant files**
- `src/App.tsx` — main app state, auth session, user list, and admin actions; this is the central place to add view toggles and refresh actions.
- `src/components/auth.tsx` — auth/signup pattern for name, costume, and login metadata; avatar upload and profile updates will follow this pattern.
- `src/components/clicker.tsx` — the current click-count persistence pattern that will be reused for badge thresholds and click updates.
- `supabase/schema.sql` — current database contract and RLS policy model; this file is the primary place to add tables, triggers, and row-level security.
- `src/utils/supabase/supabase-client.ts` — shared Supabase client; may need to be extended for bucket access and storage helpers if not already configured.

**Verification**
1. Run the Vite app and verify user sign-in/sign-up still works after schema changes.
2. Confirm the click count still increments and badge recalculation triggers correctly when a user crosses 500 clicks.
3. Verify avatar upload appears in the profile view and is readable by all users through a public URL.
4. Create and list a spook post with caption and tag, then confirm it appears in the feed for other users.
5. Add a karaoke song, confirm the default 5-minute duration is respected, and verify admin skip and user-triggered refresh both update queue order and expired songs.
6. Check RLS behavior for upload, update, and admin-only actions to ensure user isolation and moderation rules hold.

**Decisions**
- Scope this as a staged feature roll-out rather than one giant change: profile/media first, badges second, spooks third, karaoke last.
- Keep the current app architecture: no router or heavier state library; all new features remain in the React app state and Supabase tables already used by the project.
- Use Supabase Storage for profile and spook images so the app does not need a custom file server.
- Treat refresh operations as deterministic server-side calculations driven by timestamps, so every user sees the same queue state.

**Further considerations**
1. Decide whether a spook can have multiple tagged users or only one tagged user. Recommended: start with one tagged user to keep the data model simple and the UI clean.
2. Decide whether badge recalculation should happen on each click or only when a user-triggered admin refresh is run. Recommended: recalculate on every click when feasible, with a manual refresh fallback for safety and a clear admin action.
3. Decide whether karaoke queue songs should be stored in a single table with `status` and timestamps, or split into a queue table plus session table. Recommended: keep one table for the first version to minimize complexity.