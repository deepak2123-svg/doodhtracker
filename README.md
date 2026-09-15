# Doodh Ka Hisaab — milk ledger

A small static site for logging daily milk quantity and seeing the monthly
expense. Data is stored in Firebase (Google account) so it follows you
across devices; hosted for free on GitHub Pages.

## 1. Create a Firebase project

1. Go to https://console.firebase.google.com and click **Add project**.
   Give it any name, e.g. `doodh-bahi`.
2. In the left sidebar, open **Build → Firestore Database**, click
   **Create database**, and start in **production mode** (the security
   rules below lock it down properly).
3. In the left sidebar, open **Build → Authentication**, click **Get
   started**, then enable the **Google** sign-in provider.
4. Go to **Project settings** (gear icon, top left) → **General** → scroll
   to **Your apps** → click the **</>** (web) icon to register a web app.
   Give it any nickname; you don't need Firebase Hosting.
5. Firebase shows you a `firebaseConfig` object. Copy it.

## 2. Add your config to the project

Open `config.js` in this folder and replace the placeholder values with
the ones Firebase gave you. It's safe for these values to be public in
your repo — they just identify your project, they don't grant access on
their own.

## 3. Set the Firestore security rules

In the Firebase console, go to **Firestore Database → Rules** and paste
in the contents of `firestore.rules` from this folder, then click
**Publish**. This makes sure only a signed-in user can read or write
their own data.

## 4. Push to GitHub

1. Create a new repository on GitHub (public or private both work for
   Pages, though private repos need a paid plan for Pages on some
   account tiers — public is simplest).
2. Push these files (`index.html`, `style.css`, `app.js`, `config.js`) to
   the repository's default branch.

```
git init
git add index.html style.css app.js config.js firestore.rules README.md
git commit -m "Milk ledger site"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
git push -u origin main
```

## 5. Turn on GitHub Pages

1. In your repo on GitHub, go to **Settings → Pages**.
2. Under **Source**, choose **Deploy from a branch**, pick `main` and
   `/ (root)`, then save.
3. GitHub gives you a URL like
   `https://YOUR_USERNAME.github.io/YOUR_REPO/` — that's your live site,
   usually ready within a minute or two.

## 6. Authorize the domain in Firebase

Firebase only allows sign-in from domains you've approved:

1. In the Firebase console, go to **Authentication → Settings →
   Authorized domains**.
2. Add `YOUR_USERNAME.github.io`.

## Using it

Open your GitHub Pages URL, sign in with Google. At the top there's a
**home switcher** — tap it to see all your homes (e.g. "My Home",
"Parents' Home"), switch between them, or add a new one. Each home has
its own dudhiya, rate history, calendar, and invoice, kept completely
separate — logging milk for your parents' place never touches your own
numbers. The home you last viewed is remembered on that device.

If you were already using the app before this update, your existing
data automatically moves into a home called "My Home" the first time
you sign in after updating — nothing is lost.

Below the switcher there's a bottom nav bar with three tabs, scoped to
whichever home is currently selected:

- **Ledger** — tap a date on the calendar, then tap 2/3/4/5 litres or
  "other" for a different amount. Tap the **+** tile to permanently pin
  a new quick amount (e.g. 1.5 L) for that home — it's applied to the
  selected day right away and stays as a tappable chip from then on.
  Long-press a chip you added to remove it (the default 2/3/4/5 can't be
  removed). The invoice panel builds itself from what you log, with a
  grand total at the bottom, and **Export PDF** / **Export Excel**
  buttons to download that month's invoice as a PDF or an `.xlsx` file.
- **Pricing** — set your rate per litre along with the date it takes
  effect, and your dudhiya's name (shows on the invoice). If your
  milkman changes the price mid-month, just add the new rate with the
  date it started — days before that date keep the old rate, days from
  then on use the new one, all correctly split within the same month's
  invoice. Your rate history is listed below the form.
- **Profile** — your Google account info, all-time litres and spend
  across every month you've logged, a small bar chart of your last 6
  months' spend, a Light/Dark/System appearance toggle, and sign out.

Everything syncs to Firestore, so the same login on your phone or
another computer shows the same data.

The site follows your phone or browser's light/dark setting
automatically, and gives a light haptic tap on supported phones when
you log a day, switch tabs, or save a rate change. You can override the
automatic theme any time from the Light/Dark/System toggle on the
Profile tab — that choice is remembered on that device.

Cleared a day by mistake? A brief "Undo" toast appears at the bottom
for a few seconds after clearing an entry.
