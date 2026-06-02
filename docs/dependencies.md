# Dependencies

## Auth.js

- **Purpose:** App-owned authentication layer running inside the existing Express server.
- **Sends data off-domain:** No.
- **What breaks if it changes or is removed:** Local sign-in/session handling breaks until replaced, but content, roles, and authorization data remain local to the app database.
- **Self-hosting alternative:** Not applicable. Auth.js already runs in-repo.

## GitHub OAuth

- **Purpose:** Visitor sign-in using an identity many users already have.
- **Sends data off-domain:** Yes, to GitHub during authentication.
- **What breaks if it changes or is removed:** GitHub sign-in stops working or requires reconfiguration, but local content, users, roles, and non-GitHub sign-in paths remain intact.
- **Self-hosting alternative:** A self-hosted OIDC broker or a future IndieAuth-based flow.

## Google OAuth

- **Purpose:** Visitor sign-in using an identity many users already have.
- **Sends data off-domain:** Yes, to Google during authentication.
- **What breaks if it changes or is removed:** Google sign-in stops working or requires reconfiguration, but local content, users, roles, and non-Google sign-in paths remain intact.
- **Self-hosting alternative:** A self-hosted OIDC broker or a future IndieAuth-based flow.

## Hostinger MySQL

- **Purpose:** Canonical relational datastore for posts, users, comments, reactions, Auth.js session data, profile-only image bytes, reusable media metadata, and feed-source profile metadata across both local and deployed app runtimes.
- **Sends data off-domain:** Yes, when the app connects remotely from a local machine to the hosted MySQL service.
- **What breaks if it changes or is removed:** Publishing, comment writes, authentication persistence, and feed-backed content reads stop working until database connectivity is restored or reconfigured.
- **Self-hosting alternative:** A self-managed MySQL-compatible database or reverting to self-hosted SQLite on infrastructure that guarantees persistent storage outside the deployment build artifact.

## TipTap

- **Purpose:** Rich-text editing for owner-authored posts, including the compact WYSIWYG-style toolbar, heading levels `H1`–`H6`, direct YouTube insertion, and custom embed/media nodes.
- **Sends data off-domain:** No.
- **What breaks if it changes or is removed:** The post composer and editor lose their CMS-style authoring experience until replaced, but stored sanitized HTML content remains in the app database.
- **Self-hosting alternative:** A custom `contenteditable` editor or a different in-repo editor stack.

## p5

- **Purpose:** Self-hosted runtime for owner-authored interactive art pieces rendered inside app-owned iframe embeds, with generated or manual `p5` instance-mode code preflighted before any draft is shown.
- **Sends data off-domain:** No.
- **What breaks if it changes or is removed:** Saved interactive `p5` pieces stop rendering and the validated piece-generation pipeline cannot complete its runtime preflight until a compatible local runtime is restored, but stored piece prompts, HTML/CSS/JS code, legacy structured specs, and surrounding post content remain intact.
- **Self-hosting alternative:** A custom in-repo canvas runtime maintained by the app.

## c2.js

- **Purpose:** Self-hosted creative-coding runtime for owner-authored 2D interactive pieces, used by the app-owned preview/embed renderer and server-side preflight path.
- **Sends data off-domain:** No.
- **What breaks if it changes or is removed:** Saved interactive `c2` pieces stop rendering and new `c2` piece drafts cannot be previewed until a compatible local runtime is restored, but stored prompts, HTML/CSS/JS code, legacy structured specs, and post content remain intact.
- **Self-hosting alternative:** A custom in-repo 2D geometry/canvas runtime maintained by the app.

## Three.js

- **Purpose:** Self-hosted imperative 3D runtime for owner-authored interactive pieces, used for app-owned 3D preview, embed rendering, and runtime preflight.
- **Sends data off-domain:** No.
- **What breaks if it changes or is removed:** Saved interactive `three` pieces stop rendering and new `three` drafts cannot be previewed until a compatible local runtime is restored, but stored prompts, HTML/CSS/JS code, legacy structured specs, and post content remain intact.
- **Self-hosting alternative:** A custom in-repo WebGL scene runtime maintained by the app.

## sanitize-html

- **Purpose:** Sanitizing author-authored HTML before it is stored and rendered in the Express API.
- **Sends data off-domain:** No.
- **What breaks if it changes or is removed:** Rich post HTML would need a replacement sanitization layer before it can be safely persisted and rendered.
- **Self-hosting alternative:** A custom allowlist sanitizer maintained in-repo.

## rss-parser

