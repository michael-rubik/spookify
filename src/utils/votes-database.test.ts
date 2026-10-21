import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

const ids = ['1', '2', '3', '4', '5'].map((n) => `00000000-0000-0000-0000-00000000000${n}`)
const [admin, ann, ben, cat, dan] = ids
const schema = readFileSync('supabase/schema.sql', 'utf8')
const migrations = [
  'supabase/migrations/20261026_restore_signup_profile_trigger.sql',
  'supabase/migrations/20261027_add_signup_codes.sql',
  'supabase/migrations/20261028_add_votes.sql',
].map((path) => readFileSync(path, 'utf8'))

describe.each([
  { name: 'fresh schema only', applyMigrations: false },
  { name: 'schema plus migrations', applyMigrations: true },
])('votes ($name)', ({ applyMigrations }) => {
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
    await db.exec('reset role; delete from public.votes; delete from auth.users; delete from public.signup_codes')
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
  const startVote = async (category = 'Best costume') => {
    await asUser(admin)
    const { rows } = await db.query<{ start_vote: string }>('select public.start_vote($1)', [category])
    return rows[0].start_vote
  }
  const vote = async (voteId: string, voter: string, candidate: string) => {
    await asUser(voter)
    await db.query('select public.cast_ballot($1, $2)', [voteId, candidate])
  }
  const count = async (table: string) => {
    await db.exec('reset role')
    const { rows } = await db.query<{ n: number }>(`select count(*)::int as n from public.${table}`)
    return rows[0].n
  }

  it('lets only admins start a vote, with a trimmed category of 1 to 60 characters', async () => {
    await asUser(ann)
    await expect(db.query("select public.start_vote('Best costume')")).rejects.toThrow('Only admins can start a vote')
    await asUser(admin)
    await expect(db.query("select public.start_vote('   ')")).rejects.toThrow('1 to 60 characters')
    await expect(db.query('select public.start_vote($1)', ['x'.repeat(61)])).rejects.toThrow('1 to 60 characters')
    await startVote('  Scariest  ')
    await db.exec('reset role')
    expect((await db.query('select category, status from public.votes')).rows).toEqual([{ category: 'Scariest', status: 'open' }])
  })

  it('allows only one open vote at a time', async () => {
    const first = await startVote()
    await expect(startVote('Another')).rejects.toThrow('A vote is already open')
    await asUser(admin)
    await db.query('select public.end_vote($1)', [first])
    await expect(startVote('Another')).resolves.toBeTruthy()
  })

  it('counts exactly one ballot per user and forbids self votes', async () => {
    const voteId = await startVote()
    await vote(voteId, ann, ben)
    await expect(vote(voteId, ann, cat)).rejects.toThrow('You have already voted')
    await expect(vote(voteId, ben, ben)).rejects.toThrow('You cannot vote for yourself')
    await expect(vote(voteId, cat, '00000000-0000-0000-0000-0000000000ff')).rejects.toThrow()
    expect(await count('vote_participation')).toBe(1)
    expect((await db.query('select ballots from public.vote_tallies')).rows).toEqual([{ ballots: 1 }])
  })

  it('rejects ballots for pending-deletion candidates and from pending voters', async () => {
    const voteId = await startVote()
    await db.exec('reset role')
    await db.query('update public.users set deletion_pending_at = now() where id = $1', [dan])
    await expect(vote(voteId, ann, dan)).rejects.toThrow('Unknown candidate')
    await expect(vote(voteId, dan, ann)).rejects.toThrow('Account is not active')
  })

  it('keeps ballots unlinked from voters and hides tallies until the vote ends', async () => {
    const voteId = await startVote()
    await vote(voteId, ann, ben)
    await vote(voteId, cat, ben)

    const columns = (await db.query<{ table_name: string; column_name: string }>(
      `select table_name, column_name from information_schema.columns
       where table_schema = 'public' and table_name in ('vote_tallies', 'vote_participation')`,
    )).rows
    expect(columns.filter((c) => c.table_name === 'vote_tallies').map((c) => c.column_name).sort())
      .toEqual(['ballots', 'candidate_id', 'vote_id'])
    expect(columns.filter((c) => c.table_name === 'vote_participation').map((c) => c.column_name).sort())
      .toEqual(['user_id', 'vote_id'])

    await asUser(dan)
    expect((await db.query('select 1 from public.vote_tallies')).rows).toHaveLength(0)
    expect((await db.query('select 1 from public.vote_participation')).rows).toHaveLength(0)
    await asUser(ann)
    expect((await db.query('select user_id from public.vote_participation')).rows).toEqual([{ user_id: ann }])

    await asUser(admin)
    expect((await db.query('select 1 from public.vote_tallies')).rows).toHaveLength(0)
    await db.query('select public.end_vote($1)', [voteId])
    await asUser(dan)
    expect((await db.query('select candidate_id, ballots from public.vote_tallies')).rows).toEqual([{ candidate_id: ben, ballots: 2 }])
  })

  it('reports progress as voters over active users', async () => {
    const voteId = await startVote()
    await vote(voteId, ann, ben)
    await vote(voteId, ben, ann)
    await asUser(dan)
    expect((await db.query('select * from public.vote_progress($1)', [voteId])).rows).toEqual([{ voted: 2, eligible: 5 }])
    await db.exec('reset role')
    await db.query('update public.users set deletion_pending_at = now() where id = $1', [cat])
    await asUser(dan)
    expect((await db.query('select * from public.vote_progress($1)', [voteId])).rows).toEqual([{ voted: 2, eligible: 4 }])
  })

  it('makes every tied candidate a winner and nobody a winner without ballots', async () => {
    const tied = await startVote('Tied')
    await vote(tied, ann, ben)
    await vote(tied, cat, dan)
    await vote(tied, admin, dan)
    await vote(tied, ben, dan)
    await vote(tied, dan, ben)
    await asUser(admin)
    await db.query('select public.end_vote($1)', [tied])
    expect((await db.query('select user_id from public.vote_winners order by user_id')).rows).toEqual([{ user_id: dan }])

    const split = await startVote('Split')
    await vote(split, ann, ben)
    await vote(split, cat, dan)
    await asUser(admin)
    await db.query('select public.end_vote($1)', [split])
    expect((await db.query('select user_id from public.vote_winners where vote_id = $1 order by user_id', [split])).rows)
      .toEqual([{ user_id: ben }, { user_id: dan }])

    const empty = await startVote('Empty')
    await asUser(admin)
    await db.query('select public.end_vote($1)', [empty])
    expect((await db.query('select 1 from public.vote_winners where vote_id = $1', [empty])).rows).toHaveLength(0)
  })

  it('forbids ballots after the vote ended', async () => {
    const voteId = await startVote()
    await asUser(admin)
    await db.query('select public.end_vote($1)', [voteId])
    await expect(vote(voteId, ann, ben)).rejects.toThrow('This vote is not open')
    await asUser(admin)
    await expect(db.query('select public.end_vote($1)', [voteId])).rejects.toThrow('This vote is not open')
  })

  it('removes every trace when an open vote is reset or an ended vote is deleted', async () => {
    const ended = await startVote('Ended')
    await vote(ended, ann, ben)
    await asUser(admin)
    await db.query('select public.end_vote($1)', [ended])
    const open = await startVote('Open')
    await vote(open, ann, cat)

    await asUser(ann)
    await expect(db.query('select public.delete_vote($1)', [open])).rejects.toThrow('Only admins can delete a vote')
    await asUser(admin)
    await db.query('select public.delete_vote($1)', [open])
    await db.query('select public.delete_vote($1)', [ended])
    await expect(db.query('select public.delete_vote($1)', [ended])).rejects.toThrow('Vote not found')

    for (const table of ['votes', 'vote_participation', 'vote_tallies', 'vote_winners']) {
      expect(await count(table)).toBe(0)
    }
  })

  it('denies direct writes to every vote table', async () => {
    const voteId = await startVote()
    await asUser(admin)
    await expect(db.query("insert into public.votes (category) values ('Sneaky')")).rejects.toThrow()
    await expect(db.query('insert into public.vote_tallies values ($1, $2, 50)', [voteId, ann])).rejects.toThrow()
    await expect(db.query('insert into public.vote_participation values ($1, $2)', [voteId, ann])).rejects.toThrow()
    await expect(db.query('insert into public.vote_winners values ($1, $2)', [voteId, ann])).rejects.toThrow()
    await db.query("update public.votes set category = 'Hacked'")
    await db.query('delete from public.votes')
    await db.exec('reset role')
    expect((await db.query('select category from public.votes')).rows).toEqual([{ category: 'Best costume' }])
  })

  it('drops winners, tallies and participation when their users are deleted', async () => {
    const voteId = await startVote()
    await vote(voteId, ann, ben)
    await asUser(admin)
    await db.query('select public.end_vote($1)', [voteId])
    await db.exec("reset role; delete from auth.users where id in ('" + ann + "', '" + ben + "')")
    await db.exec('delete from public.users where id in (\'' + ann + "', '" + ben + "')")
    expect(await count('vote_participation')).toBe(0)
    expect(await count('vote_tallies')).toBe(0)
    expect(await count('vote_winners')).toBe(0)
  })
})
