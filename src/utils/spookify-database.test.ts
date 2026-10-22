import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

const ids = ['1', '2', '3', '4', '5'].map((n) => `00000000-0000-0000-0000-00000000000${n}`)
const [admin, ann, ben, cat] = ids
const schema = readFileSync('supabase/schema.sql', 'utf8')
const migrations = [
  'supabase/migrations/20261026_restore_signup_profile_trigger.sql',
  'supabase/migrations/20261027_add_signup_codes.sql',
  'supabase/migrations/20261028_add_votes.sql',
  'supabase/migrations/20261029_add_spookify.sql',
].map((path) => readFileSync(path, 'utf8'))

describe.each([
  { name: 'fresh schema only', applyMigrations: false },
  { name: 'schema plus migrations', applyMigrations: true },
])('spookify ($name)', ({ applyMigrations }) => {
  const db = new PGlite()

  beforeAll(async () => {
    await db.exec(`
      create role anon;
      create role authenticated;
      create role dashboard_user;
      create role service_role bypassrls;
      create schema auth;
      create schema storage;
      create function auth.uid() returns uuid language sql stable as
        $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      create function auth.email() returns text language sql stable as $$ select 'test@example.com'::text $$;
      create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}');
      create table storage.buckets (id text primary key, name text, public boolean);
      create table storage.objects (
        id uuid primary key default gen_random_uuid(), bucket_id text, name text,
        owner uuid, owner_id text, unique (bucket_id, name)
      );
      alter table storage.objects enable row level security;
      grant usage on schema public, auth, storage to authenticated, anon, service_role;
      grant all on all tables in schema storage to authenticated, service_role;
    `)
    await db.exec(schema)
    if (applyMigrations) for (const migration of migrations) await db.exec(migration)
    await db.exec('grant all on all tables in schema public to authenticated, service_role')
    // The pool is written only through the definer functions, exactly as in a deployed project.
    await db.exec('revoke all on public.spookify_songs, public.spookify_swipes from authenticated')
    await db.exec('grant select on public.spookify_songs, public.spookify_swipes to authenticated')
  }, 20000)
  afterAll(async () => { await db.close() })

  beforeEach(async () => {
    await db.exec('reset role; delete from public.spookify_songs; delete from auth.users; delete from public.signup_codes')
    await db.exec("insert into public.signup_codes (code, seats) values ('SEED', 100)")
    for (const [index, id] of ids.entries()) {
      await db.query(
        `insert into auth.users (id,email,raw_user_meta_data) values ($1,$2,$3)`,
        [id, `user${index}@example.com`, JSON.stringify({ signup_code: 'SEED', name: `User ${index}`, costume: `Costume ${index}` })],
      )
    }
    await db.query('update public.users set is_admin = true where id = $1', [admin])
  })

  const asUser = async (id: string) => {
    await db.exec('reset role')
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [id])
    await db.exec('set role authenticated')
  }
  const addSong = async (user: string, trackId: string, title = 'Thriller', artist = 'Michael Jackson') => {
    await asUser(user)
    const { rows } = await db.query<{ add_spookify_song: string }>(
      'select public.add_spookify_song($1, $2, $3)', [trackId, title, artist],
    )
    return rows[0].add_spookify_song
  }
  const swipe = async (user: string, songId: string, direction: 'left' | 'right') => {
    await asUser(user)
    await db.query('select public.swipe_spookify_song($1, $2)', [songId, direction])
  }
  const scoreOf = async (user: string) => {
    await db.exec('reset role')
    const { rows } = await db.query<{ score: number }>(
      'select spookify_score::float8 as score from public.users where id = $1', [user],
    )
    return rows[0].score
  }
  const nextSong = async (user: string) => {
    await asUser(user)
    const { rows } = await db.query<{ id: string; title: string }>('select * from public.next_spookify_song()')
    return rows[0] ?? null
  }

  it('starts every account at a zero spookify score', async () => {
    expect(await scoreOf(ann)).toBe(0)
  })

  it('adds a song to the shared pool and pays the submitter half a point', async () => {
    const songId = await addSong(ann, 'track-1')
    expect(await scoreOf(ann)).toBe(0.5)
    await db.exec('reset role')
    const { rows } = await db.query('select spotify_track_id, title, artist, added_by from public.spookify_songs')
    expect(rows).toEqual([{ spotify_track_id: 'track-1', title: 'Thriller', artist: 'Michael Jackson', added_by: ann }])
    expect(songId).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('trims the submission and rejects a song without a track, title or artist', async () => {
    await addSong(ann, '  track-1  ', '  Thriller  ', '  Michael Jackson  ')
    await db.exec('reset role')
    const { rows } = await db.query<{ spotify_track_id: string; title: string }>(
      'select spotify_track_id, title from public.spookify_songs',
    )
    expect(rows[0]).toEqual({ spotify_track_id: 'track-1', title: 'Thriller' })
    await asUser(ann)
    await expect(db.query("select public.add_spookify_song('', 'T', 'A')")).rejects.toThrow('needs a Spotify track')
    await expect(db.query("select public.add_spookify_song('t2', '  ', 'A')")).rejects.toThrow('needs a Spotify track')
  })

  it('reports a track that is already in the pool and pays nobody for it', async () => {
    await addSong(ann, 'track-1')
    await asUser(ben)
    await expect(db.query("select public.add_spookify_song('track-1', 'Thriller', 'MJ')"))
      .rejects.toThrow('Song already added')
    expect(await scoreOf(ben)).toBe(0)
    expect(await scoreOf(ann)).toBe(0.5)
    await db.exec('reset role')
    const { rows } = await db.query<{ n: number }>('select count(*)::int as n from public.spookify_songs')
    expect(rows[0].n).toBe(1)
  })

  it('pays a right swipe one point to the swiper and one to the submitter', async () => {
    const songId = await addSong(ann, 'track-1')
    await swipe(ben, songId, 'right')
    expect(await scoreOf(ben)).toBe(1)
    expect(await scoreOf(ann)).toBe(1.5)
  })

  it('pays a left swipe half a point to the swiper and nothing to the submitter', async () => {
    const songId = await addSong(ann, 'track-1')
    await swipe(ben, songId, 'left')
    expect(await scoreOf(ben)).toBe(0.5)
    expect(await scoreOf(ann)).toBe(0.5)
  })

  it('records the direction of each swipe and keeps it private to the swiper', async () => {
    const songId = await addSong(ann, 'track-1')
    await swipe(ben, songId, 'right')
    await swipe(cat, songId, 'left')
    await asUser(ben)
    const { rows } = await db.query('select song_id, direction from public.spookify_swipes')
    expect(rows).toEqual([{ song_id: songId, direction: 'right' }])
  })

  it('allows only one swipe per user per song', async () => {
    const songId = await addSong(ann, 'track-1')
    await swipe(ben, songId, 'left')
    await asUser(ben)
    await expect(db.query('select public.swipe_spookify_song($1, $2)', [songId, 'right']))
      .rejects.toThrow('already swiped')
    expect(await scoreOf(ben)).toBe(0.5)
    expect(await scoreOf(ann)).toBe(0.5)
  })

  it('refuses a swipe on your own song, an unknown song and a sideways swipe', async () => {
    const songId = await addSong(ann, 'track-1')
    await asUser(ann)
    await expect(db.query('select public.swipe_spookify_song($1, $2)', [songId, 'right']))
      .rejects.toThrow('your own song')
    await asUser(ben)
    await expect(db.query('select public.swipe_spookify_song($1, $2)', [songId, 'up']))
      .rejects.toThrow('A swipe goes left or right')
    await expect(db.query('select public.swipe_spookify_song($1, $2)', [ids[4], 'right']))
      .rejects.toThrow('Unknown song')
    expect(await scoreOf(ann)).toBe(0.5)
  })

  it('serves a random unswiped song, never your own, and runs out once everything is swiped', async () => {
    await addSong(ann, 'track-1', 'Ann song')
    await addSong(ben, 'track-2', 'Ben song')
    expect((await nextSong(ann))?.title).toBe('Ben song')
    const forCat = await nextSong(cat)
    expect(['Ann song', 'Ben song']).toContain(forCat?.title)
    await swipe(cat, (await nextSong(cat))!.id, 'right')
    await swipe(cat, (await nextSong(cat))!.id, 'left')
    expect(await nextSong(cat)).toBeNull()
  })

  it('keeps an account that is pending deletion out of the pool', async () => {
    const songId = await addSong(ann, 'track-1')
    await db.exec('reset role')
    await db.query('update public.users set deletion_pending_at = now() where id = $1', [ben])
    await asUser(ben)
    await expect(db.query("select public.add_spookify_song('track-2', 'T', 'A')"))
      .rejects.toThrow('Account is not active')
    await expect(db.query('select public.swipe_spookify_song($1, $2)', [songId, 'right']))
      .rejects.toThrow('Account is not active')
    expect(await scoreOf(ann)).toBe(0.5)
  })

  it('never lets a client write the pool or its own score directly', async () => {
    const songId = await addSong(ann, 'track-1')
    await asUser(ben)
    await expect(db.query("insert into public.spookify_songs (spotify_track_id, title, artist, added_by) values ('x','T','A',$1)", [ben]))
      .rejects.toThrow(/permission denied/i)
    await expect(db.query("insert into public.spookify_swipes (song_id, user_id, direction) values ($1,$2,'right')", [songId, ben]))
      .rejects.toThrow(/permission denied/i)
    await expect(db.query('update public.users set spookify_score = 999 where id = $1', [ben]))
      .rejects.toThrow('Spookify score is awarded by the server')
    expect(await scoreOf(ben)).toBe(0)
  })

  it('removes the songs and swipes of a deleted account', async () => {
    const songId = await addSong(ann, 'track-1')
    await swipe(ben, songId, 'right')
    await db.exec('reset role')
    await db.query('delete from auth.users where id = $1', [ann])
    const { rows } = await db.query<{ songs: number; swipes: number }>(`
      select (select count(*)::int from public.spookify_songs) as songs,
             (select count(*)::int from public.spookify_swipes) as swipes
    `)
    expect(rows[0]).toEqual({ songs: 0, swipes: 0 })
  })
})
