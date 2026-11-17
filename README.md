# ReplyBot

## Setup
1. Neon: create a project, copy the connection string into `DATABASE_URL`. Run `npm i && npm run db:push` once locally.
2. Meta: create an app → add **Instagram** product → *API setup with Instagram login*.
   - Valid OAuth redirect URI: `APP_BASE_URL/auth/callback`
   - Webhooks: callback `APP_BASE_URL/webhook`, verify token = `WEBHOOK_VERIFY_TOKEN`, subscribe to **comments**
   - Permissions: `instagram_business_basic`, `instagram_business_manage_comments`
   - In dev mode, add your account as an Instagram tester and accept the invite (Instagram → Settings → Apps and websites). Other accounts need app review.
3. Railway: deploy from GitHub; set all vars from `.env.example`. Build `npm run build`, start `npm start`. Use the Railway URL as `APP_BASE_URL`.
4. Open the app → Connect Instagram → create an automation → comment a trigger from a *different* account.
