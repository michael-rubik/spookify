import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

const [admin, ann] = ['1', '2'].map((n) => `00000000-0000-0000-0000-00000000000${n}`)
const schema = readFileSync('supabase/schema.sql', 'utf8')

describe('karaoke toggle', () => {
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
    await db.exec('grant all on all tables in schema public to authenticated, service_role')
  }, 20000)
  afterAll(async () => { await db.close() })

  beforeEach(async () => {
    await db.exec('reset role; delete from public.karaoke_queue; delete from auth.users; delete from public.signup_codes')
    await db.exec("insert into public.app_settings (key, int_value) values ('karaoke_enabled', 1) on conflict (key) do update set int_value = 1")
    await db.exec("insert into public.signup_codes (code, seats) values ('SEED', 100)")
    for (const [index, id] of [admin, ann].entries()) {
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
  const queueSong = async (user: string) => {
    await asUser(user)
    await db.query("insert into public.karaoke_queue (title, queued_by, duration_seconds) values ('Song', $1, 180)", [user])
  }

  it('is on by default and lets users queue songs', async () => {
    await asUser(ann)
    const { rows } = await db.query<{ karaoke_enabled: boolean }>('select public.karaoke_enabled()')
    expect(rows[0].karaoke_enabled).toBe(true)
    await queueSong(ann)
  })

  it('blocks queueing while an admin has it off, and allows it again when on', async () => {
    await asUser(admin)
    await db.query('select public.set_karaoke_enabled(false)')
    await asUser(ann)
    const { rows } = await db.query<{ karaoke_enabled: boolean }>('select public.karaoke_enabled()')
    expect(rows[0].karaoke_enabled).toBe(false)
    await expect(queueSong(ann)).rejects.toThrow(/row-level security/i)

    await asUser(admin)
    await db.query('select public.set_karaoke_enabled(true)')
    await queueSong(ann)
  })

  it('lets only admins change it', async () => {
    await asUser(ann)
    await expect(db.query('select public.set_karaoke_enabled(false)')).rejects.toThrow('Only admins')
  })
})
