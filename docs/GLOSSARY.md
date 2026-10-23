# Glossary

**User** — A registered person with a public profile. Created automatically at signup; may be an admin.

**Signup code** — A code a new person must present to create an account. Each code has a fixed number of seats. Matching ignores case and surrounding whitespace. Added and removed by admins.

**Seat** — One permitted signup under a signup code. A seat is taken the moment an account is created with that code. Existing users predate the system and need no code.

**Spook** — A photo post by one user, optionally tagging other users.

**Tag** — The link between a spook and a tagged user. A spook may have no tags.

**Badge** — A reward a user earns when they meet that badge's condition: a click count threshold, a Spookify score of 100, a spook posted, being tagged in 10 spooks, or 10 right swipes on a single song they added. Each badge has a badge message shown to the user. Once earned it is kept even if the condition later stops holding; an admin resetting clicks removes only the click badge. Tags on a user's own spooks do not count towards being tagged.

**Badge message** — The text attached to a badge, visible only to its owner on the battle pass while the badge is held. Locked badges show only their goal and progress.

**Regular badge** — One of the nine built-in badges with a condition: clicks, Spookify score, spooks posted, being tagged, right swipes on one song, karaoke songs performed (3), Spookify Tinder swipes (50), FMK rounds finished (25) and casting a ballot. Not custom badges or winner badges.

**Winner winner** — The final badge, with the message "chicken dinner". Earned when a user holds every regular badge, that is, the full regular XP. Custom badges and winner badges never count towards it.

**Custom badge** — A badge an admin gives with its own text. The admin must set its points (default 10); the points belong to the text and stay editable.

**XP** — A user's total badge points: the sum of the current points of every badge they hold, regular, Winner winner, custom and winner badges alike. Points are awarded only on unlock. It is always derived, so an admin changing a badge's points changes everyone's XP at once.

**Badge points** — The XP one badge is worth. Admins edit them per badge; defaults are 100, 200 or 300 for regular badges and 500 for Winner winner. A vote carries its own winner points (default 10, set by the admin) for its winner badge.

**Battle pass** — The view showing every badge as a node on one XP track, ordered from cheapest to most valuable with Winner winner last. Earned nodes light up, open ones show progress, and a Collected strip shows custom and winner badges. A dot on its tab marks newly earned badges until the user opens it. Read-only; it never awards anything.

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

**Add song to game** — The place where a user searches Spotify by title or artist and adds a song to the pool. Formerly called Spookify Source.

**Pool** — The shared set of songs added through Add song to game. A song is in the pool once; whoever added it first stays its submitter.

**Submitter** — The user who added a song to the pool.

**Spookify Tinder** — The place where a user is shown a random pool song and swipes on it. A user never meets their own songs.

**Swipe** — One user's verdict on one pool song. Swiping right means they like the song, swiping left means they do not. Each user swipes a given song once, and the swipe cannot be changed. Unrelated to a ballot: a swipe is attributed to its swiper, never anonymous.

**Spookify score** — A user's reward total from Spookify: the sum of their Add song to game score, Spookify Tinder score and Spookify FMK score. Separate from the click count; reaching a score of 100 earns a badge.

**Add song to game score** — Points a submitter earns when other users interact with their songs in the other games, never from adding a song itself. A swipe right on their song is worth one point, a swipe left nothing, a sing choice one point and a listen choice half a point. The same points add up per song for the **Song leaderboard**, which ranks songs, shows their submitter and can be filtered to one user's songs.

**Spookify Tinder score** — Points a user earns by swiping: a full point per swipe right and half a point per swipe left.

**Spookify FMK score** — Points a user earns by playing FMKs: one point per round.

**Spookify FMK** — The place where a user is shown three pool songs of the same tier and gives each a different choice. A user never meets their own songs. Unrelated to Spookify Tinder: an FMK choice is not a swipe.

**FMK** — One round of three songs and the three choices made on them: sing, listen, delete.

**Sing / Listen / Delete** — The three choices in an FMK. Sing adds two points to the song's tier for that user, listen adds one, and delete removes the song from that user's future FMKs. Sing earns the song's submitter a full point and listen half a point; delete earns them nothing.

**Tier** — A user's own points total for one pool song, built up from their sing and listen choices. Every song starts at tier zero. Two songs only meet in an FMK when they share a tier for that user, and never meet again once they have shared an FMK.

**Current tier** — The lowest tier for which a user still has three songs that can be matched. Every FMK is drawn from it. Shown to the user next to their max tier.

**Max tier** — The highest tier any of a user's songs has reached.

**Leaderboard** — A bar graph ranking users, showing the top ten plus the viewer's own row. The clicker view ranks by click count; Add song to game, Spookify Tinder and Spookify FMK each rank by their own score.

**Route** — The URL path of a view: `/admin`, `/clicker`, `/spooks`, `/karaoke`, `/poll`, `/battlepass`, `/users`, `/profile`, `/spookify/add`, `/spookify/tinder`, `/spookify/fmk`. Unknown paths go to `/clicker`. The host must serve `index.html` for unknown paths.
