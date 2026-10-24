import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

const ids = ['1', '2', '3', '4'].map((n) => `00000000-0000-0000-0000-00000000000${n}`)
const [admin, ann, ben, cat] = ids
const schema = readFileSync('supabase/schema.sql', 'utf8')
const migration = readFileSync('supabase/migrations/20261042_clicker_fights.sql', 'utf8')

describe('clicker fights', () => {
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
  }, 20000)
  afterAll(async () => {
    await db.close()
  })

  beforeEach(async () => {
    await db.exec(`reset role; delete from public.clicker_fights; delete from auth.users; delete from public.signup_codes;
      update public.app_settings set int_value = 5 where key = 'fight_duration_minutes';
      update public.app_settings set int_value = 1 where key = 'daily_fight_limit';
      update public.battle_pass_levels set bonus_fights = 0`)
    await db.exec("insert into public.signup_codes (code, seats) values ('SEED', 100)")
    for (const [index, id] of ids.entries()) {
      await db.query('insert into auth.users (id,email,raw_user_meta_data) values ($1,$2,$3)', [
        id,
        `user${index}@example.com`,
        JSON.stringify({ signup_code: 'SEED', name: `User ${index}`, costume: `Costume ${index}` }),
      ])
    }
    await db.query('update public.users set is_admin = true where id = $1', [admin])
  })

  const asUser = async (id: string) => {
    await db.exec('reset role')
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [id])
    await db.exec('set role authenticated')
  }
  const setClicks = async (id: string, count: number) => {
    await db.exec('reset role')
    await db.query('update public.users set click_count = $2 where id = $1', [id, count])
  }
  const click = async (id: string, count: number) => {
    await db.exec('reset role')
    await db.query("update public.users set clicks_flushed_at = now() - interval '1 hour' where id = $1", [id])
    await asUser(id)
    return Number((await db.query<{ register_clicks: number }>('select public.register_clicks($1)', [count])).rows[0].register_clicks)
  }
  const callFight = async (id: string) => {
    await asUser(id)
    return db.query('select public.call_clicker_fight()')
  }
  const stateOf = async (id: string) => {
    await asUser(id)
    return (await db.query<{ running: boolean; fighters: number; daily_limit: number; calls_today: number; next_call_at: string | null }>(
      'select * from public.clicker_fight_state()',
    )).rows[0]
  }
  const endFight = async () => {
    await db.exec("reset role; update public.clicker_fights set ends_at = now() - interval '1 second'")
  }
  const scores = async () => {
    await db.exec('reset role')
    return (await db.query<{ user_id: string; clicks: number; won: boolean }>(
      'select user_id, clicks, won from public.clicker_fight_scores order by clicks desc, user_id',
    )).rows
  }

  it('only lets fighters with 250 clicks call a fight', async () => {
    await setClicks(ann, 249)
    await expect(callFight(ann)).rejects.toThrow('250 clicks')
    await setClicks(ann, 250)
    await callFight(ann)
    expect((await stateOf(ben)).running).toBe(true)
    expect((await stateOf(ben)).fighters).toBe(1)
  })

  it('runs one fight at a time', async () => {
    await setClicks(ann, 300)
    await setClicks(ben, 300)
    await db.exec('reset role')
    await db.query("update public.app_settings set int_value = 5 where key = 'daily_fight_limit'")
    await callFight(ann)
    await expect(callFight(ben)).rejects.toThrow('already running')
    await endFight()
    await callFight(ben)
  })

  it('scores only the clicks beyond 250, and only while a fight runs', async () => {
    await setClicks(ann, 240)
    await setClicks(ben, 250)
    await click(ann, 5)
    expect(await scores()).toEqual([])

    await setClicks(ann, 250)
    await callFight(ben)
    await click(ann, 10)
    await setClicks(cat, 240)
    await click(cat, 30)
    expect(await scores()).toEqual([
      { user_id: cat, clicks: 20, won: false },
      { user_id: ann, clicks: 10, won: false },
    ])
    expect(await click(ann, 20)).toBe(280)
    expect((await scores()).find((row) => row.user_id === ann)?.clicks).toBe(30)

    await endFight()
    await click(ann, 5)
    expect((await scores()).find((row) => row.user_id === ann)?.clicks).toBe(30)
  })

  it('crowns every tied top scorer and awards the badge', async () => {
    await setClicks(ann, 250)
    await setClicks(ben, 250)
    await setClicks(cat, 250)
    await callFight(ann)
    await click(ann, 10)
    await click(ben, 10)
    await click(cat, 4)
    await endFight()

    await asUser(cat)
    await db.query('select * from public.my_badge_progress()')
    expect((await scores()).map((row) => [row.user_id, row.won])).toEqual([
      [ann, true],
      [ben, true],
      [cat, false],
    ])

    await asUser(ann)
    const { rows } = await db.query<{ badge_id: string; progress: string }>('select * from public.my_badge_progress()')
    expect(Number(rows.find((row) => row.badge_id === 'fight-winner')?.progress)).toBe(1)
    await db.exec('reset role')
    const held = (await db.query<{ badges: string[] }>('select badges from public.users where id = $1', [ann])).rows[0].badges
    expect(held).toContain('fight-winner')
    const other = (await db.query<{ badges: string[] }>('select badges from public.users where id = $1', [cat])).rows[0].badges
    expect(other).not.toContain('fight-winner')
  })

  it('names no winner without two fighters or without clicks', async () => {
    await setClicks(ann, 250)
    await callFight(ann)
    await click(ann, 10)
    await endFight()
    await stateOf(ann)
    expect((await scores()).map((row) => row.won)).toEqual([false])

    await setClicks(ben, 250)
    await db.exec('reset role')
    await db.query("update public.app_settings set int_value = 5 where key = 'daily_fight_limit'")
    await callFight(ben)
    await endFight()
    await stateOf(ben)
    expect((await scores()).every((row) => !row.won)).toBe(true)
  })

  it('limits calls per day, raised by milestone bonus fights', async () => {
    await setClicks(ann, 250)
    await callFight(ann)
    await endFight()
    await expect(callFight(ann)).rejects.toThrow('Daily fight limit')
    const state = await stateOf(ann)
    expect([state.daily_limit, state.calls_today]).toEqual([1, 1])

    await db.exec(`reset role; update public.battle_pass_levels set bonus_fights = 1 where xp_required = (select min(xp_required) from public.battle_pass_levels);
      update public.users set badges = array['voter','karaoke','spooker','clicker'] where id = '${ann}'`)
    await callFight(ann)
    expect((await stateOf(ann)).daily_limit).toBe(2)

    await db.exec("reset role; update public.clicker_fights set started_at = now() - interval '25 hours', ends_at = now() - interval '24 hours'")
    expect((await stateOf(ann)).calls_today).toBe(0)
  })

  it('resets daily limits when an admin asks, for fights and songs alike', async () => {
    await setClicks(ann, 250)
    await callFight(ann)
    await endFight()
    await stateOf(ann)
    await expect(callFight(ann)).rejects.toThrow('Daily fight limit')
    expect((await stateOf(ann)).next_call_at).not.toBeNull()

    await db.exec(`reset role; insert into public.spookify_songs (spotify_track_id, title, artist, added_by)
      values ('t1', 'Song', 'Artist', '${ann}')`)
    await asUser(ann)
    expect(Number((await db.query<{ added_today: number }>('select * from public.my_song_allowance()')).rows[0].added_today)).toBe(1)

    await expect(db.query('select public.reset_daily_limits()')).rejects.toThrow('Only admins')
    await asUser(admin)
    await db.query('select public.reset_daily_limits()')

    await asUser(ann)
    expect((await stateOf(ann)).calls_today).toBe(0)
    expect(Number((await db.query<{ added_today: number }>('select * from public.my_song_allowance()')).rows[0].added_today)).toBe(0)
    await callFight(ann)
  })

  it('lets only admins change the settings', async () => {
    await asUser(ann)
    await expect(db.query('select public.set_clicker_fight_settings(10, 2)')).rejects.toThrow('Only admins')
    await asUser(admin)
    await db.query('select public.set_clicker_fight_settings(10, 2)')
    await expect(db.query('select public.set_clicker_fight_settings(0, 2)')).rejects.toThrow('1 to 120')
    const { rows } = await db.query<{ duration_minutes: number; daily_limit: number }>('select * from public.clicker_fight_settings()')
    expect(rows).toEqual([{ duration_minutes: 10, daily_limit: 2 }])
  })

  it('swaps Winner winner for the legacy badge, once', async () => {
    await db.exec(`reset role; update public.users set badges = array['clicker','winner-winner'] where id = '${ann}';
      update public.users set badges = array['fight-winner','winner-winner'] where id = '${ben}'`)
    await db.exec(migration)
    await db.exec(migration)
    const badgesOf = async (id: string) =>
      (await db.query<{ badges: string[] }>('select badges from public.users where id = $1', [id])).rows[0].badges
    expect(await badgesOf(ann)).toEqual(['clicker', 'legacy-winner'])
    expect(await badgesOf(ben)).toEqual(['fight-winner', 'winner-winner'])
  })

  it('removes a deleted user from the fight', async () => {
    await setClicks(ann, 250)
    await callFight(ann)
    await click(ann, 5)
    await db.exec(`reset role; delete from auth.users where id = '${ann}'`)
    expect(await scores()).toEqual([])
  })
})
