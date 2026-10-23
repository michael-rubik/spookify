import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

const ids = ['1', '2', '3', '4'].map((n) => `00000000-0000-0000-0000-00000000000${n}`)
const [admin, ann, ben] = ids
const schema = readFileSync('supabase/schema.sql', 'utf8')
const migrations = [
  'supabase/migrations/20261026_restore_signup_profile_trigger.sql',
  'supabase/migrations/20261027_add_signup_codes.sql',
  'supabase/migrations/20261028_add_votes.sql',
  'supabase/migrations/20261029_add_spookify.sql',
  'supabase/migrations/20261030_add_spookify_fmk.sql',
  'supabase/migrations/20261031_spookify_game_scores.sql',
  'supabase/migrations/20261032_spookify_song_points.sql',
  'supabase/migrations/20261033_songmaster_badge.sql',
  'supabase/migrations/20261034_battle_pass.sql',
  'supabase/migrations/20261035_lock_progress_and_email.sql',
  'supabase/migrations/20261036_unique_costumes.sql',
  'supabase/migrations/20261037_spooker_first_spook.sql',
].map((path) => readFileSync(path, 'utf8'))

const REGULAR = ['clicker', 'songmaster', 'spooker', 'tagged', 'fan', 'karaoke', 'swipes', 'fmk', 'voter']

