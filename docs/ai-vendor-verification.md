# AI Vendor Verification

Use this runbook before calling any AI vendor integration "supported" in docs, UI copy, or release notes.

The goal is to verify three layers for each vendor:

1. Contract correctness in the adapter.
2. Settings save and persistence behavior.
3. Real composer round-trip behavior for both text rewriting and validated piece generation (p5, Three.js, or C2.js).

Test vendors in this order:

1. `opencode-zen`
2. `opencode-go`
3. `google`
4. `openrouter`
5. `mistral`
6. `mistral-vibe`
7. `deepseek`

## Verification Template

### Vendor Under Test

- Vendor id:
- Human label:
- Test date:
- Tester:

### Known-Good Model

- Model slug:
- Expected transport family:
- Expected endpoint:
- Expected auth style:

### Environment Preflight

- `AI_SETTINGS_ENCRYPTION_KEY` is set in the runtime environment.
- The app has been restarted after any `.env` change.
- You are signed in as the `owner` user.
- The `user_ai_vendor_settings` table exists.
- The provider account and API key are confirmed valid for this vendor.

### Settings Verification

1. Open `/admin/ai`.
2. Find the section for the vendor under test.
3. Enable that vendor.
4. Enter the known-good model slug.
5. Enter the provider API key.
6. Save successfully.
7. Confirm no validation error appears.
8. Disable AI, then re-enable it.
9. Confirm the saved model and encrypted API key are preserved for that vendor.

### Database Verification

Confirm the `user_ai_vendor_settings` row for the owner/vendor pair has:

- `enabled = 1`
- `vendor` matching the selected backend slug
- `model` matching the exact saved slug
- `encrypted_api_key` populated with a non-plaintext value

### Composer Verification

1. Open the post composer.
2. Confirm the AI vendor dropdown and `AI` button appear only when at least one vendor is `enabled` and `configured`.
3. Enter a short plain paragraph first.
4. Select the vendor under test in the dropdown.
5. Click `AI`.
6. Confirm the button shows a spinner while the request is pending.
7. Confirm the editor content is replaced on success.
8. Confirm the original draft remains unchanged on failure.
9. Confirm an error toast appears on failure.

### Interactive Piece Verification

1. Open the post composer or `/admin/pieces`.
2. Confirm the mode selector exposes `Text` and `Piece`, and the piece engine dropdown exposes `p5`, `c2`, and `Three.js`.
3. Enter a short descriptive prompt for an interactive piece.
4. Select the vendor under test.
5. Trigger piece generation.
6. Confirm the generation-progress dialog appears and shows an `Attempts` counter.
7. Confirm the dialog can be stopped manually.
8. Confirm a successful run only opens the draft preview after server validation completes.
9. Confirm the preview dialog shows attempt usage and a rendered piece.
10. Confirm the piece can be saved only from a validated draft preview.
11. Confirm failed or timed-out generation does not create a saved piece row.

### Runtime And Log Verification

- Confirm the request reaches `POST /api/ai/process`.
- Confirm interactive piece requests reach `POST /api/art-pieces/generate`.
- Confirm the logged vendor and model match the selected vendor's saved settings.
- Confirm no fallback-to-wrong-endpoint behavior occurs.
- Confirm any upstream failure returns an understandable status and error message.
- Confirm invalid HTML/CSS/JS code-block outputs trigger bounded repair attempts rather than surfacing a broken draft preview.

### Pass Or Fail

Only mark the vendor as verified if:

- settings save succeeds
- the composer round-trip succeeds
- the returned text replaces the editor content as expected
- the interactive-piece round-trip produces a validated draft that previews and saves successfully

Mark the vendor as not verified if any of these fail:

- authentication
- endpoint routing
- model recognition
- response parsing

Record the exact failure mode and the raw upstream status/message.

## Vendor-Specific Checks

### OpenCode Zen

Use a documented Zen model slug only.

Verify routing by model family:

- `gpt-*` -> `/zen/v1/responses`
- `claude-*` -> `/zen/v1/messages`
- `gemini-*` -> `/zen/v1/models/...`
- `big-pickle`, `minimax-*`, `glm-*`, `kimi-*`, `qwen*`, `nemotron-*` -> `/zen/v1/chat/completions`

Unknown Zen model slugs must fail fast before any outbound request.

### OpenCode Go