- **Purpose:** Fetching and parsing third-party RSS and Atom feeds for the API server's feed-ingest workflow.
- **Sends data off-domain:** Yes, to whatever remote feed URLs the owner configures for ingestion.
- **What breaks if it changes or is removed:** Feed ingestion stops being able to import remote feed items until a replacement parser/fetch pipeline is installed, but the rest of the app remains functional.
- **Self-hosting alternative:** A custom in-repo feed fetcher and RSS/Atom parser maintained as part of the app.

## Local Media Library

- **Purpose:** Store uploaded and owner-imported media in the MySQL-backed `media_assets` library for insertion into rich posts, direct featured-image selection, owner profile photos, and feed-source profile photos.
- **Sends data off-domain:** Only when the owner imports an image from a URL; the app server fetches that owner-provided remote image once, then stores a local copy.
- **What breaks if it changes or is removed:** The rich post editor can no longer accept direct media uploads or import remote images into reusable local media, and owner/feed-source profile photo uploads can no longer appear in the Image Library until replaced with another storage mechanism.
- **Self-hosting alternative:** This is already the self-hosted path. The main future alternative is managed object storage.
- **Operational note:** Direct image uploads and URL imports are capped at 8 MB per file. Oversized uploads/imports return clear errors rather than a generic server failure.

## Profile-Only Photo Storage

- **Purpose:** Store member profile photo uploads in the database-backed `profile_photo_assets` table and serve them from `/api/profile-photos/:fileName` without adding them to the owner-managed Image Library.
- **Sends data off-domain:** No.
- **What breaks if it changes or is removed:** Member profile photo uploads stop working, and member profiles fall back to whatever `users.image` value was already stored until a replacement storage path is implemented.
- **Self-hosting alternative:** This is already the self-hosted path. A future alternative would be app-owned object storage with equivalent access controls.
- **Operational note:** The same upload size limits and magic-byte validation used for media uploads apply to profile photo uploads.

## File Type Detection

- **Purpose:** Verify uploaded file types from file signatures instead of trusting browser MIME headers for media uploads, owner/feed-source profile photos, and member profile-only photos.
- **Sends data off-domain:** No.
- **What breaks if it changes or is removed:** Upload validation would need another magic-byte inspection mechanism before media and profile-photo uploads can stay safely enabled.
- **Self-hosting alternative:** A custom in-repo signature sniffer for the small set of supported media formats.

## Satori & Resvg

- **Purpose:** Generating dynamic Open Graph PNG images for social media previews.
- **Sends data off-domain:** No.
- **What breaks if it changes or is removed:** Post links will fallback to a static generic image when shared on social media.
- **Self-hosting alternative:** This is already the self-hosted path.

## OpenCode Zen

- **Purpose:** Optional owner-enabled AI assistance through OpenCode Zen using the owner's saved API key and chosen model slug for both text rewriting and validated interactive piece generation across `p5`, `c2`, and `three`.
- **Sends data off-domain:** Yes, when the owner explicitly triggers AI from the post editor or the interactive-piece generation flow.
- **What breaks if it changes or is removed:** AI-assisted rewriting and AI-assisted interactive piece generation for users who selected OpenCode Zen stop working until the adapter is updated or the user switches vendors; the rest of the app remains functional.
- **Self-hosting alternative:** Not permitted for this product direction. Hosted-provider-only.
- **Routing note:** Uses Opencode Zen's compatibility endpoints by model family. Chat-completions art-piece requests, including `minimax-m3-free`, use the gateway-safe 4096-token cap and send `thinking: { type: "disabled" }` plus an explicit no-`<think>` system directive so Zen returns final HTML/CSS/JS instead of reasoning-only output. Piece-generation provider requests share the 20-minute generation budget and retry retryable upstream failures inside the existing attempt budget.

## OpenCode Go

- **Purpose:** Optional owner-enabled AI assistance through OpenCode Go using the owner's saved API key and chosen model slug for both text rewriting and validated interactive piece generation across `p5`, `c2`, and `three`.
- **Sends data off-domain:** Yes, when the owner explicitly triggers AI from the post editor or the interactive-piece generation flow.
- **What breaks if it changes or is removed:** AI-assisted rewriting and AI-assisted interactive piece generation for users who selected OpenCode Go stop working until the adapter is updated or the user switches vendors; the rest of the app remains functional.
- **Self-hosting alternative:** Not permitted for this product direction. Hosted-provider-only.
- **Routing note:** Uses Opencode Go's compatibility endpoints by model family. `minimax-m3` routes to `/zen/go/v1/chat/completions` and may also be saved as `opencode-go/minimax-m3`. Chat-completions art-piece requests use the gateway-safe 4096-token cap and send `thinking: { type: "disabled" }` plus an explicit no-`<think>` system directive. Piece-generation provider requests share the 20-minute generation budget and retry retryable upstream failures inside the existing attempt budget.

