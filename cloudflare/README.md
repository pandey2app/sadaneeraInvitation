# Cloudflare Workers + D1 Local Setup & Testing Guide

This guide describes how to run and test the Cloudflare-compatible backend locally for **Sadaneera Mahotsav 2026** using **Wrangler** and a local **Cloudflare D1** SQLite database.

---

## 1. Directory Structure

```
cloudflare/
├── .dev.vars.example   # Example template for local secrets (never committed to git)
├── .gitignore          # Ignores .dev.vars, .wrangler/, and node_modules
├── package.json        # Dependencies (bcryptjs) and devDependencies (wrangler)
├── schema.sql          # Cloudflare D1 schema (users, invitations, event_settings, card_sequence)
├── wrangler.toml       # Workers & D1 configuration (database_id placeholder)
├── README.md           # Setup and local testing guide
└── src/
    ├── index.js        # Worker REST router handling all /api/* routes
    ├── auth.js         # Web Crypto HMAC-SHA256 JWT & bcryptjs authentication
    └── drive.js        # Server-side Google Drive photo upload, streaming, and deletion
```

---

## 2. Step 1: Install Dependencies

From the `cloudflare/` directory:

```bash
cd cloudflare
npm install
```

---

## 3. Step 2: Authenticate Wrangler

Log in with your Cloudflare account via the browser:

```bash
npx wrangler login
```

---

## 4. Step 3: Create the D1 Database

Run the following command to create your D1 database:

```bash
npx wrangler d1 create sadaneera-invitations-test
```

Wrangler will output the configuration block:

```toml
[[d1_databases]]
binding = "DB"
database_name = "sadaneera-invitations-test"
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```

Copy the generated `database_id` and replace the placeholder in `cloudflare/wrangler.toml`:

```toml
[[d1_databases]]
binding = "DB"
database_name = "sadaneera-invitations-test"
database_id = "YOUR_REAL_DATABASE_ID_HERE"
```

---

## 5. Step 4: Initialize the Database Schema

Initialize the tables and singleton configuration records:

- **For Local Development (`wrangler dev`):**
  ```bash
  npx wrangler d1 execute sadaneera-invitations-test --local --file=./schema.sql
  ```

- **For Remote Cloudflare D1 (When ready):**
  ```bash
  npx wrangler d1 execute sadaneera-invitations-test --remote --file=./schema.sql
  ```

---

## 6. Step 5: Configure Local Secrets (.dev.vars)

Wrangler uses `.dev.vars` for local secrets (automatically ignored by git):

1. Copy the example file:
   ```bash
   cp .dev.vars.example .dev.vars
   ```

2. Open `.dev.vars` and fill in your values:
   ```ini
   JWT_SECRET="your-secure-jwt-secret-string"
   GOOGLE_DRIVE_FOLDER_ID="your_google_drive_folder_id"
   GOOGLE_DRIVE_CLIENT_ID="your_client_id.apps.googleusercontent.com"
   GOOGLE_DRIVE_CLIENT_SECRET="your_client_secret"
   GOOGLE_DRIVE_REFRESH_TOKEN="your_refresh_token"

   SUPERADMIN_USERNAME="superadmin"
   SUPERADMIN_PASSWORD="YourInitialSuperAdminPassword"
   SUPERADMIN_NAME="मुख्य प्रशासक (Super Admin)"
   SUPERADMIN_EMAIL="pandey2app@gmail.com"
   ```

*(When later preparing for remote deployment, configure these via `npx wrangler secret put <KEY>`)*

---

## 7. Step 6: Run Locally

Start the local Worker dev server:

```bash
npx wrangler dev
```

Wrangler will start a local server (typically at `http://localhost:8787`).
It binds the local D1 SQLite database, injects your `.dev.vars` secrets, serves the static frontend from `../public`, and handles all `/api/*` endpoints.

---

## 8. Step 7: How to Test Locally Without Creating Production Records

1. **Verify Health:**
   ```bash
   curl http://localhost:8787/api/health
   ```
   *Expected:* HTTP 200 with status `"ok"`.

2. **Test Login:**
   Open `http://localhost:8787` in your browser, or send a POST request:
   ```bash
   curl -X POST http://localhost:8787/api/auth/login \
     -H "Content-Type: application/json" \
     -d '{"username":"superadmin","password":"YourInitialSuperAdminPassword"}'
   ```
   *Expected:* HTTP 200 with JWT token and user profile.

3. **Test Dashboard & Session:**
   ```bash
   curl http://localhost:8787/api/auth/me \
     -H "Authorization: Bearer <TOKEN>"
   ```
   *Expected:* HTTP 200 with Super Admin details.

4. **Verify D1 Persistence Locally:**
   Query the local D1 database directly:
   ```bash
   npx wrangler d1 execute sadaneera-invitations-test --local --command="SELECT id, username, role FROM users;"
   ```
   *Expected:* Shows the bootstrapped `superadmin` record.

5. **Test Card Creation & Atomic Sequence (Test Record):**
   You can generate a test invitation in the UI and verify that:
   - Card code receives serial `SN-0001-XXXX`.
   - Photo uploads to Google Drive and streams via `/api/cards/photo/drive/<fileId>`.
   - Deleting the card marks it `is_deleted = 1` without removing the file.
   - Permanent delete purges the record from D1 and deletes the file from Drive.
   - Local database can be inspected with:
     ```bash
     npx wrangler d1 execute sadaneera-invitations-test --local --command="SELECT card_code, is_deleted FROM invitations;"
     ```
