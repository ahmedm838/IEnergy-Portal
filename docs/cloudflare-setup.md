# Putting ienergyegypt.com behind Cloudflare

Written 21 Oct 2026. The reason for doing this is one measurement: the
origin server is in **Los Angeles** and the people using the site are in
**Giza**. Every navigation pays that round trip before a byte arrives.

| | TTFB |
|---|---|
| portal.ienergyegypt.com (origin, Los Angeles) | 673–1378 ms |
| The same files on GitHub Pages (a CDN) | 364 ms |

Nothing in the application can close that gap. A CDN can.

---

## Before you touch anything: what the DNS holds today

Moving to Cloudflare means moving **all** DNS for the domain, not just the
web records. Cloudflare's free plan requires full nameserver delegation.
Cloudflare's scan usually imports these correctly, but check every line
against this list before you change the nameservers — the import is a
best effort, not a guarantee.

**Current nameservers**

```
ns1.inmotionhosting.com
ns2.inmotionhosting.com
```

**A records** — all on `199.250.208.15`

```
ienergyegypt.com
www.ienergyegypt.com
portal.ienergyegypt.com
mail.ienergyegypt.com
webmail.ienergyegypt.com
cpanel.ienergyegypt.com
ftp.ienergyegypt.com
autodiscover.ienergyegypt.com
```

**MX** — mail does **not** go to the server directly; it goes through
MailChannels. Both records, equal preference 10:

```
10  mx1.mailchannels.net
10  mx2.mailchannels.net
```

**SPF** (TXT on the root)

```
v=spf1 ip4:23.235.219.107 include:relay.mailchannels.net +a +mx ~all
```

**DKIM** — a key exists at `default._domainkey`. Copy the whole value;
it is long and a truncated key fails silently, which looks like mail
being filtered for no reason.

**DMARC** — none. There is no `_dmarc` record today. Nothing to carry
over, and this change does not require you to add one.

---

## The three things that break sites doing this

### 1. Proxy only the web hostnames

In Cloudflare, the orange cloud means "proxied through Cloudflare".
Cloudflare proxies HTTP and HTTPS **only**. Mail, FTP and cPanel do not
run on those ports, so proxying them stops them working.

| Hostname | Setting |
|---|---|
| `ienergyegypt.com` | Proxied (orange) |
| `www` | Proxied (orange) |
| `portal` | Proxied (orange) |
| `mail` | **DNS only (grey)** |
| `webmail` | **DNS only (grey)** |
| `cpanel` | **DNS only (grey)** |
| `ftp` | **DNS only (grey)** |
| `autodiscover` | **DNS only (grey)** |

The FTP one matters here specifically: the GitHub deploy uploads over
FTPS to this host. Proxy it and every deploy fails.

### 2. SSL/TLS mode must be Full (strict)

Set it under SSL/TLS → Overview **before** the nameservers switch.

The origin has a valid Let's Encrypt certificate covering
`portal.ienergyegypt.com`, valid to 18 Jan 2027, so strict will work.

Do not use **Flexible**. Flexible makes Cloudflare talk to the origin
over plain HTTP, the `.htaccess` here redirects HTTP to HTTPS, and
Cloudflare follows that back to itself — an endless redirect, and the
site is simply down until the mode is changed.

### 3. SPF contains `+a`

`+a` means "whatever IP the domain's A record points at may send mail
for us". Once the root is proxied, that A record is a Cloudflare IP, so
`+a` stops authorising the real mail server and starts authorising
Cloudflare.

Outbound mail goes through MailChannels, which the `include:` already
covers, so this is unlikely to break anything. It is still a term that
will quietly mean something different afterwards. The safe move is to
add the server explicitly **before** switching:

```
v=spf1 ip4:23.235.219.107 ip4:199.250.208.15 include:relay.mailchannels.net +a +mx ~all
```

---

## Order of work

1. Create the Cloudflare account and add `ienergyegypt.com`. Let it scan.
2. **Check every record above is present**, and set the orange/grey
   clouds per the table. Add the `ip4:199.250.208.15` to SPF now.
3. Set SSL/TLS to **Full (strict)**.
4. Only now change the nameservers at the registrar to the two
   Cloudflare gives you. Propagation is usually under an hour.
5. Check, in this order: the website loads; **send and receive a test
   email**; webmail opens; cPanel opens; then run a deploy from GitHub
   Actions and confirm the FTPS upload still works.

Do this when you can watch it, not last thing before a weekend. Mail is
the part that hurts if it is wrong, and it is the part nobody notices
quickly.

---

## Afterwards: caching the HTML

Steps 1–5 put the static files on the edge and move the TLS handshake
close to Cairo. That alone is most of the win.

But Cloudflare obeys the origin's headers, and this site deliberately
sends HTML as `no-cache, must-revalidate` — which stopped people being
served a stale page for ten minutes after each deploy, back when it was
on GitHub Pages. So by default **the HTML document still comes from Los
Angeles on every navigation**, and only the assets come from the edge.

To remove that trip as well, add a Cache Rule:

- Rules → Cache Rules → Create
- Expression: `(http.host eq "portal.ienergyegypt.com")`
- Cache eligibility: **Eligible for cache**
- Edge TTL: **Ignore cache-control header and use this TTL** → 1 day
- Browser TTL: **Respect origin** ← leave this alone

That last line is the important one. The edge caches the page; browsers
still revalidate, exactly as they do now. The `no-cache` header keeps
doing its job for the people reading the site.

Then the edge copy needs invalidating when you deploy, which the
`Purge the Cloudflare cache` step in `.github/workflows/deploy-cpanel.yml`
already does. It skips itself until these two repository secrets exist:

- `CLOUDFLARE_API_TOKEN` — an API token, **not** a global API key.
  Create it with the template *Zone → Cache Purge → Purge*, scoped to
  this one zone.
- `CLOUDFLARE_ZONE_ID` — on the Cloudflare dashboard overview page for
  the domain, bottom right.

Add the cache rule and the secrets together. A cached HTML page with no
purge behind it is the stale-page problem again, with a longer memory.

---

## If it goes wrong

Change the nameservers back to `ns1.inmotionhosting.com` and
`ns2.inmotionhosting.com`. That is the whole rollback. Nothing in the
application changes for any of this, and nothing on the server changes.
