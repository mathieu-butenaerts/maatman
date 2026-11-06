# MaatMan

Checks, per project allocation, whether a Profource consultant earns at least
what they would earn under the client's CAO (*gelijkwaardig belonen*). Under
the WTTA, paying below that level puts the labour-provider admission at risk.
This replaces the `MaatMan analyse Profource` Excel workbook.

Colleagues sign in with the **same account** they use for Marktmonitor and
[Leadbeheer](https://github.com/mathieu-butenaerts/leadbeheer) (same Supabase
project). Styling matches those apps.

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

**Imported data stays in the browser.** It is kept in that browser's
`localStorage` and is never sent to Supabase or anywhere else. Each colleague
imports the workbook themselves. Nothing with salaries belongs in this repo:
the example rows on first load are fictional.

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
- `app.js`: shared by all pages: stored data, the calculation, the workbook
  import and the sign-in check. Data from the first, single-page version
  (`maatman-v1` in localStorage) is converted automatically.
- `style.css`: shared styling, matching Leadbeheer.
- `cao-schalen.js`: CAO scales taken from the `SUGB-Salarischalen` tab of the
  workbook of 22-07-2026. Importing a newer workbook overrides them in the
  browser; to update the built-in copy, replace this file.
- `login.html` / `register.html` / `auth.js`: copied from Leadbeheer, pointing
  at the same Supabase project, so the same accounts work.
- `.github/workflows/deploy-pages.yml`: publishes to GitHub Pages on every
  push to `main`.

## One-time setup

In this repo's Settings > Pages, set **Source** to "GitHub Actions". The
workflow then deploys on every push to `main`, at
`https://mathieu-butenaerts.github.io/maatman/`. No database setup is needed:
the app only uses Supabase for signing in.

Note: as with the other apps, the sign-in check runs in the browser. Anyone
can still download the page's files (including `cao-schalen.js`, which holds
only public CAO scale data) from GitHub Pages or the repo. Salary data is
safe because it never leaves the user's browser.