- Verify documented Go endpoint routing:
  - `glm-5.1`, `glm-5`, `kimi-k2.6`, `kimi-k2.5`, `deepseek-v4-pro`, `deepseek-v4-flash`, `mimo-v2-pro`, `mimo-v2-omni`, `mimo-v2.5-pro`, `mimo-v2.5`, `qwen3.6-plus`, `qwen3.5-plus` -> `/zen/go/v1/chat/completions`
  - `minimax-m2.7`, `minimax-m2.5` -> `/zen/go/v1/messages`
- Confirm both raw model IDs and `opencode-go/<model-id>` prefixed slugs behave correctly when saved in `/admin/ai`.
- Unknown Go model slugs must fail fast before any outbound request.

### Google

- Confirm the selected model belongs on `v1beta/models/{model}:generateContent`.
- Confirm API key query-param auth works.
- Confirm returned `candidates[].content.parts[].text` parses correctly.

### OpenRouter

- Confirm the selected model belongs on the OpenAI-compatible `chat/completions` endpoint at `https://openrouter.ai/api/v1/chat/completions`.
- Confirm Bearer auth works with the user's OpenRouter API key.
- Confirm provider-prefixed model slugs such as `anthropic/...`, `openai/...`, or `mistral/...` are accepted as saved model strings.
- Confirm returned `choices[0].message.content` parses correctly.
- Confirm the owner saved the model/API key in the `OpenRouter` section of `/admin/ai`, not an old `Kilo Gateway` row from a prior schema state.

### Mistral AI

- Confirm endpoint is `https://api.mistral.ai/v1/chat/completions`.
- Confirm Bearer auth works with the user's standard Mistral API key from `console.mistral.ai`.
- Confirm any model slug (e.g. `mistral-large-latest`, `mistral-small-latest`) is accepted as a saved model string.
- Confirm returned `choices[0].message.content` parses correctly.

### Mistral Vibe

- Confirm endpoint is `https://api.mistral.ai/v1/chat/completions`.
- Confirm Bearer auth works with the Vibe API key (obtained from `console.mistral.ai/codestral/vibe`).
- Use `mistral-vibe-cli-latest` as the known-good model slug (confirmed as of May 2026; Devstral 2 via Vibe key). Standard `-latest` aliases like `devstral-small-latest` are for the `codestral.mistral.ai` endpoint and will fail here.
- Confirm returned `choices[0].message.content` parses correctly.
- If you see "Invalid request body" (400), check: (1) the saved model slug is `mistral-vibe-cli-latest`, and (2) the vendor Zod enum in `art-pieces.ts` includes `"mistral-vibe"`.

### DeepSeek

- Confirm endpoint is `https://api.deepseek.com/chat/completions`.
- Confirm Bearer auth works with the owner's DeepSeek API key.
- Use `deepseek-v4-flash` as the default known-good model slug; use `deepseek-v4-pro` for a higher-capability manual check.
- Confirm returned `choices[0].message.content` parses correctly.
- Confirm DeepSeek appears for text improvement and validated piece generation across `p5`, `c2`, and `three`.
- Confirm DeepSeek piece-generation requests include `thinking: { type: "disabled" }` and use the larger code-generation output budget. Ordinary DeepSeek text rewriting should keep the normal chat-completions request shape.
- If piece generation fails, check the provider diagnostics for `finish_reason`, `reasoning_content` length, and `rawResponsePreview`. `finish_reason: "length"` means the response was truncated; `content_filter` means the provider filtered the final answer; `insufficient_system_resource` means an upstream resource-limit failure; non-empty `reasoning_content` with empty `message.content` means the model reasoned but did not emit usable final code.
- Confirm DeepSeek does not appear in the Admin AI "Visual descriptions" preference and that a direct `/api/ai/describe-image` request with `vendor: "deepseek"` returns `422` with `code: "vision_not_supported"`.

## Recording Template

Copy this block for each vendor test run:

```text
Vendor:
Model:
Expected endpoint:
Actual endpoint observed:
Settings save result:
Composer click result:
Output replacement result:
Interactive piece result:
Attempt counter result:
Error toast result:
DB row correct:
Upstream HTTP status:
Upstream error message:
Final verdict: verified / not verified
Follow-up fix required:
```

## Working Rules

- Use exactly one known-good model per vendor for the first pass.
- Do not broaden to multiple models until the first one is verified.
- Prefer the provider's documented mainstream or safe model first unless the point of the test is to validate a specific risky/free model such as `big-pickle`.
- Do not present a vendor as confidently working in docs or UI copy until it passes this checklist.
