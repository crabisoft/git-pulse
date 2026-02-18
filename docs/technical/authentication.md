# Accounts and access

Four levels, and every route carries one:

| Level | Who passes |
|---|---|
| `anonymous` | anyone — signing in, signing out, reading the session state |
| `viewer` | any account, plus anonymous visitors while the dashboard is public |
| `account` | any account, and only an account — whatever the dashboard is open to |
| `admin` | admins only |

`AuthGuard` is registered globally and **defaults to `admin`**: a route that
says nothing is closed, so a new endpoint is protected by existing rather than
by someone remembering to guard it. Dashboard, DORA, metrics, release notes and
the two reads the front needs to draw them — `GET /sources`, `GET /settings` —
are marked `@Viewer()`. Everything else, the whole configuration surface
included, stays with the admins.

Two routes sit at `account` rather than at either end. **Rewriting release
notes** spends the install's model budget, which a public dashboard would
otherwise open to anyone; and **listing the model providers** has to follow it,
since a caller allowed to rewrite has to be allowed to choose what rewrites.
That list names providers and models and says whether a key is on file — never
the key. Declaring, editing and deleting a provider stay with the admins.

**Public dashboard** (`Settings → General`) is what `viewer` reads. On, the
dashboard and DORA are readable without an account, which is the default and
what an upgraded install keeps. Off, the whole application asks for one. The
settings never depended on it: they are `admin` either way.

Roles are coarse on purpose — `admin` configures the install, `user` only reads
what the public setting would otherwise open to everyone. Accounts are handed
out from `Settings → Accounts`; there is no self-registration. What an account
can do about *itself* is `My account`, behind its name in the topbar: its
display name, and its password against the current one. Not its address and not
its role — those are how an admin identifies it.

**First run.** An install with no account at all offers to create the first
admin, and only then: the bootstrap closes for good as soon as one exists. The
same screen becomes the sign-in form afterwards.

**Sessions** live in the database rather than in a signed token, so signing out,
deleting an account or taking away its role takes effect at once instead of
whenever a token happens to expire. The cookie is `httpOnly` and `sameSite=lax`,
holds a random 32-byte value, and only its SHA-256 is stored — a leaked table
hands out nothing. Passwords are scrypt-hashed with a per-account salt.
`secure` follows `WEB_ORIGIN` being HTTPS, which `SESSION_COOKIE_SECURE`
overrides for a proxy that terminates TLS elsewhere.

The 12-hour lifetime is an **idle** one: a session still being used is pushed
back once past its halfway point, cookie included, so it expires after half a
day of doing nothing rather than half a day after signing in. Changing a
password ends that account's other sessions and keeps the one that changed it.

**Failed sign-ins are counted**, per address and per calling IP, over a 15-minute
window: 10 failures on one address or 30 from one IP close sign-in for the rest
of it, and a successful one clears the count. The counters are held in the API
process — a store on the sign-in path is a store whose outage takes sign-in
down with it, and the API runs as a single container here. Behind a reverse
proxy, set `TRUST_PROXY` (Express's own value: `1` for one hop) or every caller
is counted as the proxy.

**Forgotten password.** An admin issues a link from `Settings → Accounts` and
hands it over by whatever channel they already have — nothing is sent from here,
which is what lets the feature exist without this install having to know how to
send mail. The link is hashed like a session, lives an hour, and works once:
using it sets the password, closes every session of that account and cancels any
other outstanding link for it. Issuing a new one cancels the previous one too,
so the newest link is always the only one that works. The token is readable in
the answer that mints it and nowhere else — an admin who loses it issues another.

> Should non-admin accounts ever need this without an admin in reach, the token
> model does not change: only the delivery does, and that is where SMTP, a queued
> send and an enumeration-safe request route would come in.

**Locked out?** No admin able to sign in is the one state the UI cannot repair,
so there is a way back:

```sh
make set-password email=you@example.com password='…'   # add mode=prod for the prod stack
```

It resets that account's password and closes its open sessions — and creates the
account as an admin if the address is unknown, which covers the last admin being
deleted. The password goes through the shell, so change it again from `My
account` afterwards.
