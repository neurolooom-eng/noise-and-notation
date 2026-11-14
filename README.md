# Noise & Notation — Course Session Feedback

A short, confidential, mobile-first feedback app for course sessions. It implements the
*Course Session Feedback App — Development Specification*, with one change: it uses **Supabase**
(Postgres) instead of a Google Sheet and **GitHub Pages** instead of Apps Script.

| Spec (Google)          | This app                                                    |
|------------------------|-------------------------------------------------------------|
| Apps Script web app    | React + Vite static site on **GitHub Pages**                |
| Google Sheet tabs      | Supabase tables: `settings`, `cohorts`, `sessions`, `questions`, `participants`, `responses` |
| Summary tab            | `session_summary` / `cohort_summary` views + **Admin → Summary** |
| Owner edits the Sheet  | **Admin console** (`#/admin`) or the Supabase Table Editor  |
| Deployment             | **GitHub Actions** → Pages on every push to `main`          |

- Participant link: `https://<github-user>.github.io/noise-and-notation/`
- Owner console: `https://<github-user>.github.io/noise-and-notation/#/admin`

## How privacy is enforced

- The browser only ever holds the Supabase **anon/publishable** key. The anon role has **no access to any
  table**. Participants use five database functions (`get_app_config`, `check_participant`,
  `register_participant`, `list_open_sessions`, `submit_feedback`), and none of them return names, contacts
  or participant codes.
- `responses` stores only the internal code (`P001`, `P002`, …). Reports and summary views never include
  names or contacts.
- Averages appear only when a session has at least *N* responses (`min_responses_for_summary`, default 5).
- Only e-mails listed in `public.admins` can read or edit data after signing in.

Business rules from the spec are enforced **in the database**, so the UI can't bypass them. These are:
one response per participant per session (unique constraint), manual open/close only,
mobile-or-email validation, a question-set version bump on every question edit (each response stores
its version), and merging of duplicate participants (`merge_participants`).

## One-time setup

### 1. Create the database objects
In the Supabase dashboard, open **SQL Editor** and run
[`supabase/migrations/0001_feedback_app.sql`](supabase/migrations/0001_feedback_app.sql). You can also run [`supabase/seed_sample.sql`](supabase/seed_sample.sql) to add sample
courses and sessions.

Then run the other files in `supabase/migrations/` in order (`0002_…`, `0003_…`). Each file is applied once;
applied files are recorded in `public.schema_migrations`.

*Optional, automated:* add a repository secret `SUPABASE_DB_URL` (Supabase → **Connect** → Session pooler
connection string, with your DB password). The **Apply Supabase migrations** workflow then applies any new migration files
whenever `supabase/migrations/**` changes on `main`, or when you start it manually.

### 2. Create the owner (admin) login
1. Supabase → **Authentication → Users → Add user**. Enter your e-mail and a password, and tick
   *Auto confirm*.
2. In the SQL Editor, run
   `insert into public.admins (email) values (lower('you@example.com'));`
3. *Recommended:* under **Authentication → Sign In / Providers**, turn off "Allow new users to sign up".
   Strangers could not see any data even if they signed up, but there is no need to allow it.

### 3. Configure GitHub
1. **Settings → Secrets and variables → Actions → New repository secret**:
   `SUPABASE_ANON_KEY` = the anon/publishable key from Supabase → **Project Settings → API Keys**.
   This key is public by design; RLS and the functions above protect the data.
   **Never** use the `service_role` / secret key here.
2. *Optional:* a repository **variable** `SUPABASE_URL`. If it is not set, the workflow uses
   `https://zyombcdqbhslukoajxml.supabase.co`.
3. **Settings → Pages → Build and deployment → Source: GitHub Actions**.
4. Push to `main`, or run **Build & deploy to GitHub Pages** from the Actions tab. The workflow prints
   the site URL when it finishes.

> GitHub Pages on a **private** repository needs a paid GitHub plan. On a free plan, the repository must be
> public. The repository contains no secrets: the key is injected by the workflow at build time.

### 4. Link from noiseandnotation.com
Add a button or link to the Pages URL, e.g.
`<a href="https://<github-user>.github.io/noise-and-notation/">Session feedback</a>`. You can also point a
subdomain (e.g. `feedback.noiseandnotation.com`) at it under **Settings → Pages → Custom domain**. The
build uses relative paths, so it works either way.

## Routine use (no code changes)
In **Admin** (`#/admin`):
- **Feedback & insights** (opens first): filters (course, session, period) scope everything; headline
  numbers; rule-based insights (strongest/weakest question, items needing attention, session trend,
  lowest-rated session, comments); an agree/disagree chart per question; average-by-session trend; and
  the full feedback table. Values below the minimum responses are never shown.
- **Tables** everywhere: resize columns, drag to reorder, choose columns, save named views (per admin),
  Comfortable/Compact density, sort, and export to **CSV or Excel**. See `docs/design-system.md` or the
  **Design** tab for the table, form and chart defaults.
- **Courses**: add a course/cohort. A repeat run of a course is a new cohort. Deactivate old ones.
- **Sessions**: add sessions, enter the topic shown to participants, and toggle **Open/Closed**.
- **Summary**: see per-session averages Q1–Q6, response counts and anonymous comments, compare across
  cohorts, and export a CSV.
- **Participants** (super admins only): code, name, contact (masked until you tick *Show contacts*),
  course, feedback given, last feedback, registered date; search and filter by course. Plain admins
  cannot read this list (enforced in the database).
- **Questions**: add new questions, edit them, reorder them (↑ ↓) or set them **inactive** (hidden from the
  form, answers kept). **Any** change creates a new version of that question automatically; every answer
  stores the version it was answered under, the summary shows each version as its own column, and
  **History** shows the exact wording of every version and who changed it. Questions that have answers
  can't be deleted, so set them inactive instead.
- **👁 View as participant** (super admins): opens the real participant screens in PREVIEW mode. It lists
  every course and session (including inactive and closed ones), lets you simulate a new or returning
  participant, and saves nothing.
- **Settings**: change the app title, privacy text, minimum responses, and merge duplicate participant
  codes.

To look up who a code belongs to (owner only), use Supabase → Table Editor → `participants`.

## Local development
```bash
cp .env.example .env.local   # fill in VITE_SUPABASE_ANON_KEY
npm install
npm run dev
```

## Known limitations
- As in the spec, there is no login for participants. Anyone who knows a participant's mobile number or
  email could submit as that person (once per session). `check_participant` also reveals whether a
  contact is registered, but nothing else.
- The public functions have no rate limiting of their own beyond Supabase's platform limits.
