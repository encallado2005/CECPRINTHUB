CECPRINTHUB — CLOUD CONNECTED VERSION

This version replaces browser-local account/order storage with Firebase Authentication and Cloud Firestore. Customer orders and admin status updates sync across devices in real time. Print files are uploaded to your private Supabase Storage bucket through a Supabase Edge Function that verifies Firebase ID tokens.

IMPORTANT: It is not live until you deploy the Edge Function, set its server-side secrets, publish Firestore rules, create the admin account in Firebase Authentication, and host this website over HTTPS. Follow SECURE_DEPLOYMENT.md from top to bottom.

Key files:
- index.html / style.css: website UI
- cloud-app.js: Firebase Auth, Firestore realtime orders, and secure file gateway calls
- supabase/functions/print-files/index.ts: server-side file gateway
- firestore.rules: access control rules
- SECURE_DEPLOYMENT.md: deployment and testing instructions

Admin account: create janry@gmail.com in Firebase Authentication with your own strong password. The former demo password is not hard-coded or accepted by this cloud version.

Private bucket: print-files
Max file size: 20 MB (request limits may be lower for base64 uploads)
Do not expose Supabase service-role/secret keys in any client-side file.
