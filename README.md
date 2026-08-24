# BullShark Connected

Operations portal for BullShark Contracting. The application provides separate
Admin, Client, and Subcontractor workspaces for managing projects, jobs,
schedules, stage progress, contractor assignments, and e-signature contracts.

## Local development

1. Copy `.env.example` to `.env`.
2. Run `pnpm install`.
3. Run `pnpm dev`.
4. Open `http://localhost:5173`.

The API runs on `http://localhost:8787`. Development data is stored in
`data/portal.json` and is created from the seed automatically.

## Contract and e-signature workflow

Assigning a subcontractor to a job automatically creates a PDF contract using
the active template and the contract number/price entered in the assignment
dialog. Admins can edit the contract details and the reusable template in the
management dashboard.

By default, `ESIGN_PROVIDER=demo` exercises the complete workflow locally and
marks the envelope as ready for signature. Set `ESIGN_PROVIDER=docusign` and
the DocuSign variables from `.env.example` to send live envelopes. The RSA
private key is read only on the server and is never exposed through Settings or
the browser.

## Commands

- `pnpm dev` — run the Vite UI and Express API together
- `pnpm test` — run API and UI unit tests
- `pnpm build` — type-check and create the production client/server bundles
- `pnpm start` — serve the production build

## Production notes

- Put the API behind HTTPS and an identity provider. The included role preview
  header makes the three workspaces testable locally; the API still enforces
  role checks on every mutation.
- Mount `data/` and `storage/contracts/` on persistent volumes, or replace the
  JSON repository with the production database adapter.
- DocuSign JWT consent must be granted once for the integration user before
  envelopes can be sent.
