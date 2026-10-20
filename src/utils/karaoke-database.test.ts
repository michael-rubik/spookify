import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

const owner = '00000000-0000-0000-0000-000000000001'
const other = '00000000-0000-0000-0000-000000000002'
const admin = '00000000-0000-0000-0000-000000000003'
const migration = readFileSync('supabase/migrations/20261024_fix_karaoke_scheduling.sql', 'utf8')
const original = readFileSync('supabase/migrations/20261022_add_karaoke_queue.sql', 'utf8')

describe('karaoke database scheduling and removal', () => {
  const db = new PGlite()

  beforeAll(async () => {
    await db.exec(`
      create role authenticated;
      create role anon;
      create schema auth;
      create function auth.uid() returns uuid language sql stable as
        $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      create table public.users (id uuid primary key, is_admin boolean not null default false);
      insert into public.users values ('${owner}', false), ('${other}', false), ('${admin}', true);
      grant usage on schema public, auth to authenticated;
      grant select on public.users to authenticated;
    `)
    await db.exec(original)
    await db.exec(migration)
    await db.exec('grant select, insert, update, delete on public.karaoke_queue to authenticated')
  }, 20000)

  afterAll(async () => { await db.close() })
  beforeEach(async () => { await db.exec('reset role; truncate public.karaoke_queue') })

  const asUser = async (id: string) => {
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [id])
    await db.exec('set role authenticated')
  }
  const add = async (title: string, userId = owner) => {
    await asUser(userId)
    await db.query('insert into public.karaoke_queue (title, queued_by) values ($1, $2)', [title, userId])
  }
  const songs = async () => (await db.query<{
    id: string
    title: string
    status: string
    started_at: Date | null
    ends_at: Date | null
  }>('select * from public.karaoke_queue order by created_at, id')).rows

  it('starts at now after an archived song, and appends across different owners', async () => {
    await db.query(`
      insert into public.karaoke_queue (title, queued_by, status, created_at, started_at, ends_at)
      values ('History', $1, 'completed', now() - interval '2 hours',
        now() - interval '2 hours', now() - interval '115 minutes')
    `, [owner])
    const before = Date.now()
    await add('First')
    await add('Second', other)
    const [, first, second] = await songs()
    expect(first.status).toBe('playing')
    expect(first.started_at!.getTime()).toBeGreaterThanOrEqual(before)
    expect(second.status).toBe('queued')
    expect(second.started_at).toEqual(first.ends_at)
  })

  it('lets an owner remove their waiting song and closes the gap for another owner', async () => {
    await add('Playing', other)
    await add('Remove me')
    await add('Last', other)
    const [playing, removed] = await songs()
    await asUser(owner)
    await db.query('delete from public.karaoke_queue where id = $1', [removed.id])
    const remaining = await songs()
    expect(remaining.map((song) => song.title)).toEqual(['Playing', 'Last'])
    expect(remaining[0].started_at).toEqual(playing.started_at)
    expect(remaining[1].started_at).toEqual(playing.ends_at)
  })

  it('starts the next song now when its owner removes the playing song', async () => {
    await add('Playing')
    await add('Next', other)
    const [playing] = await songs()
    const before = Date.now()
    await asUser(owner)
    await db.query('delete from public.karaoke_queue where id = $1', [playing.id])
    const [next] = await songs()
    expect(next.status).toBe('playing')
    expect(next.started_at!.getTime()).toBeGreaterThanOrEqual(before)
    expect(next.started_at!.getTime()).toBeLessThan(Date.now() + 1000)
  })

  it('prevents another user from removing a song but allows an admin', async () => {
    await add('Protected')
    const [song] = await songs()
    await asUser(other)
    await db.query('delete from public.karaoke_queue where id = $1', [song.id])
    expect(await songs()).toHaveLength(1)
    await asUser(admin)
    await db.query('delete from public.karaoke_queue where id = $1', [song.id])
    expect(await songs()).toHaveLength(0)
  })

  it('closes a skipped slot and adjusts following songs when an admin changes duration', async () => {
    await add('Playing')
    await add('Skip me', other)
    await add('Last', other)
    const [playing, skipped] = await songs()
    await asUser(admin)
    await db.query("update public.karaoke_queue set status = 'skipped', skipped_by = $1 where id = $2", [admin, skipped.id])
    let queue = await songs()
    expect(queue[1].status).toBe('skipped')
    expect(queue[2].started_at).toEqual(queue[0].ends_at)
    await db.query('update public.karaoke_queue set duration_seconds = 600 where id = $1', [playing.id])
    queue = await songs()
    expect(queue[0].started_at).toEqual(playing.started_at)
    expect(queue[0].ends_at!.getTime() - queue[0].started_at!.getTime()).toBe(600000)
    expect(queue[2].started_at).toEqual(queue[0].ends_at)
  })

  it('appends after the naturally advanced song without restarting it', async () => {
    // Seed elapsed time without firing the scheduler on each fixture row.
    await db.exec('alter table public.karaoke_queue disable trigger karaoke_queue_schedule')
    await db.query(`
      insert into public.karaoke_queue
        (title, queued_by, status, created_at, started_at, ends_at)
      values
        ('Expired', $1, 'playing', now() - interval '10 minutes',
          now() - interval '6 minutes', now() - interval '1 minute'),
        ('Current', $2, 'queued', now() - interval '9 minutes',
          now() - interval '1 minute', now() + interval '4 minutes'),
        ('Waiting', $1, 'queued', now() - interval '8 minutes',
          now() + interval '4 minutes', now() + interval '9 minutes')
    `, [owner, other])
    const [, current] = await songs()
    await db.exec('alter table public.karaoke_queue enable trigger karaoke_queue_schedule')
    await add('New')
    const queue = await songs()
    expect(queue[0].status).toBe('completed')
    expect(queue[1].status).toBe('playing')
    expect(queue[1].started_at).toEqual(current.started_at)
    expect(queue[2].started_at).toEqual(queue[1].ends_at)
    expect(queue[3].started_at).toEqual(queue[2].ends_at)
  })

  it('keeps the privileged scheduler inaccessible to API roles', async () => {
    const { rows } = await db.query<{ allowed: boolean }>(`
      select has_function_privilege('authenticated', 'private.schedule_karaoke_queue()', 'execute') as allowed
    `)
    expect(rows[0].allowed).toBe(false)
  })

  it('rejects unauthenticated queue changes even through the trigger', async () => {
    await asUser('')
    await expect(db.exec('delete from public.karaoke_queue')).rejects
      .toThrow('Authentication required for queue changes')
  })
})
