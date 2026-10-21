# Ballots are anonymous by construction

Votes record *that* a user voted (`vote_participation`) and *what* was chosen (`vote_tallies`, a per-candidate counter) in two unlinked tables, with no voter id, no per-ballot rows and no timestamps. One `security definer` function writes both, so not even an admin reading the tables can trace a ballot to its voter. We rejected the simpler single table with a hidden `voter_id`, because that would make "anonymous" a UI promise rather than a fact.

## Consequences

- Admin moderation of a single ballot is impossible; admins can only reset or delete a whole vote.
- Real-time updates on ballots must never be used, since they would leak the choice. The live chart shown during an open vote is a decorative animation with no real data; only the progress percentage (a count-only function) is real until the vote ends.
- `end_vote` rewrites every tally in one transaction so a tuple's transaction id cannot point at a single voter. Anyone with raw access to Postgres system columns while a vote is still open could in principle correlate the last voter per candidate; that is accepted for a party app.
- End-to-end tests run against a throwaway local Postgres with PostgREST (podman) rather than the hosted project, so test votes never appear to real users or leave users behind.
