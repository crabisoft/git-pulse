# Nobody can sign in

The one state the interface cannot repair: no admin account can reach it. The
last one was deleted, its password is gone, or the sign-in throttle has closed
the door.

## Which of the three is it?

```bash
$C logs back | tail -30
```

- Sign-in answering **429** — the throttle. Wait it out or read below.
- Sign-in answering **401** with the right password — the account is gone, or
  its role was taken away.
- The sign-in form offering to **create the first admin** — there is no account
  at all, so create one and stop here.

## Resetting a password, or recreating an admin

```bash
$C exec back node back/dist/scripts/set-password.js you@example.com 'a-long-password'
```

From a clone, the same thing with a target: `make set-password
email=you@example.com password='…'` (add `mode=prod` for the production stack).

It sets that account's password and closes its open sessions. **An address it
does not know is created as an admin**, which covers the last admin having been
deleted. The password must be at least 10 characters.

The password goes through your shell and lands in its history: change it again
from **My account** once you are back in.

## The throttle

Failed sign-ins are counted over a 15-minute window: 10 failures on one address,
or 30 from one calling IP, close sign-in for the rest of it. A successful
sign-in clears the count.

The counters are held in the API process, not in a store — so restarting the API
clears them:

```bash
$C restart back
```

That is a legitimate way out of having locked yourself out, and it is also why
it is worth knowing that anyone who can restart the API can clear the throttle.

**If every caller is being counted as one**, the API is behind a proxy without
`TRUST_PROXY` set: it sees the proxy's address for every request, so thirty
failures from anywhere close sign-in for everybody. Set it to the number of
proxy hops in front — `1` for the bundled nginx — and restart. Setting it when
nothing proxies the API is the opposite mistake: a caller then chooses its own
address through `X-Forwarded-For` and the throttle stops meaning anything.

## What not to do

- **Do not edit the `User` table by hand.** The password column holds a scrypt
  hash as `salt:key` in hex; anything else is an account that can never sign in,
  and the script above exists exactly so nobody has to know that.
- **Do not delete the sessions table** to "reset" access. It signs everybody out
  and changes nothing about who can sign back in.
