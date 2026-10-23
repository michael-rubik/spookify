import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

const admin = '00000000-0000-0000-0000-000000000001'
const member = '00000000-0000-0000-0000-000000000002'
const schema = readFileSync('supabase/schema.sql', 'utf8')
const migrations = [
  'supabase/migrations/20261026_restore_signup_profile_trigger.sql',
  'supabase/migrations/20261027_add_signup_codes.sql',
].map((path) => readFileSync(path, 'utf8'))

const newId = () => crypto.randomUUID()

describe.each([
  { name: 'fresh schema only', applyMigrations: false },
  { name: 'schema plus migrations', applyMigrations: true },
])('signup codes ($name)', ({ applyMigrations }) => {
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
  }, 20000)
  afterAll(async () => { await db.close() })

  beforeEach(async () => {
    await db.exec('reset role; delete from auth.users; delete from public.signup_codes')
    await db.exec("insert into public.signup_codes (code, seats) values ('SEED', 100)")
    await db.query(
      `insert into auth.users (id,email,raw_user_meta_data) values
        ($1,'admin@example.com','{"signup_code":"SEED"}'), ($2,'member@example.com','{"signup_code":"SEED"}')`,
      [admin, member],
    )
    await db.query('update public.users set is_admin = true where id = $1', [admin])
  })

  const asUser = async (id: string) => {
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [id])
    await db.exec('set role authenticated')
  }
  const signUp = (code: string | null, email = `${newId()}@example.com`) =>
    db.query('insert into auth.users (id,email,raw_user_meta_data) values ($1,$2,$3)', [
      newId(),
      email,
      JSON.stringify({ name: 'Boo', costume: `Ghost ${id}`, ...(code === null ? {} : { signup_code: code }) }),
    ])
  const addCode = (code: string, seats: number) =>
    db.query('insert into public.signup_codes (code, seats) values ($1,$2)', [code, seats])

  it('persists name, costume, and the redeemed code for a new user', async () => {
    await addCode('2468', 10)
    await signUp('2468', 'boo@example.com')
    const { rows } = await db.query<{ name: string; costume: string; code: string }>(
      `select u.name, u.costume, c.code from public.users u join public.signup_codes c on c.id = u.signup_code_id
       where u.email = 'boo@example.com'`,
    )
    expect(rows).toEqual([{ name: 'Boo', costume: 'Ghost', code: '2468' }])
  })

  it('rejects signups without, with an unknown, or with an exhausted code', async () => {
    await addCode('2468', 2)
    await expect(signUp(null)).rejects.toThrow('Invalid or exhausted signup code')
    await expect(signUp('nope')).rejects.toThrow('Invalid or exhausted signup code')
    await signUp('2468')
    await signUp('2468')
    await expect(signUp('2468')).rejects.toThrow('Invalid or exhausted signup code')
    const { rows } = await db.query<{ seats_used: number }>("select seats_used from public.signup_codes where code = '2468'")
    expect(rows[0].seats_used).toBe(2)
    expect((await db.query('select 1 from auth.users')).rows).toHaveLength(4)
  })

  it('matches codes ignoring case and surrounding whitespace', async () => {
    await addCode('  Party ', 2)
    await signUp(' PARTY')
    await signUp('party  ')
    await expect(signUp('Party')).rejects.toThrow('Invalid or exhausted signup code')
    await expect(addCode('PARTY', 5)).rejects.toThrow()
  })

  it('keeps seats used after the user is deleted and detaches removed codes', async () => {
    await addCode('2468', 1)
    await signUp('2468', 'boo@example.com')
    await db.exec("delete from auth.users where email = 'boo@example.com'")
    await expect(signUp('2468')).rejects.toThrow('Invalid or exhausted signup code')

    await addCode('KEEP', 5)
    await signUp('KEEP', 'keeper@example.com')
    await db.exec("delete from public.signup_codes where code = 'KEEP'")
    const { rows } = await db.query<{ signup_code_id: string | null }>("select signup_code_id from public.users where email = 'keeper@example.com'")
    expect(rows).toEqual([{ signup_code_id: null }])
    await expect(signUp('KEEP')).rejects.toThrow('Invalid or exhausted signup code')
  })

  it('lets active admins add, list, resize, and remove codes', async () => {
    await asUser(admin)
    await addCode('ADMIN', 3)
    await db.exec("update public.signup_codes set seats = 5 where code = 'ADMIN'")
    expect((await db.query('select code, seats, seats_used from public.signup_codes where code = $1', ['ADMIN'])).rows)
      .toEqual([{ code: 'ADMIN', seats: 5, seats_used: 0 }])
    await db.exec("delete from public.signup_codes where code = 'ADMIN'")
    expect((await db.query('select 1 from public.signup_codes where code = $1', ['ADMIN'])).rows).toHaveLength(0)
  })

  it('rejects lowering seats below used and direct edits of seats_used or the code', async () => {
    await addCode('2468', 3)
    await signUp('2468')
    await signUp('2468')
    await asUser(admin)
    await expect(db.exec("update public.signup_codes set seats = 1 where code = '2468'")).rejects.toThrow('signup_codes_seats_not_exceeded')
    await db.exec("update public.signup_codes set seats = 2 where code = '2468'")
    await expect(db.exec("update public.signup_codes set seats_used = 0 where code = '2468'")).rejects.toThrow('Only the seat count')
    await expect(db.exec("update public.signup_codes set code = 'OTHER' where code = '2468'")).rejects.toThrow('Only the seat count')
    await addCode('FRESH', 4)
    expect((await db.query("select seats_used from public.signup_codes where code = 'FRESH'")).rows).toEqual([{ seats_used: 0 }])
    await db.exec("reset role; update public.signup_codes set seats = 3 where code = '2468'")
  })

  it('hides codes from and blocks writes by non-admins', async () => {
    await asUser(member)
    expect((await db.query('select * from public.signup_codes')).rows).toHaveLength(0)
    await expect(addCode('SNEAKY', 99)).rejects.toThrow()
    await db.exec('reset role')
    await asUser(admin)
    expect((await db.query('select * from public.signup_codes')).rows.length).toBeGreaterThan(0)
  })
})
