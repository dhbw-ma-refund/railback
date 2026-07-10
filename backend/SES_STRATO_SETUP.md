# Strato domain → AWS SES (email sending) setup

Goal: refund emails send from **your Strato domain** (e.g. `noreply@<yourdomain>`)
via AWS SES in **eu-north-1**. This is independent of the Lambda-access question —
you can prepare the DNS side now.

## Split of work

- **Professor (AWS side):** verify the domain identity in SES (eu-north-1),
  enable **Easy DKIM**, and — for real recipients — request **production
  access** (move out of the SES sandbox). He gives you the DNS records SES
  generates.
- **You (Strato side):** add those DNS records in the Strato DNS panel.

You can't do the SES side yourself (no SES rights probed), so this doc is the
handoff: what to ask for, and what to paste into Strato once you get it.

## Step 1 — ask the prof to create the SES domain identity

Ask him to, in **SES → eu-north-1 → Verified identities → Create identity →
Domain**:
- enter your Strato domain (or a subdomain like `mail.<yourdomain>`),
- tick **Easy DKIM** (RSA 2048),
- optionally set a **custom MAIL FROM** subdomain (e.g. `bounce.<yourdomain>`)
  for better deliverability.

SES then outputs a set of DNS records. He sends you those. They look like:

- **3× CNAME** for DKIM: `<token>._domainkey.<yourdomain>` →
  `<token>.dkim.amazonses.com`
- (if custom MAIL FROM) **1× MX** + **1× TXT (SPF)** on the MAIL FROM subdomain
- Optionally a **TXT** for DMARC.

## Step 2 — add the records in Strato

Strato panel: **Domains → your domain → DNS settings (DNS-Verwaltung)**.

For each SES record, add a matching entry. Strato specifics that trip people up:

- **Host/Name field:** Strato often wants the name **without** the domain
  suffix. If SES says `abc123._domainkey.yourdomain.de`, enter
  `abc123._domainkey` as the host (Strato appends the domain). If a record is
  for the root, Strato uses `@` or an empty host.
- **CNAME value:** paste exactly as SES gives it, usually **with** a trailing
  dot in AWS docs — Strato normally wants it **without** the trailing dot. Drop
  the trailing `.` if Strato rejects it.
- **TTL:** leave default (Strato ~3600s is fine).
- **No conflicting MX:** if you also want inbound mail on this domain, keep the
  existing Strato MX; SES verification only needs the DKIM CNAMEs (different
  record type, no conflict). Only add an MX for the SES **MAIL FROM subdomain**,
  not the root, so your normal mailbox keeps working.

DNS propagation: minutes to a few hours. SES flips the identity to "Verified"
automatically once it sees the DKIM CNAMEs.

## Step 3 — SPF and DMARC (recommended, avoids spam folder)

- **SPF** (TXT on the sending domain/subdomain):
  `v=spf1 include:amazonses.com ~all`
  (if you already have an SPF TXT, merge — only one SPF record allowed:
  `v=spf1 include:amazonses.com include:<existing> ~all`)
- **DMARC** (TXT at `_dmarc.<yourdomain>`):
  `v=DMARC1; p=none; rua=mailto:you@<yourdomain>`
  (`p=none` = monitor only; tighten later.)

## Step 4 — sandbox check (blocks demo to arbitrary recipients)

New SES accounts are in **sandbox**: they can only send TO verified addresses.
For a demo to your own inboxes that's fine (verify those recipient addresses
too). To email arbitrary users, the prof must **request production access** in
the SES console (a short form, usually approved in <24h).

## Step 5 — the env vars the code needs (set on the Lambda later)

Once the domain is verified:
- `RAILBACK_SES_FROM_ADDRESS=noreply@<yourdomain>` — must be on the verified
  domain, or SES rejects the send. The code REQUIRES this (no fallback).
- `RAILBACK_SES_CONFIGURATION_SET=<name>` — optional. Only needed if the prof
  creates an SES Configuration Set wired to SNS for delivery/bounce events
  (that feeds the `email-webhook` flow). Leave unset if you're not wiring SNS
  — sending still works, you just don't get delivery callbacks.
- `RAILBACK_AWS_REGION=eu-north-1` (SES + everything else co-located).

## Verify it works (once verified + you can send)

```bash
export AWS_PROFILE=railback
aws ses get-identity-verification-attributes \
  --identities <yourdomain> --region eu-north-1     # → "Success"
# send a test (recipient must be verified if still in sandbox):
aws sesv2 send-email --region eu-north-1 \
  --from-email-address noreply@<yourdomain> \
  --destination ToAddresses=you@<yourdomain> \
  --content 'Simple={Subject={Data=RailBack SES test},Body={Text={Data=hello}}}'
```
