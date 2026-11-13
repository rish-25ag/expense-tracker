# Expense Tracker

A personal expense tracker for Android and iOS, built with React Native + Expo.
Amounts are in Indian Rupees (₹) with Indian digit grouping (₹1,23,456).

- **Expenses**: add, edit and delete expenses with an amount, category, note and date, grouped by day for each month.
- **Insights**: spending by category and a 6-month trend, plus a comparison with last month and your monthly average.
- **Budgets**: a monthly limit per category, with a progress bar and a warning when an expense takes you past 80% or over the limit.
- **Split**: split a bill with friends added by name (equally or by custom amounts), track who owes whom, settle up fully or partly, and share a reminder on WhatsApp or anywhere else. Your friends don't need the app.
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

## Importing a bank statement

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
npm test             # unit tests for money, dates, CSV and split maths
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
  components/          UI kit and charts (react-native-svg)
  db/
    schema.ts          SQLite migrations + default categories
    repo.ts            all reads/writes
    sync.ts            Supabase pull/push (last-write-wins)
  lib/                 pure logic (money, dates, CSV, splits) + app state
supabase/schema.sql    Postgres tables, RLS policies and sync trigger
```

To change the database, add a new entry to `MIGRATIONS` in `src/db/schema.ts`; never edit an existing one. For synced tables, also update `COLUMNS` in `src/db/sync.ts` and `supabase/schema.sql`.

The web target (`npx expo start --web`) works for quick UI checks. `metro.config.js` sets the headers that expo-sqlite needs in the browser. The app is designed for phones, though: confirmation dialogs (`Alert`) don't show on web.
