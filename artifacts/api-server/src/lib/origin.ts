import type { Request } from "express";

/**
 * Resolves the canonical origin for the site.
 * 
 * Priority:
 * 1. The first entry in the ALLOWED_ORIGINS environment variable.
 *    NOTE: This should be the primary public frontend origin (e.g. 
 *    http://localhost:4000 for local dev or https://chrisfornesa.com 
 *    for production) so that internal links (VR, etc.) resolve 
 *    correctly.
 * 2. The PUBLIC_SITE_URL environment variable.
 * 3. The incoming request's protocol and host (if provided).
 * 4. A hardcoded fallback to platform.creatrweb.com.
 */
export function getCanonicalOrigin(req?: Request): string {
  // 1. ALLOWED_ORIGINS (canonical set by operator)
  const allowed = process.env.ALLOWED_ORIGINS;
  if (allowed) {
    const first = allowed.split(",")[0]?.trim();
    if (first) return first.replace(/\/$/, "");
  }

  // 2. PUBLIC_SITE_URL (legacy/override)
  const siteUrl = process.env.PUBLIC_SITE_URL?.trim();
  if (siteUrl) return siteUrl.replace(/\/$/, "");

  // 3. Request headers (dynamic)
  if (req) {
    const forwardedProto = req.header("x-forwarded-proto");
    const forwardedHost = req.header("x-forwarded-host");
    const protocol = forwardedProto?.split(",")[0]?.trim() || req.protocol;
    const host = forwardedHost?.split(",")[0]?.trim() || req.get("host");
    if (protocol && host) {
      return `${protocol}://${host}`;
    }
  }

  // 4. Ultimate fallback
  return "https://platform.creatrweb.com";
}