## Google Gemini API

- **Purpose:** Optional owner-enabled AI assistance for the Google vendor using the owner's saved Gemini API key for both text rewriting and validated interactive piece generation across `p5`, `c2`, and `three`.
- **Sends data off-domain:** Yes, when the owner explicitly triggers AI from the post editor or the interactive-piece generation flow.
- **What breaks if it changes or is removed:** AI-assisted rewriting and AI-assisted interactive piece generation for users who selected Google stop working until the adapter is updated or the user switches vendors; the rest of the app remains functional.
- **Self-hosting alternative:** Not permitted for this product direction. Hosted-provider-only.

## OpenRouter

- **Purpose:** Optional owner-enabled AI assistance through OpenRouter using the owner's saved OpenRouter API key and chosen provider-prefixed model slug for both text rewriting and validated interactive piece generation across `p5`, `c2`, and `three`.
- **Sends data off-domain:** Yes, when the owner explicitly triggers AI from the post editor or the interactive-piece generation flow.
- **What breaks if it changes or is removed:** AI-assisted rewriting and AI-assisted interactive piece generation for users who selected OpenRouter stop working until the adapter is updated or the user switches vendors; the rest of the app remains functional.
- **Self-hosting alternative:** Not permitted for this product direction. Hosted-provider-only.
- **Routing note:** Uses OpenRouter's official OpenAI-compatible `POST https://openrouter.ai/api/v1/chat/completions` endpoint.

## WordPress.com REST API v1.1

- **Purpose:** POSSE syndication — publishing owner-authored posts to connected WordPress.com blogs via the owner's stored OAuth token.
- **Sends data off-domain:** Yes, to `public-api.wordpress.com` when the owner publishes a post with WordPress.com selected as a syndication target.
- **Outbound payload note:** The published body includes an appended visible source line in the form `Original source at {Site Title}: {Canonical URL}`.
- **What breaks if it changes or is removed:** Syndication to WordPress.com stops working or requires adapter updates; posts already published there remain, local content and all other syndication targets are unaffected.
- **Self-hosting alternative:** A self-hosted WordPress instance connected via the self-hosted WordPress adapter (App Passwords, no WordPress.com API involved).

## WordPress Self-Hosted REST API v2

- **Purpose:** POSSE syndication — publishing owner-authored posts to a self-hosted WordPress site via Basic Auth (username + application password).
- **Sends data off-domain:** Yes, to the owner-configured WordPress site URL when the owner publishes a post with self-hosted WordPress selected as a syndication target.
- **Outbound payload note:** The published body includes an appended visible source line in the form `Original source at {Site Title}: {Canonical URL}`.
- **What breaks if it changes or is removed:** Syndication to self-hosted WordPress stops working; local content and other syndication targets are unaffected.
- **Self-hosting alternative:** This is already the self-hosted path.

## Medium API v1

- **Purpose:** POSSE syndication — publishing owner-authored posts to a connected Medium account via a self-integration token stored encrypted in the database. Medium deprecated its public OAuth API for new integrations; the app uses a personal self-integration token instead.
- **Sends data off-domain:** Yes, to `api.medium.com` when the owner publishes a post with Medium selected as a syndication target.
- **Outbound payload note:** The submitted content includes an appended visible source line in the form `Original source at {Site Title}: {Canonical URL}`, and the request also sends Medium's native `canonicalUrl` field.
- **What breaks if it changes or is removed:** Syndication to Medium stops working or requires adapter updates; posts already published there remain, local content and all other syndication targets are unaffected.
- **Self-hosting alternative:** None. Medium is a closed platform with no self-hosted equivalent.

## Blogger API v3

- **Purpose:** POSSE syndication — publishing owner-authored posts to a connected Blogger blog via the owner's stored Google OAuth token (scoped separately from the sign-in Google OAuth).
- **Sends data off-domain:** Yes, to `www.googleapis.com` when the owner publishes a post with Blogger selected as a syndication target.
- **Outbound payload note:** The published body includes an appended visible source line in the form `Original source at {Site Title}: {Canonical URL}`.
- **What breaks if it changes or is removed:** Syndication to Blogger stops working or requires adapter updates; posts already published there remain, local content and all other syndication targets are unaffected.
- **Self-hosting alternative:** None. Blogger is a Google-hosted platform.

## Substack Shadow API

