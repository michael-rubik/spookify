import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const [admin, ann, ben] = ['1', '2', '3'].map((n) => `00000000-0000-0000-0000-00000000000${n}`)
const schema = readFileSync('supabase/schema.sql', 'utf8')

describe('hidden costumes', () => {
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
    await db.exec("insert into public.signup_codes (code, seats) values ('SEED', 100)")
    for (const [index, id] of [admin, ann, ben].entries()) {
      await db.query('insert into auth.users (id,email,raw_user_meta_data) values ($1,$2,$3)', [
        id,
        `user${index}@example.com`,
        JSON.stringify({ signup_code: 'SEED', name: `User ${index}`, costume: `Costume ${index}` }),
      ])
    }
    await db.query('update public.users set is_admin = true where id = $1', [admin])
  }, 20000)
  afterAll(async () => {
    await db.close()
  })

  const asUser = async (id: string) => {
    await db.exec('reset role')
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [id])
    await db.exec('set role authenticated')
  }
  const costumesFor = async (id: string) => {
    await asUser(id)
    const { rows } = await db.query<{ id: string }>('select id from public.visible_costumes() order by id')
    return rows.map((row) => row.id)
  }

  it('shows every costume until an admin hides them', async () => {
    expect(await costumesFor(ann)).toEqual([admin, ann, ben])
  })

  it('only lets admins change the setting', async () => {
    await asUser(ann)
    await expect(db.query('select public.set_costumes_hidden(true)')).rejects.toThrow('Only admins')
  })

  it('leaves each user only their own costume while hidden, admins included', async () => {
    await asUser(admin)
    await db.query('select public.set_costumes_hidden(true)')
    expect((await db.query('select public.costumes_hidden() as hidden')).rows).toEqual([{ hidden: true }])
    expect(await costumesFor(ann)).toEqual([ann])
    expect(await costumesFor(admin)).toEqual([admin])
  })

  it('keeps the costume column unreadable on the users table', async () => {
    await asUser(ann)
    await expect(db.query('select costume from public.users')).rejects.toThrow('permission denied')
    expect((await db.query('select id, name from public.users')).rows).toHaveLength(3)
  })

  it('shows every costume again once an admin reveals them', async () => {
    await asUser(admin)
    await db.query('select public.set_costumes_hidden(false)')
    expect(await costumesFor(ben)).toEqual([admin, ann, ben])
  })
})
