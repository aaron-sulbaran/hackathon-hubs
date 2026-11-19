# Security

## Reporting a vulnerability

Report it privately through GitHub: open the repo's **Security** tab and choose **Report a vulnerability**, or go straight to https://github.com/aaron-sulbaran/hackathon-hubs/security/advisories/new. Please do not open a public issue for a security problem.

Include what you found, how to reproduce it, and what an attacker could do with it. You will get a reply on the advisory. Only the latest version on `main` gets fixes.

## The security model, in plain words

A hub is built for a small team that trusts each other, for one weekend. It keeps strangers out. It does not protect teammates from each other.

### The unlock link

- The board has one shared secret, `HUB_KEY`, set on the deployment. Setup makes a random one. The unlock link is the board's address plus `/unlock?key=<HUB_KEY>`.
- Opening the link checks the key with a constant-time compare and sets a cookie, `hub_session`. The cookie holds an expiry 14 days out, signed with HMAC-SHA256 under `HUB_KEY`. It is HttpOnly, SameSite=Lax, and Secure in production.
- Every request needs the cookie: pages, the API, the icon, and Next's own scripts and styles. The server checks the signature and refuses the cookie once its expiry has passed, even if a browser still holds it. Without a valid cookie the answer is a plain 404 with `X-Robots-Tag: noindex, nofollow`. The board never redirects a stranger, so it never reveals what lives at the address, not even that it is a Next.js app.
- The check runs twice: once in the proxy in front of every request, and again in the page layout and in each route handler that serves team data. The board stays closed even if the proxy does not run.
- In production with no `HUB_KEY` set, every request gets the 404, the unlock link included. The board fails closed. In local development with no key, it is open.
- Everyone gets the same kind of cookie. It proves "this device opened the link", not who is holding it.

### Who you are on the board

Identity is self-declared. When you tap your name on the board, the board believes you. A write names its author, and the server checks only that the name is an id in `team.json`. Anyone with the unlock link can post as any teammate.

Your agent's commands go through git, not the board. Who can push to the hub repo is decided by GitHub: the people the owner invited.

### Writes from the board

The board has one write endpoint. Before it stores anything it:

1. Requires a valid unlock cookie.
2. Refuses cross-site requests (`Sec-Fetch-Site`, or else `Origin` compared with the host).
3. Requires a JSON body.
4. Rate limits each address to 30 writes a minute.
5. Validates the event and checks its author against `team.json`. If the team list is empty or could not be loaded, the write is refused.

Then it stores one new file under `events/` through the GitHub contents API. It never edits or deletes an existing file.

### The token

The board reads and writes the hub repo with one fine-grained GitHub token, limited to the hub repo, with **Contents: read and write** and nothing else. `./hub setup --tokens` saves it as both `HUB_READ_TOKEN` and `HUB_WRITE_TOKEN`.

A leaked token lets someone change any file in that one repo, not just add events. It reaches nothing else. Since both variables hold the same token, a leak of either one is a write leak.

For least privilege, `./hub setup --tokens --separate-tokens` sets two tokens instead: a **Contents: read-only** token as `HUB_READ_TOKEN`, and the read-and-write token as `HUB_WRITE_TOKEN`.

With no token set, the board shows the files bundled at its last deploy and turns its write controls off.

## Known limits

- **The key travels in a URL.** The unlock link can end up in browser history, chat logs, and the logs of anything in between. Share it only in a private channel.
- **No per-person revocation.** To remove one person, run `./hub setup --new-key`. That signs everyone out, and you send the new link to everyone else.
- **The rate limit is per instance and in memory.** Each serverless instance counts on its own and forgets on restart. It slows a runaway script down; it does not stop a determined one.
- **Hub content is input to your agents.** Every agent reads the events and the knowledge pages. Anyone who can write to the hub can put text there that an agent might follow. Keep the repo private and the link inside the team.
- **Never commit a secret.** The hub is a git repo and its history keeps everything. Tokens belong in the deployment's environment variables and in your agent's secret settings, never in a file.
