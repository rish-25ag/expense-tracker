# Expense Tracker

A personal expense tracker for Android and iOS, built with React Native + Expo.
Amounts are in Indian Rupees (₹) with Indian digit grouping (₹1,23,456).

- **Expenses**: add, edit and delete expenses with an amount, category, note and date, grouped by day for each month.
- **Insights**: spending by category and a 6-month trend, plus a comparison with last month and your monthly average.
- **Budgets**: a monthly limit per category, with a progress bar and a warning when an expense takes you past 80% or over the limit.
- **Split**: split a bill with friends added by name (equally or by custom amounts), track who owes whom, settle up fully or partly, and share a reminder on WhatsApp or anywhere else. Your friends don't need the app.
- **Statement PDF import**: pick a bank or credit card statement PDF (password-protected ones too). AI reads the transactions, and you review the debits (category, untick transfers or duplicates) before adding them.
- **CSV**: export everything to CSV, or import from this app's CSV or a bank statement.
- **Offline-first + cloud backup**: data lives in SQLite on the phone, so the app works without internet. Sign in and it syncs with your own Supabase project, so nothing is lost if you change phones.

Split expenses count only **your share** in Insights and Budgets.

## Run it on your phone

You need [Node.js](https://nodejs.org) 20 or newer and the **Expo Go** app ([Android](https://play.google.com/store/apps/details?id=host.exp.exponent) / [iOS](https://apps.apple.com/app/expo-go/id982107779)).

```bash
git clone https://github.com/rish-25ag/expense-tracker.git
cd expense-tracker
npm install
npx expo start
```

Scan the QR code with Expo Go (Android) or the Camera app (iOS). Your phone and computer must be on the same Wi-Fi; if they can't be, run `npx expo start --tunnel`.

Without a `.env` file the app runs in **offline mode**: everything works, but data stays on that phone.

## Set up Supabase (cloud backup & sync)

1. Create a free account and project at [supabase.com](https://supabase.com).
2. In the project, open **SQL Editor → New query**, paste the whole of [`supabase/schema.sql`](supabase/schema.sql) and click **Run**. It creates the tables, row-level security (each user sees only their own rows) and the sync trigger. It is safe to run again.
3. Open **Project Settings → API** and copy the **Project URL** and the **anon public** key.
4. Copy the example env file and paste the values in:

   ```bash
   cp .env.example .env
   ```

5. Restart `npx expo start`, open **Settings → Sign in or create account** in the app, and create your account.

By default Supabase asks new users to confirm their email. Click the link in the email, then sign in. To skip that for a personal app, turn off **Confirm email** in the Email provider settings under **Authentication**.

The anon key is designed to be used in apps. Your data is protected by the row-level security policies in `schema.sql`. Keep `.env` out of git anyway; it's already in `.gitignore`.

### How sync works

- Every change is saved to SQLite first, then synced about 3 seconds later, when you open the app, and when you tap **Sync now**.
- If the same item was edited on two devices, the most recent edit wins (on the phone and on the server).
- Deletes sync too: rows are marked deleted rather than removed.
- Signing out removes the data from that phone. It comes back from the cloud when you sign in again. If any changes haven't synced yet, the app warns you first.

## Statement PDF import (AI)

**Settings → Import bank statement (PDF)** reads a statement with Claude, Anthropic's AI model. The PDF goes to a Supabase Edge Function (`supabase/functions/parse-statement`) in your own Supabase project, which:

1. unlocks the PDF with the password you type (most Indian bank statements have one),
2. extracts the text, keeping each amount under its column (Withdrawal/Deposit, Debit/Credit),
3. sends the text to the Claude API, which returns each transaction's date, description, amount, debit/credit, whether it is a transfer, and a category from your list.

The app then shows the debits for review. Credits (salary, refunds, payments received) are skipped. Card bill payments, transfers between your own accounts and investments start unticked, as do rows that match an expense you already have (same date and amount). Nothing is added until you tap **Add**.

Your Anthropic API key stays on the server, never in the app. The function serves only the emails you list in `ALLOWED_EMAILS`, so nobody else who signs up to your Supabase project can spend your API credit.

### Set it up (once)

You need the Supabase project from "Set up Supabase" above, and an Anthropic API key.

1. **Get an API key:** sign up at [console.anthropic.com](https://console.anthropic.com), add a payment method or credits, and create a key under **API Keys**. Usage is pay-as-you-go. With the default model, a typical 2–5 page statement costs roughly ₹5–25, since the statement text goes in and every transaction comes back out.
2. **Log in to Supabase from this folder and link the project.** The project ref is in your Supabase project URL, `https://<project-ref>.supabase.co`.

   ```bash
   npx supabase login
   ```

   ```bash
   npx supabase link --project-ref <project-ref>
   ```

3. **Store the secrets on the server.** Type these into your own terminal; never commit the key.

   ```bash
   npx supabase secrets set ANTHROPIC_API_KEY=sk-ant-... ALLOWED_EMAILS=you@example.com
   ```

   `ALLOWED_EMAILS` is the email you sign in to the app with. Separate several with commas.
4. **Deploy the function** (Docker is not needed):

   ```bash
   npx supabase functions deploy parse-statement --use-api
   ```

5. In the app, sign in, then go to **Settings → Import bank statement (PDF)**.

To redeploy after changing the function, run step 4 again.

### Model and cost

The function uses `claude-opus-5-5`, Anthropic's current default model, for accurate extraction. If a request is declined by Claude's safety checks, the API automatically retries it on a fallback model (`fallbacks: "default"` in `core.ts`). To trade some accuracy for a much lower cost, set a different model and redeploy:

```bash
npx supabase secrets set STATEMENT_MODEL=claude-haiku-5-5
```

### Limits

- PDFs up to 10 MB. Long statements are read 4 pages at a time.
- The PDF must contain text, as statements from net banking or bank emails do. Scanned or photographed statements are rejected with a message.
- Always review before adding: AI can occasionally misread a row.
- Privacy: the statement text is sent to Anthropic's API for processing. The function doesn't save the PDF or the password.

### Testing the function

```bash
cd supabase/functions/parse-statement
```

```bash
deno test --allow-read --allow-env
```

These need [Deno](https://deno.com) installed. The tests use synthetic statements in `testdata/` (the locked one's password is `RISH1234`) and a fake Claude client, so they cost nothing.

## Importing a CSV (bank statement or backup)

**Settings → Import from CSV** accepts:

- this app's own export (`Date, Amount, Category, Note, …`), or
- most Indian bank statement CSVs. The header row can come after a few lines of account details. The import needs a **Date** column (`Date`, `Txn Date`, `Value Date`, …), an amount column (`Amount`, or `Debit` / `Withdrawal Amt.`) and optionally a description (`Narration`, `Description`, `Particulars`, …).

Dates like `13/11/2026`, `13-11-26`, `13 Nov 2026` and `2026-11-13` are read day-first. When the file has a Debit/Withdrawal column, only debits are imported. Rows that already exist (same date, amount and note) are skipped, so importing the same file twice won't create duplicates. Imported rows without a category go to **Other**.

Many banks only offer XLS/PDF statements. Open the XLS in Google Sheets or Excel and use **File → Download → CSV**.

## Build an installable app (APK / App Store)

Expo Go is for development. To get a real app on your phone, build it with [EAS](https://docs.expo.dev/build/introduction/):

```bash
npx eas-cli@latest login
npx eas-cli@latest build:configure
npx eas-cli@latest build --platform android --profile preview
```

To build an APK you can sideload, set `"android": { "buildType": "apk" }` under the `preview` profile in `eas.json`. Because `.env` is not committed, add the two `EXPO_PUBLIC_SUPABASE_*` values as [EAS environment variables](https://docs.expo.dev/eas/environment-variables/) so cloud builds include them.

## Development

```bash
npm test             # unit tests for money, dates, CSV, split maths and statement review
npm run typecheck    # TypeScript
npx expo lint        # ESLint
```

```
src/
  app/                 screens (Expo Router: every file is a route)
    (tabs)/            Expenses, Insights, Budgets, Split, Settings
    expense/[id].tsx   add / edit expense (id = "new" to add)
    person/[id].tsx    balance, settle up and history with one friend
    categories.tsx     add / edit / delete categories
    login.tsx          Supabase email sign-in / sign-up
    statement.tsx      statement PDF import: pick, password, review, add
  components/          UI kit and charts (react-native-svg)
  db/
    schema.ts          SQLite migrations + default categories
    repo.ts            all reads/writes
    sync.ts            Supabase pull/push (last-write-wins)
  lib/                 pure logic (money, dates, CSV, splits) + app state
supabase/
  schema.sql           Postgres tables, RLS policies and sync trigger
  config.toml          Supabase CLI config (used by link / deploy)
  functions/parse-statement/
    index.ts           Edge Function: auth, ALLOWED_EMAILS check, request handling
    core.ts            PDF unlock + text layout + Claude extraction (unit-tested)
```

To change the database, add a new entry to `MIGRATIONS` in `src/db/schema.ts`; never edit an existing one. For synced tables, also update `COLUMNS` in `src/db/sync.ts` and `supabase/schema.sql`.

The web target (`npx expo start --web`) works for quick UI checks. `metro.config.js` sets the headers that expo-sqlite needs in the browser. The app is designed for phones, though: confirmation dialogs (`Alert`) don't show on web.
