# CECPRINTHUB cross-device deployment

This version uses Firebase Authentication + Cloud Firestore for accounts/orders/status and a Supabase Edge Function to access the private `print-files` Storage bucket. The browser never receives the Supabase service-role key. Order changes stream live to customer/admin browsers using Firestore listeners.

## 1. Firebase setup

Project configured in `cloud-app.js`: `cecprinthub`.

1. In Firebase Console → Authentication → Sign-in method, enable **Email/Password**.
2. In Authentication → Users, create the administrator account with email `janry@gmail.com` and a strong password. The old demo password is NOT used by this cloud version. Do not publish or reuse a weak password.
3. In Firestore Database, create the database if you have not already.
4. Open Firestore → Rules and publish the included `firestore.rules`.
5. Ensure the Firebase Web API key is allowed for Identity Toolkit/Firestore APIs in Google Cloud if API restrictions are enabled.

## 2. Supabase setup

The `print-files` bucket must remain **private**.

Install Supabase CLI, then from this folder run:

```bash
supabase login
supabase link --project-ref nxlnczvexdtlccamcwxl
supabase secrets set SUPABASE_URL=https://nxlnczvexdtlccamcwxl.supabase.co
supabase secrets set SUPABASE_BUCKET=print-files
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=YOUR_SUPABASE_SECRET_SERVICE_ROLE_KEY
supabase secrets set FIREBASE_WEB_API_KEY=YOUR_FIREBASE_WEB_API_KEY
supabase secrets set ADMIN_EMAIL=janry@gmail.com
supabase secrets set SITE_ORIGIN=https://YOUR-PUBLISHED-SITE-DOMAIN
supabase functions deploy print-files --no-verify-jwt
```

Use the **secret/service_role key** from Supabase Project Settings → API Keys only as the value of the server-side secret. Never put it in `cloud-app.js`, HTML, GitHub, or a public message. Supabase publishable/anon key is not needed for this gateway. `--no-verify-jwt` is required because the function verifies Firebase ID tokens itself. It rejects requests without a valid Firebase token.

If testing locally, set `SITE_ORIGIN` to the exact local origin you use (for example `http://localhost:8000`) and serve the folder over HTTP, not `file://`.

## 3. Publish website

Deploy the contents of `CECPRINTHUB_Secure_Updated` to a static host such as Firebase Hosting (free Spark plan may be sufficient for a small static site), GitHub Pages, or Netlify. Because `cloud-app.js` uses ES modules, it must be served over HTTPS/HTTP, not opened directly from your file manager.

Firebase Hosting quick start:

```bash
npm install -g firebase-tools
firebase login
firebase init hosting
# Choose existing project: cecprinthub
# Public directory: . (or the directory containing index.html)
# Configure as single-page app: No
firebase deploy --only hosting
```

After publishing, update the Supabase `SITE_ORIGIN` secret to the exact deployed origin and redeploy the function if needed:

```bash
supabase secrets set SITE_ORIGIN=https://YOUR-PUBLISHED-SITE-DOMAIN
supabase functions deploy print-files --no-verify-jwt
```

## 4. Security and behavior

- The admin is identified by the exact Firebase-authenticated email `janry@gmail.com`. Create that user in Firebase Authentication first.
- Customer order records include Firebase UID; Firestore rules restrict customer reads to their own orders and admin reads to the configured admin email.
- File uploads require a valid Firebase ID token; files are stored under `<firebase-uid>/<order-id>/...` in the private bucket. Download links expire after 5 minutes.
- The function limits file size to 20 MB. Uploads are sent as base64 in the request, so very large files can hit platform request limits before that cap; for typical print files this should be fine.
- Customers and admin see order/status changes on separate devices via Firestore realtime listeners.
- Deleting an order also attempts to delete its file. If file deletion fails, remove it via the function/admin workflow and check Supabase logs.
- Do not put a Supabase service-role key into the website. Rotate it immediately if it was ever exposed publicly.

## 5. Test cross-device flow

1. Publish website and create admin user in Firebase Auth.
2. On Device A, create a customer account, log in, and submit an order with a file.
3. On Device B, log in as `janry@gmail.com`; the order should appear automatically.
4. Mark the order noted. Device A should update to “Your order is noted” automatically.
5. Test opening/downloading the attachment from admin view.
6. Test that a customer cannot access another customer's order or file.

## 6. Troubleshooting

- `auth/operation-not-allowed`: enable Email/Password in Firebase Authentication.
- `Missing or insufficient permissions`: publish `firestore.rules` and confirm you are using the intended Firebase project.
- `Failed to fetch` from the file gateway: verify function deployment, `SITE_ORIGIN`, and Supabase function logs.
- `Server setup incomplete`: one or more Edge Function secrets are missing.
- Admin login fails: create the exact `janry@gmail.com` user in Firebase Authentication. The former hard-coded demo password no longer works.

This package is configured for the Firebase and Supabase project identifiers supplied in this conversation. You must deploy it to your own hosting and set server secrets before real customers can use it. No one can deploy into your accounts from this ZIP alone.
