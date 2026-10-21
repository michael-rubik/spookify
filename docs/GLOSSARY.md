# Glossary

**User** — A registered person with a public profile. Created automatically at signup; may be an admin.

**Spook** — A photo post by one user, optionally tagging other users.

**Tag** — The link between a spook and a tagged user. A spook may have no tags.

**Badge** — A reward a user earns when their click count crosses a threshold. Each badge has a badge message shown to the user. Once earned it is kept until an admin resets clicks.

**Badge message** — The text attached to a badge, visible only to its owner on the clicker view while the badge is held.

**Deletion pending** — Marker (`users.deletion_pending_at`) on an account whose permanent deletion has started. The account is blocked from writes and sign-in until deletion finishes. If cleanup fails, it stays pending as the retry target.

**Permanent account deletion** — Admin-only removal of another user: the account is marked pending, their avatar and spook images are removed from Storage, then the Auth account and profile are deleted. Their spooks and karaoke songs are removed, and their tags are removed from other authors' spooks. The same email may later register as a fresh, non-admin user with no restored data.