- **Purpose:** POSSE syndication — publishing owner-authored posts directly to a connected Substack publication using the owner's stored session cookie value, publication ID, and publication hostname. The same adapter now supports publish-only web posts and optional publish-and-send newsletter delivery when the Substack composer toggle is selected.
- **Sends data off-domain:** Yes, to `substack.com` when the owner publishes a post with Substack selected as a syndication target.
- **Outbound payload note:** The generated draft body includes an appended visible source line in the form `Original source at {Site Title}: {Canonical URL}` before publication.
- **What breaks if it changes or is removed:** Syndication to Substack stops working or requires adapter updates; posts already published there remain, local content and all other syndication targets are unaffected.
- **Self-hosting alternative:** None. Substack is a closed hosted platform and this integration uses an unofficial API surface.
- **Operational note:** This is an unofficial cookie-authenticated integration. The current adapter performs publication-scoped draft and publish writes against the publication hostname and bootstraps publication auth from the saved session before creating drafts. If Substack changes its internal API shape or invalidates the stored session, the app marks the connection as expired and the owner must update credentials in Admin → Platforms.

## Bluesky AT Protocol (bsky.social)

- **Purpose:** POSSE syndication — publishing owner-authored posts to a connected Bluesky account via the AT Protocol lexicons, with the canonical post URL rendered as an external card and the featured image uploaded as the card thumbnail when present. No OAuth app required; the user generates an App Password from their Bluesky account settings.
- **Sends data off-domain:** Yes, to `bsky.social` when the owner publishes a post with Bluesky selected as a syndication target.
- **Outbound payload note:** The post text uses the owner's editable social draft or is auto-generated from the post title, excerpt, and canonical URL, truncated to fit 300 graphemes. A URL facet is added so the link is clickable in Bluesky clients, and the external card points back to the canonical post URL.
- **What breaks if it changes or is removed:** Syndication to Bluesky stops working or requires adapter updates; posts already published there remain, local content and all other syndication targets are unaffected.
- **Self-hosting alternative:** The AT Protocol is open — a self-hosted PDS (Personal Data Server) is technically possible, but bsky.social is the standard entry point.
- **Operational note:** No developer account or approval process required. Rate limits are generous (1,666 posts/hour). Users connect by entering their Bluesky handle and an App Password at Admin → Platforms.

## LinkedIn REST API (Posts API v202605)

- **Purpose:** POSSE syndication — publishing owner-authored posts to a connected LinkedIn personal profile via the Posts API (`/rest/posts`), using OAuth 2.0 with `w_member_social` scope.
- **Sends data off-domain:** Yes, to `api.linkedin.com` when the owner publishes a post with LinkedIn selected as a syndication target.
- **Outbound payload note:** The post commentary uses the owner's editable social draft or is auto-generated from the post title, excerpt, and canonical URL (up to 3,000 characters). LinkedIn receives article content with the canonical URL as `source`, plus title, description, and a featured-image thumbnail when present.
- **What breaks if it changes or is removed:** Syndication to LinkedIn stops working or requires adapter updates; posts already published there remain, local content and all other syndication targets are unaffected.
- **Self-hosting alternative:** None. LinkedIn is a closed platform.
- **Operational note:** Requires a LinkedIn Developer app associated with an existing LinkedIn Page. That Page association owns/administers the developer app, but the current CreatrWeb adapter still publishes to the personal LinkedIn profile that authorizes OAuth (`urn:li:person:{personId}`), not to the Page. The app must have both **Share on LinkedIn** (`w_member_social`) and **Sign In with LinkedIn using OpenID Connect** (`openid`, `profile`, `email`) enabled; without OpenID Connect, LinkedIn returns `unauthorized_scope_error` for the `openid` scope. Access tokens expire after ~60 days; the user must reconnect when the token expires. LinkedIn's API rate limit is approximately 100 calls/day per member.

## Meta Graph API (Facebook + Instagram)

- **Purpose:** POSSE syndication — publishing owner-authored posts to a connected Facebook Page via `/{page-id}/feed` with the canonical URL as a link-card post, and to a linked Instagram Business/Creator account via the two-step Content Publishing API (`/{ig-user-id}/media` → `/{ig-user-id}/media_publish`). Both platforms share a single Meta Developer App and OAuth flow.
- **Sends data off-domain:** Yes, to `graph.facebook.com` when the owner publishes a post with Facebook or Instagram selected as a syndication target.
- **Outbound payload note:** Facebook posts include the owner's editable social draft or auto-generated text with the canonical URL and rely on the canonical post's Open Graph metadata for the link card. Instagram posts use a caption with the canonical URL; a featured image URL is required because Instagram does not support text-only feed posts or link cards in this API flow.
- **What breaks if it changes or is removed:** Syndication to Facebook and/or Instagram stops working or requires adapter updates; posts already published there remain, local content and all other syndication targets are unaffected.
- **Self-hosting alternative:** None. Both platforms are closed and gated behind Meta's Developer App Review process.
- **Operational note:** Requires a Meta Developer App with App Review for production use (`pages_manage_posts`, `instagram_content_publish` permissions). Facebook Page Access Tokens do not expire as long as the user keeps the app authorized. Instagram requires a Business or Creator account linked to the authorized Facebook Page.

