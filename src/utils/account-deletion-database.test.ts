import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

const admin = '00000000-0000-0000-0000-000000000001'
const target = '00000000-0000-0000-0000-000000000002'
const other = '00000000-0000-0000-0000-000000000003'
const schema = readFileSync('supabase/schema.sql', 'utf8')
const migration = readFileSync('supabase/migrations/20261025_permanent_account_deletion.sql', 'utf8')

describe.each([
  { name: 'fresh schema only', applyMigration: false },
  { name: 'schema plus migration', applyMigration: true },
])('account deletion database lifecycle ($name)', ({ applyMigration }) => {
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
    // The migration must also apply to an existing installation.
    if (applyMigration) await db.exec(migration)
    await db.exec('grant all on all tables in schema public to authenticated, service_role')
  }, 20000)
  afterAll(async () => { await db.close() })
  beforeEach(async () => {
    await db.exec('reset role; delete from storage.objects; delete from auth.users; delete from public.signup_codes')
    await db.exec("insert into public.signup_codes (code, seats) values ('TEST', 100)")
    await db.query(`
      insert into auth.users (id,email,raw_user_meta_data) values
        ($1,'admin@example.com','{"signup_code":"TEST"}'), ($2,'target@example.com','{"signup_code":"TEST"}'), ($3,'other@example.com','{"signup_code":"TEST"}')
    `, [admin, target, other])
    await db.query('update public.users set is_admin = true where id = $1', [admin])
  })
  const asUser = async (id: string) => {
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [id])
    await db.exec('set role authenticated')
  }
  const begin = async (actor = admin, id = target) => {
    await db.exec('reset role; set role service_role')
    await db.query('select public.begin_account_deletion($1, $2)', [actor, id])
  }

  it('requires an active database admin, prohibits self deletion, and rejects missing targets', async () => {
    await expect(begin(other)).rejects.toThrow('Active admin required')
    await expect(begin(admin, admin)).rejects.toThrow('Cannot delete yourself')
    await expect(begin(admin, '00000000-0000-0000-0000-000000000099')).rejects.toThrow('User not found')
    await begin()
    await expect(begin(target, other)).rejects.toThrow('Active admin required')
    await db.exec('reset role')
    const result = await db.query<{ deletion_pending_at: Date }>('select deletion_pending_at from public.users where id = $1', [target])
    expect(result.rows[0].deletion_pending_at).not.toBeNull()
    await begin()
  })

  it('prevents direct profile deletion, self promotion, and pending-state tampering', async () => {
    await asUser(admin)
    await expect(db.query('delete from public.users where id = $1', [target])).rejects.toThrow()
    await asUser(other)
    await expect(db.query('update public.users set is_admin = true where id = $1', [other])).rejects.toThrow('Only admins')
    await begin()
    await asUser(admin)
    await expect(db.query('update public.users set deletion_pending_at = null where id = $1', [target])).rejects.toThrow('Deletion pending')
    await expect(db.query("update public.users set name = 'Restore' where id = $1", [target])).rejects.toThrow('Deletion pending')
  })

  it('blocks stale sessions on every public mutation and avatar/spook storage mutation', async () => {
    await db.query("insert into public.spooks (user_id, caption, image_url) values ($1,'Photo','url')", [target])
    await db.query("insert into public.karaoke_queue (title, queued_by) values ('Song',$1)", [target])
    await db.query(`insert into storage.objects (bucket_id,name,owner,owner_id)
      values ('avatars','old-avatar',$1::uuid,$1::uuid::text), ('spooks','nested/photo',$1::uuid,$1::uuid::text)`, [target])
    await begin()
    await asUser(target)
    for (const sql of [
      "update public.users set name = 'Changed'",
      'delete from public.spooks',
      "insert into public.spooks (user_id, caption, image_url) values (auth.uid(),'New','url')",
      "update public.karaoke_queue set title = 'Changed'",
      'delete from public.karaoke_queue',
      'delete from public.spook_tagged_users',
      'insert into public.spook_tagged_users select id, auth.uid(), now() from public.spooks',
      "insert into storage.objects (bucket_id,name,owner,owner_id) values ('avatars','new',auth.uid(),auth.uid()::text)",
      "insert into storage.objects (bucket_id,name,owner,owner_id) values ('spooks','new',auth.uid(),auth.uid()::text)",
      "update storage.objects set name = 'Changed'",
      'delete from storage.objects',
    ]) {
      await expect(db.exec(sql), sql).rejects.toThrow('Account is not active')
    }
  })

  it('discovers owned objects independently of paths and URLs, paginates, and leaves other owners alone', async () => {
    await db.query(`insert into storage.objects (bucket_id,name,owner,owner_id) values
      ('avatars','legacy-flat.jpg',$1::uuid,null),
      ('spooks','unexpected/nested.jpg',$1::uuid,$1::uuid::text),
      ('spooks','target-looking-but-not-owned.jpg',$2::uuid,$2::uuid::text)`, [target, other])
    await begin()
    const files = await db.query<{ name: string }>('select * from public.account_deletion_files($1, 1)', [target])
    expect(files.rows.map((file) => file.name)).toEqual(['legacy-flat.jpg'])
    await db.exec("delete from storage.objects where name = 'legacy-flat.jpg'")
    const next = await db.query<{ name: string }>('select * from public.account_deletion_files($1, 100)', [target])
    expect(next.rows.map((file) => file.name)).toEqual(['unexpected/nested.jpg'])
    await asUser(other)
    await expect(db.query('select public.begin_account_deletion($1,$2)', [admin, target])).rejects.toThrow()
    await expect(db.query('select * from public.account_deletion_files($1,100)', [target])).rejects.toThrow()
  })

  it('cascades authored data and tags but preserves another spook with zero tags and the current song', async () => {
    const authored = (await db.query<{ id: string }>("insert into public.spooks (user_id,caption,image_url) values ($1,'Authored','url') returning id", [target])).rows[0].id
    const preserved = (await db.query<{ id: string }>("insert into public.spooks (user_id,caption,image_url) values ($1,'Preserved','url') returning id", [other])).rows[0].id
    await db.query('insert into public.spook_tagged_users (spook_id,user_id) values ($1,$3), ($2,$4)', [authored, preserved, other, target])
    for (const [index, [title, user]] of [['Current', other], ['Removed', target], ['Last', other]].entries()) {
      await db.query("insert into public.karaoke_queue (title, queued_by, created_at) values ($1,$2, now() + $3 * interval '1 second')", [title, user, index])
    }
    const current = (await db.query<{ started_at: Date; ends_at: Date }>("select * from public.karaoke_queue where title = 'Current'")).rows[0]
    await begin()
    await db.exec('reset role')
    await db.query('delete from auth.users where id = $1', [target])
    expect((await db.query('select * from public.users where id = $1', [target])).rows).toHaveLength(0)
    expect((await db.query('select id from public.spooks')).rows).toEqual([{ id: preserved }])
    expect((await db.query('select * from public.spook_tagged_users')).rows).toHaveLength(0)
    const queue = (await db.query<{ title: string; started_at: Date }>('select * from public.karaoke_queue order by created_at,id')).rows
    expect(queue.map((song) => song.title)).toEqual(['Current', 'Last'])
    expect(queue[0].started_at).toEqual(current.started_at)
    expect(queue[1].started_at).toEqual(current.ends_at)
    await db.query("insert into auth.users (id,email,raw_user_meta_data) values ($1,'target@example.com','{\"is_admin\":true,\"signup_code\":\"TEST\"}')", ['00000000-0000-0000-0000-000000000004'])
    const fresh = (await db.query<{ is_admin: boolean; click_count: number; deletion_pending_at: Date | null }>("select * from public.users where email = 'target@example.com'")).rows[0]
    expect(fresh).toMatchObject({ is_admin: false, click_count: 0, deletion_pending_at: null })
    await asUser(target)
    await expect(db.exec("update public.users set name = 'Stale JWT'")).rejects.toThrow('Account is not active')
  })
})
