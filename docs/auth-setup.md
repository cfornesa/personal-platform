# Auth Setup

## Local Development

Run the one-port development server from the repository root:

```bash
npm run dev
```

The frontend is built first, then the API server serves the built frontend and all API/Auth routes from the same origin. The default local port is `4000` (`PORT=4000` in `.env`). macOS's AirPlay Receiver occupies port 5000, so 4000 is the local default.

For active frontend work with Vite hot reload:

```bash
npm run dev:hot
```

In hot mode, Vite serves the frontend at `http://localhost:3000` and proxies API/Auth routes to the API server at the configured `PORT`.

## Required `.env` Values

```env
PORT=4000
ALLOWED_ORIGINS=http://localhost:4000
AUTH_SECRET=replace_with_a_long_random_secret
SESSION_SECRET=replace_with_a_long_random_secret
GITHUB_ID=your_github_oauth_app_client_id
GITHUB_SECRET=your_github_oauth_app_client_secret
GOOGLE_CLIENT_ID=your_google_oauth_client_id
GOOGLE_CLIENT_SECRET=your_google_oauth_client_secret
OWNER_EMAILS=owner@example.com
DB_HOST=your_database_host
DB_PORT=3306
DB_NAME=your_database_name
DB_USER=your_database_user
DB_PASS=your_database_password
DB_SSL=true
AI_SETTINGS_ENCRYPTION_KEY=replace_with_32_byte_base64_or_hex_key
```

Generate `AUTH_SECRET`:

```bash
openssl rand -hex 32
```

Generate `AI_SETTINGS_ENCRYPTION_KEY`:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

`AI_SETTINGS_ENCRYPTION_KEY` must decode to exactly 32 bytes. The key is used to encrypt both AI vendor API keys and platform OAuth app credentials (CLIENT_ID / CLIENT_SECRET) stored in the database.

> Do not set `AUTH_URL`. Auth.js derives the origin from the incoming request host and derives `/api/auth` from the Express mount point, keeping local and deployed origins aligned automatically.

`OWNER_EMAILS` is the first-owner allowlist for fresh databases. When no owner exists yet, the first successful sign-in whose email matches `OWNER_EMAILS` is promoted automatically and redirected into `/admin/setup`.

## Database

- MySQL connection is configured through `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASS`, and optionally `DB_SSL`.
- Set `DB_SSL=true` when connecting to any hosted MySQL provider (Hostinger, PlanetScale, Railway, etc.).
- Schema is applied automatically on startup via `ensureTables()` — no manual migration step required.
- A single canonical MySQL database can be shared by both the deployed app and a local publishing workflow.
- Profile photos are stored locally in MySQL-backed paths: member profile-only uploads use `profile_photo_assets`, while owner and feed-source profile photos use the reusable `media_assets` Image Library path.
- Bundled default site assets such as the favicon are seeded into MySQL-backed `site_assets` on first boot and served from DB-backed routes after seeding.
- The shell keeps deterministic artifacts outside the DB (`node_modules`, generated API clients, build output), but mutable site state and durable identity assets are DB-first.

## OAuth Callback URLs

### Auth.js sign-in providers (GitHub, Google)

Configure these callback URLs in your provider dashboards for local development:

- GitHub: `http://localhost:4000/api/auth/callback/github`
- Google: `http://localhost:4000/api/auth/callback/google`

For hot-reload mode (`npm run dev:hot`), also configure the Vite dev server origin:

- GitHub: `http://localhost:3000/api/auth/callback/github`
- Google: `http://localhost:3000/api/auth/callback/google`

For production, use your deployed origin (e.g. `https://yourdomain.com`):

- GitHub: `https://yourdomain.com/api/auth/callback/github`
- Google: `https://yourdomain.com/api/auth/callback/google`

### Platform syndication (WordPress.com, Blogger)

These callbacks are separate from sign-in and use credentials stored in the database via `/admin/platforms`. The admin UI generates the exact URIs to register, derived from your `ALLOWED_ORIGINS` value:

- WordPress.com redirect URL: `{ALLOWED_ORIGINS}/api/platform-oauth/wordpress-com/callback`
- Blogger authorized redirect URI: `{ALLOWED_ORIGINS}/api/platform-oauth/blogger/callback`

For Blogger, also register `{ALLOWED_ORIGINS}` as an authorized JavaScript origin and enable the **Blogger API v3** in your Google Cloud project.

## First Owner Bootstrap

Default path for a fresh database:

1. Set `OWNER_EMAILS` to the email address or addresses allowed to claim ownership.
2. Run:

```bash
npm install
npm run build
npm run dev
```

3. Sign in with an allowed email.
4. If no owner exists yet, the app promotes that account automatically.
5. The owner is redirected to `/admin/setup` to complete:
   - owner display name
   - owner username
   - site title
   - hero heading
   - hero subheading
   - about body
6. After those fields are saved, choose **Complete setup and go live** to lift the public setup gate.

Existing populated sites bypass the gate automatically when the database already contains a real owner and real site content/settings.
If you are replacing an older sibling repo, copy the full shell so the root lifecycle scripts and generated-contract workflow move together with `artifacts/` and `lib/`.

Legacy recovery tools still exist if you ever need to repair a damaged bootstrap state manually:

```bash
npm run list-users --workspace=@workspace/scripts
npm run promote-owner --workspace=@workspace/scripts -- --email you@example.com
```

## Expected Behavior After Setup

- A copied shell pointed at an existing populated database should render that existing site immediately.
- A copied shell pointed at an empty database should show the setup gate publicly until an allowed owner completes `/admin/setup`.
- Replacing the full shell in an older sibling repo should preserve the working site as long as the sibling repo keeps its own database and environment variables.
- Signed-in members can comment, edit their own comments, manage their profile, and upload a profile-only photo.
- The auto-claimed or existing owner can create, edit, and delete posts; manage categories, platforms, feeds, Image Library-backed profile photos, and feed-source profile photos; and access all `/admin/*` routes.
- The owner's post composer uses the rich editor with sanitized HTML storage, compact WYSIWYG controls, heading levels `H1`–`H6`, local image uploads, direct featured-image uploads, YouTube URL insertion, and owner-trusted `https:` iframe embeds.
- The first uploaded content image becomes the featured image automatically unless the owner has manually selected a featured image; oversized uploads return a clear 413 error instead of a generic server failure.
- Platform connections configured in `/admin/platforms` appear in the post composer's syndication target selector.
- When the owner syndicates a post authored on this application, the external copy keeps the canonical URL attached. Article-style targets include a visible source line: `Original source at {Site Title}: {Canonical URL}`. Social targets use platform-native behavior: Bluesky, LinkedIn, and Facebook prefer canonical link cards; Instagram uses an image post with the canonical URL in the caption.

## Public Feed Endpoints

These respond without authentication:

- Atom: `/api/feeds/atom`
- JSON Feed: `/api/feeds/json`
- mf2-JSON: `/api/feeds/mf2`
- Backward-compatible aliases: `/atom`, `/jsonfeed`, `/export/json`, `/feed.xml`, `/feed.json`, `/export.json`