## Mistral AI

- **Purpose:** Optional owner-enabled AI assistance through Mistral AI using the owner's saved standard Mistral API key and chosen model slug for text rewriting, alt text generation, and validated interactive piece generation across `p5`, `c2`, and `three`.
- **Sends data off-domain:** Yes, to `api.mistral.ai` when the owner explicitly triggers AI from the post editor or the interactive-piece generation flow.
- **What breaks if it changes or is removed:** AI-assisted rewriting and AI-assisted interactive piece generation for users who selected Mistral AI stop working until the adapter is updated or the user switches vendors; the rest of the app remains functional.
- **Self-hosting alternative:** Not permitted for this product direction. Hosted-provider-only.
- **Routing note:** Uses Mistral's OpenAI-compatible `POST https://api.mistral.ai/v1/chat/completions` endpoint with `Authorization: Bearer {key}`. The owner supplies their own API key from `console.mistral.ai`.

## Mistral Vibe

- **Purpose:** Optional owner-enabled AI assistance through Mistral's Vibe API using the owner's saved Vibe API key (obtained from `console.mistral.ai/codestral/vibe`) for text rewriting, alt text generation, and validated interactive piece generation across `p5`, `c2`, and `three`.
- **Sends data off-domain:** Yes, to `api.mistral.ai` when the owner explicitly triggers AI from the post editor or the interactive-piece generation flow.
- **What breaks if it changes or is removed:** AI-assisted rewriting and AI-assisted interactive piece generation for users who selected Mistral Vibe stop working until the adapter is updated or the user switches vendors; the rest of the app remains functional.
- **Self-hosting alternative:** Not permitted for this product direction. Hosted-provider-only.
- **Routing note:** Uses `POST https://api.mistral.ai/v1/chat/completions` with the Vibe API key. The confirmed model slug as of May 2026 is `mistral-vibe-cli-latest` (Devstral 2). Standard `-latest` aliases like `devstral-small-latest` are specific to `codestral.mistral.ai` and will return a 400 on this endpoint. The vendor ID `codestral` is reserved for a future distinct Codestral vendor.

## DeepSeek

- **Purpose:** Optional owner-enabled AI assistance through DeepSeek using the owner's saved DeepSeek API key for text rewriting and validated interactive piece generation across `p5`, `c2`, and `three`.
- **Sends data off-domain:** Yes, to `api.deepseek.com` when the owner explicitly triggers AI text or interactive-piece generation.
- **What breaks if it changes or is removed:** DeepSeek-backed AI text rewriting and AI-assisted interactive piece generation stop working until the adapter is updated or the owner switches vendors; local posts, saved pieces, feeds, exports, and other AI vendors remain functional.
- **Self-hosting alternative:** Not permitted for this product direction. Hosted-provider-only.
- **Routing note:** Uses DeepSeek's OpenAI-compatible `POST https://api.deepseek.com/chat/completions` endpoint with `Authorization: Bearer {key}`. The Admin AI UI defaults to `deepseek-v4-flash`; `deepseek-v4-pro` can be entered manually. For validated piece generation, DeepSeek requests use non-thinking mode so the provider is more likely to return final HTML/CSS/JS blocks instead of reasoning-only content. Piece-generation provider requests share the 20-minute generation budget across up to 5 attempts; DeepSeek chat completions use the expanded 12,000-token output budget while ordinary text rewriting keeps the normal chat-completions request shape. DeepSeek is intentionally excluded from image alt-text generation until official DeepSeek API image-input support is documented or live-verified.

## turndown

- **Purpose:** Converting rich-post HTML to Markdown before submitting to the Medium API, which accepts Markdown more cleanly than raw HTML.
- **Sends data off-domain:** No. Runs entirely in-process on the API server.
- **What breaks if it changes or is removed:** The Medium adapter would need a replacement HTML-to-Markdown converter; other syndication targets and all local functionality are unaffected.
- **Self-hosting alternative:** A custom in-repo HTML-to-Markdown serializer, or switching Medium posts to plain-text with stripped HTML.
