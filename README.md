# MaatMan

Checks, per project allocation, whether a Profource consultant earns at least
what they would earn under the client's CAO (*gelijkwaardig belonen*). Under
the WTTA, paying below that level puts the labour-provider admission at risk.
This replaces the `MaatMan analyse Profource` Excel workbook.

Colleagues sign in with the **same account** they use for Marktmonitor and
[Leadbeheer](https://github.com/mathieu-butenaerts/leadbeheer) (same Supabase
project). Styling matches those apps.

## Who can see what

The data lives in the shared Supabase project, in the `maatman_*` tables, and
everyone with access works on the same dataset. Access uses the page
permissions from Marktmonitor's admin panel (`page_access.sql` in the
Scrappingtool-v2 repo). There is one permission per page:

| Page key               | Page         | Data                     |
|------------------------|--------------|--------------------------|
| `maatman.dashboard`    | Overzicht    | read                     |
| `maatman.calculator`   | Calculator   | read                     |
| `maatman.instellingen` | Instellingen | read and change          |

Admins can always open everything. The database enforces this with
row-level security: someone without one of these permissions gets nothing
back, even with a hand-made API request, and only `maatman.instellingen` can
write. New users do **not** get MaatMan by default; an admin switches it on
per person. Tabs for pages a user can't open are hidden.

Personal view choices (reference date, incl./excl. pension, show ended
allocations) stay in the user's own browser.
## Pages

- **Overzicht** (`index.html`): every current consultant × project
  combination, with totals and a table per project, worst first. Click a row
  for the full calculation. "Alle allocaties" also shows ended ones.
- **Calculator** (`calculator.html`): pick any consultant and any project,
  including combinations that don't exist yet, and change values under
  *Wat als* (assignment %, scale, salary, lease car…). Two tables rank all
  projects for the chosen consultant and all consultants for the chosen
  project. Nothing here is saved.
- **Instellingen** (`instellingen.html`): import the workbook; add, edit and
  remove consultants, projects and allocations; set the reference date, the
  method and every assumption.

The data is split into consultants (salary, job level, part-time %, lease
car), projects (client, CAO, scale) and allocations (which consultant is on
which project, assignment %, dates). An allocation can override its
project's scale.

## How to use it

1. Sign in, go to **Instellingen**, click **Workbook importeren** and pick the
   MaatMan workbook (`.xlsx`). The app reads these tabs:
   - `Oracle Projecten-Allocaties`: one row per consultant per project.
   - `AFAS Medewerkers`: job level and end of employment.
   - `AFAS Mdw-Looncomponent`: salary and holiday pay. The app takes the
     latest period up to the *peildatum* (reference date), so the workbook's
     own pivot tables don't have to be refreshed.
   - `AFAS Mdw-Auto`: lease cars that run on the reference date.
   - `SUGB-Salarischalen`: the CAO scales. If this tab is missing, the
     scales built into `cao-schalen.js` are used.
2. Check the results on **Overzicht** and try other combinations in the
   **Calculator**.

Importing replaces all consultants, projects and allocations in the database,
for everyone, in one transaction. The workbook's CAO scales are stored too
and replace the built-in ones for everyone. Edits on Instellingen are saved
immediately and show up live in other open tabs.

## Method

The calculation follows the columns of the original Excel:

- **At the client:** CAO scale minimum plus 13% of the scale range (40-hour
  basis), plus holiday pay, year-end bonus, IKB, leave above the legal minimum,
  commuting (€/km × 40 km × 2 × 10 days) and home-working allowance from the
  CAO.
- **At Profource:** full-time salary and holiday pay from AFAS, a bonus of
  half a month's salary per year, lease car or mobility budget (plus 35% of an
  unused budget), 6 extra leave days, and fixed amounts for home working (€24),
  internet (€15), miscellaneous (€79), team manager (€232.50) and training per
  job level.
- **Pension:** when the client's employer premium is worth more than
  Profource's (15.9% over salary, holiday pay and bonus minus €1,601.60), the
  difference × 0.853 is subtracted.
- The difference is weighted by part-time % and assignment %.

Two methods:

- **Zoals Excel** reproduces the workbook exactly.
- **Strikt** removes the one-sided comparisons: extra leave is counted against
  the CAO's own working week instead of 40 hours, team manager and training
  costs are left out, and the lease car is counted excluding VAT.

Every assumption can be changed under *Aannames en methode*. The CAO version
is picked from the reference date (the highest version whose dates include
it, otherwise the one marked active) and can be overridden per allocation.

This is a screening tool. Have legal confirm the method before acting on the
results.

## Files

- `index.html`, `calculator.html`, `instellingen.html`: the three pages.
- `app.js`: shared by all pages: reading and writing the database, the
  calculation, the workbook import, and the sign-in and page-access check.
- `style.css`: shared styling, matching Leadbeheer.
- `supabase/schema.sql`: the MaatMan tables, access rules, page registration
  and the import function. Run once.
- `cao-schalen.js`: built-in CAO scales from the `SUGB-Salarischalen` tab of
  the workbook of 22-07-2026, used until a workbook with scales is imported.
- `login.html` / `register.html` / `auth.js`: shared with Marktmonitor (same
  Supabase project, same accounts). `auth.js` is Marktmonitor's version with
  `requirePage()`.
- `.github/workflows/deploy-pages.yml`: publishes to GitHub Pages on every
  push to `main`.

## One-time setup

1. Make sure `supabase/page_access.sql` from the Scrappingtool-v2 repo has
   been run (it creates the page permissions).
2. In the Supabase SQL editor, run [`supabase/schema.sql`](supabase/schema.sql).
   It is safe to run again.
3. In Marktmonitor's admin panel, give the right people the MaatMan pages.
   Only `maatman.instellingen` can import and edit.
4. Someone with Instellingen imports the workbook. Data that someone entered in
   an earlier, browser-only version of MaatMan can be copied over once with
   "Gegevens uit deze browser overzetten" on Instellingen.

GitHub Pages: in this repo's Settings > Pages, **Source** is "GitHub Actions";
the workflow deploys on every push to `main`, at
`https://mathieu-butenaerts.github.io/maatman/`.
