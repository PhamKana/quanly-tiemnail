# Security baseline

## Secrets and backups

- Configure runtime secrets in `.env` or the hosting provider's secret store.
- Never commit `.env` files, VAPID private keys, webhook keys, passwords, or JSON backups.
- Rotate a credential immediately if it has appeared in Git history.

## Known migration requirement

The browser currently reads and writes several Firestore collections directly.
The existing Firestore rules are therefore permissive and are **not suitable for
a public production deployment**. Before exposing the app publicly, migrate the
remaining browser Firestore operations behind authenticated API routes (or add
Firebase Authentication and least-privilege rules), then deny anonymous access.

Staff and admin passwords are also legacy plaintext Firestore fields. Migrate
them to a password hash or a managed identity provider before production use.

## Production checklist

1. Set `AUTH_SESSION_SECRET`, admin credentials, SePay and VAPID secrets.
2. Remove production backups from Git history and rotate exposed credentials.
3. Close Firestore rules after the browser-to-API migration.
4. Run `npm ci`, `npm run lint`, `npm run test:salary`, `npm run build`, and
   `npm audit --audit-level=high`.
