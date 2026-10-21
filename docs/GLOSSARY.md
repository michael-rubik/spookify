# Glossary

**User** — A registered person with a public profile. Created automatically at signup; may be an admin.

**Signup code** — A code a new person must present to create an account. Each code has a fixed number of seats. Matching ignores case and surrounding whitespace. Added and removed by admins.

**Seat** — One permitted signup under a signup code. A seat is taken the moment an account is created with that code. Existing users predate the system and need no code.

**Spook** — A photo post by one user, optionally tagging other users.

**Tag** — The link between a spook and a tagged user. A spook may have no tags.

**Badge** — A reward a user earns when their click count crosses a threshold. Each badge has a badge message shown to the user. Once earned it is kept until an admin resets clicks.

**Badge message** — The text attached to a badge, visible only to its owner on the clicker view while the badge is held.

**Vote** — A named, admin-run event in which users pick their favourite costume for a category. Open until an admin ends it; then it is ended and its results are public.

**Category** — The name an admin gives a vote (e.g. "Best costume"). It is the question voters answer and the title shown on the poll and leaderboard.
_Avoid_: Poll (for the event), election

**Candidate** — An active user who can receive ballots in a vote. Voters see the candidate's name, profile picture and costume. Nobody can vote for themselves.

**Ballot** — One anonymous choice of a candidate in a vote. A ballot can never be traced to its voter. Each active user casts exactly one per vote and cannot change it.

**Poll view** — The user-facing page showing the open vote, its progress, and the results of ended votes. Hidden until the first vote is started.

**Winner** — The candidate with the most ballots in an ended vote; tied candidates are all winners.

**Winner badge** — "Gewinner von `<category>`", shown to each winner of an ended vote. It exists only while its vote exists.

**Deletion pending** — Marker (`users.deletion_pending_at`) on an account whose permanent deletion has started. The account is blocked from writes and sign-in until deletion finishes. If cleanup fails, it stays pending as the retry target.

**Permanent account deletion** — Admin-only removal of another user: the account is marked pending, their avatar and spook images are removed from Storage, then the Auth account and profile are deleted. Their spooks and karaoke songs are removed, and their tags are removed from other authors' spooks. The same email may later register as a fresh, non-admin user with no restored data.