describe.each([
  { name: 'fresh schema only', applyMigrations: false },
  { name: 'schema plus migrations', applyMigrations: true },
])('battle pass ($name)', ({ applyMigrations }) => {
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
    // The grant above is broader than a real project's, so restate the privileges the migration sets.
    await db.exec('revoke all on public.badge_points, public.custom_badge_points, public.votes from authenticated')
    await db.exec('grant select on public.badge_points, public.custom_badge_points, public.votes to authenticated')
    await db.exec('grant update on public.badge_points to authenticated')
    await db.exec('grant insert, update, delete on public.custom_badge_points to authenticated')
  }, 20000)
  afterAll(async () => { await db.close() })

  beforeEach(async () => {
    await db.exec(`reset role; delete from public.votes; delete from public.spookify_songs;
      delete from public.karaoke_queue; delete from auth.users; delete from public.signup_codes`)
    await db.exec("update public.badge_points set points = 100 where badge_id = 'voter'")
    await db.exec('delete from public.custom_badge_points')
    await db.exec("insert into public.signup_codes (code, seats) values ('SEED', 100)")
    for (const [index, id] of ids.entries()) {
      await db.query(
        'insert into auth.users (id,email,raw_user_meta_data) values ($1,$2,$3)',
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
  const progressOf = async (user: string) => {
    await asUser(user)
    const { rows } = await db.query<{ badge_id: string; progress: string }>('select * from public.my_badge_progress()')
    return Object.fromEntries(rows.map((row) => [row.badge_id, Number(row.progress)]))
  }
  const badgesOf = async (user: string) => {
    await db.exec('reset role')
    const { rows } = await db.query<{ badges: string[] }>('select badges from public.users where id = $1', [user])
    return rows[0].badges
  }
  const addSpooks = async (user: string, count: number) => {
    await db.exec('reset role')
    await db.query(
      "insert into public.spooks (user_id, image_url) select $1, 'x' from generate_series(1, $2::int)", [user, count],
    )
  }
  const queueKaraoke = async (user: string, status: string, count: number) => {
    await db.exec('reset role')
    await db.query(
      'insert into public.karaoke_queue (title, queued_by, status) select $2, $1, $2 from generate_series(1, $3::int)',
      [user, status, count],
    )
  }

  it('seeds a point value for every regular badge and Winner winner', async () => {
    await db.exec('reset role')
    const { rows } = await db.query<{ badge_id: string }>('select badge_id from public.badge_points')
    expect(rows.map((row) => row.badge_id).sort()).toEqual([...REGULAR, 'winner-winner'].sort())
  })

  it('keeps costumes unique ignoring case and spaces, for signup, edits and the pre-check', async () => {
    await db.exec('reset role')
    await db.query("update public.users set costume = 'Ghost' where id = $1", [ann])
    await expect(db.query("update public.users set costume = '  gHOST ' where id = $1", [ben])).rejects.toThrow(
      'Costume already taken',
    )
    await db.query("update public.users set costume = 'Ghost' where id = $1", [ann])
    await db.query("update public.users set costume = 'Witch' where id = $1", [ann])
    await db.query("update public.users set costume = 'Ghost' where id = $1", [ben])

    await expect(
      db.query(
        'insert into auth.users (id,email,raw_user_meta_data) values (gen_random_uuid(), $1, $2)',
        ['new@example.com', JSON.stringify({ signup_code: 'SEED', name: 'N', costume: 'GHOST' })],
      ),
    ).rejects.toThrow('Costume already taken')

    await db.exec('reset role; set role anon')
    const taken = await db.query<{ costume_available: boolean }>("select public.costume_available(' ghost')")
    const free = await db.query<{ costume_available: boolean }>("select public.costume_available('Vampire')")
    expect([taken.rows[0].costume_available, free.rows[0].costume_available]).toEqual([false, true])
  })

  it('stops users editing their own badges, clicks and email, while admins still can', async () => {
    await asUser(ann)
    for (const sql of [
      "update public.users set badges = array['clicker'] where id = $1",
      'update public.users set click_count = 999 where id = $1',
      "update public.users set email = 'new@example.com' where id = $1",
    ]) {
      await expect(db.query(sql, [ann])).rejects.toThrow(/server|Only admins/)
    }
    await db.query("update public.users set name = 'Renamed' where id = $1", [ann])

    await asUser(admin)
    await db.query("update public.users set badges = array['custom:Hi'], click_count = 3 where id = $1", [ann])
    await db.query("update public.users set email = 'admin-set@example.com' where id = $1", [ann])
    expect(await badgesOf(ann)).toEqual(['custom:Hi'])
  })

  it('registers clicks through the server with a rate cap and awards the clicker badge', async () => {
    await asUser(ann)
    const first = await db.query<{ register_clicks: number }>('select public.register_clicks(500)')
    expect(first.rows[0].register_clicks).toBe(20)
    const second = await db.query<{ register_clicks: number }>('select public.register_clicks(5)')
    expect(second.rows[0].register_clicks).toBe(25)

    await db.exec('reset role')
    await db.query("update public.users set click_count = 495, clicks_flushed_at = now() - interval '60 seconds' where id = $1", [ann])
    await asUser(ann)
    const third = await db.query<{ register_clicks: number }>('select public.register_clicks(10)')
    expect(third.rows[0].register_clicks).toBe(505)
    await db.query('select * from public.my_badge_progress()')
    expect(await badgesOf(ann)).toContain('clicker')
  })

  it('does not let new accounts start with badges or clicks', async () => {
    await asUser(ben)
    await expect(
      db.query("insert into public.users (id, name, costume, email, badges) values (gen_random_uuid(), 'x', 'y', 'z@example.com', array['clicker'])"),
    ).rejects.toThrow()
  })

  it('awards a badge at its goal and not before, keeping other badges', async () => {
    await db.query("update public.users set badges = array['custom:Party MVP'] where id = $1", [ann])
    await queueKaraoke(ann, 'completed', 2)
    await queueKaraoke(ann, 'skipped', 5)
    expect((await progressOf(ann)).spooker).toBe(0)
    expect(await badgesOf(ann)).toEqual(['custom:Party MVP'])

    await addSpooks(ann, 1)
    await progressOf(ann)
    expect(await badgesOf(ann)).toEqual(['custom:Party MVP', 'spooker'])

    await queueKaraoke(ann, 'completed', 1)
    await progressOf(ann)
    expect(await badgesOf(ann)).toEqual(['custom:Party MVP', 'spooker', 'karaoke'])
  })

  it("does not count tags on a user's own spooks", async () => {
    await addSpooks(ann, 1)
    await db.exec('reset role')
    await db.query('insert into public.spook_tagged_users (spook_id, user_id) select id, $1 from public.spooks', [ann])
    expect((await progressOf(ann)).tagged).toBe(0)
    await addSpooks(ben, 1)
    await db.exec('reset role')
    await db.query(
      'insert into public.spook_tagged_users (spook_id, user_id) select id, $1 from public.spooks where user_id = $2', [ann, ben],
    )
    expect((await progressOf(ann)).tagged).toBe(1)
  })

  it('counts a voter only once the vote has ended, so a reset leaves no trace', async () => {
    await asUser(admin)
    const { rows } = await db.query<{ start_vote: string }>("select public.start_vote('Best costume')")
    await asUser(ann)
    await db.query('select public.cast_ballot($1, $2)', [rows[0].start_vote, ben])
    expect((await progressOf(ann)).voter).toBe(0)
    expect(await badgesOf(ann)).not.toContain('voter')

    await asUser(admin)
    await db.query('select public.end_vote($1)', [rows[0].start_vote])
    expect((await progressOf(ann)).voter).toBe(1)
    expect(await badgesOf(ann)).toContain('voter')
  })

  it('awards Winner winner exactly when all nine regular badges are held', async () => {
    await db.query('update public.users set badges = $2 where id = $1', [ann, REGULAR.slice(0, 8)])
    await progressOf(ann)
    expect(await badgesOf(ann)).not.toContain('winner-winner')

    await db.exec('reset role')
    await db.query('update public.users set badges = $2 where id = $1', [ann, REGULAR])
    await progressOf(ann)
    await progressOf(ann)
    expect((await badgesOf(ann)).filter((id) => id === 'winner-winner')).toHaveLength(1)
  })

  it('does not give Winner winner for custom badges alone', async () => {
    await db.query(
      "update public.users set badges = array['custom:a','custom:b','custom:c','custom:d','custom:e','custom:f','custom:g','custom:h','custom:i'] where id = $1",
      [ann],
    )
    await progressOf(ann)
    expect(await badgesOf(ann)).not.toContain('winner-winner')
  })

  it('lets only admins edit point values', async () => {
    const pointsFor = async (id: string) => {
      await db.exec('reset role')
      const { rows } = await db.query<{ points: number }>('select points from public.badge_points where badge_id = $1', [id])
      return rows[0].points
    }
    await asUser(ann)
    await db.query("update public.badge_points set points = 999 where badge_id = 'voter'")
    await expect(db.query("insert into public.custom_badge_points (label, points) values ('Hack', 1000)")).rejects.toThrow()
    expect(await pointsFor('voter')).toBe(100)

    await asUser(admin)
    await db.query("update public.badge_points set points = 150 where badge_id = 'voter'")
    await db.query("insert into public.custom_badge_points (label, points) values ('Party MVP', 25)")
    expect(await pointsFor('voter')).toBe(150)
    await expect(db.query("update public.badge_points set points = 1001 where badge_id = 'voter'")).rejects.toThrow()
  })

  it('stores winner points on a vote, defaulting to 10 and editable by admins', async () => {
    await asUser(admin)
    const { rows } = await db.query<{ start_vote: string }>("select public.start_vote('Scariest')")
    const voteId = rows[0].start_vote
    const pointsOf = async () => {
      await db.exec('reset role')
      return (await db.query<{ winner_points: number }>('select winner_points from public.votes where id = $1', [voteId])).rows[0].winner_points
    }
    expect(await pointsOf()).toBe(10)

    await asUser(ann)
    await expect(db.query('select public.set_vote_winner_points($1, 50)', [voteId])).rejects.toThrow('Only admins')
    await asUser(admin)
    await db.query('select public.set_vote_winner_points($1, 50)', [voteId])
    expect(await pointsOf()).toBe(50)
    await expect(db.query('select public.set_vote_winner_points($1, 5000)', [voteId])).rejects.toThrow('0 to 1000')
    await db.query('select public.delete_vote($1)', [voteId])
    await expect(db.query("select public.start_vote('Funniest', 2000)")).rejects.toThrow('0 to 1000')
    await db.query("select public.start_vote('Funniest', 40)")
  })
})
