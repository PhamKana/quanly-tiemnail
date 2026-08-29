# Backend modules

This directory is the extraction target for the legacy routes currently in `../app.ts`.

Recommended extraction order:

1. auth
2. notifications
3. backups
4. customers and catalog
5. appointments
6. payroll
7. payments

Payment extraction comes after characterization tests because wallet and settlement operations carry the highest data risk.

