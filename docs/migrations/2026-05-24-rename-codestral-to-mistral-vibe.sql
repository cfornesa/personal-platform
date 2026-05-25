-- Rename AI vendor "codestral" → "mistral-vibe"
-- Reason: vendor is Mistral Vibe CLI-specific (api.mistral.ai, mistral-vibe-cli-latest model);
--         "codestral" is reserved for a future distinct Codestral vendor.

UPDATE user_ai_vendor_settings
  SET vendor = 'mistral-vibe'
  WHERE vendor = 'codestral';

UPDATE users
  SET preferred_art_piece_vendor   = 'mistral-vibe' WHERE preferred_art_piece_vendor   = 'codestral';
UPDATE users
  SET preferred_vendor_text_improve = 'mistral-vibe' WHERE preferred_vendor_text_improve = 'codestral';
UPDATE users
  SET preferred_vendor_alt_text    = 'mistral-vibe' WHERE preferred_vendor_alt_text    = 'codestral';
