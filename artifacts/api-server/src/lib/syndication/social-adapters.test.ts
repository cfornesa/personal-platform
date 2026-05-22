import { beforeEach, describe, expect, it, vi } from "vitest";
import { blueskyAdapter } from "./bluesky";
import { facebookAdapter } from "./facebook";
import { instagramAdapter } from "./instagram";
import { DEFAULT_LINKEDIN_API_VERSION, linkedinAdapter } from "./linkedin";
import { buildSourceFooter } from "./content";

vi.mock("../crypto", () => ({
  decryptSecret: vi.fn((value: string) => value),
}));

function payload(overrides: Partial<{
  featuredImageUrl: string | null;
  socialPostDrafts: { bluesky?: string; linkedin?: string; facebook?: string; instagram?: string };
}> = {}) {
  const canonicalUrl = "https://platform.example.com/posts/60";
  const footer = buildSourceFooter("CreatrWeb", canonicalUrl);
  return {
    title: "Featured headline",
    contentHtml: "<p>This is the post excerpt content for a card.</p>",
    contentFormat: "html" as const,
    canonicalUrl,
    sourceFooterHtml: footer.html,
    sourceFooterText: footer.text,
    featuredImageUrl: overrides.featuredImageUrl ?? "https://platform.example.com/media/featured.jpg",
    socialPostDrafts: overrides.socialPostDrafts ?? null,
  };
}

function jsonResponse(body: unknown, status = 200, headers?: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

describe("social POSSE adapters", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    delete process.env.LINKEDIN_API_VERSION;
  });

  it("publishes Bluesky as an external canonical card with a thumbnail", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ did: "did:plc:abc", accessJwt: "jwt" }))
      .mockResolvedValueOnce(new Response("image-bytes", { headers: { "content-type": "image/jpeg" } }))
      .mockResolvedValueOnce(jsonResponse({ blob: { $type: "blob", ref: { $link: "blob1" }, mimeType: "image/jpeg", size: 10 } }))
      .mockResolvedValueOnce(jsonResponse({ uri: "at://did:plc:abc/app.bsky.feed.post/3abc", cid: "cid" }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(blueskyAdapter.publish({
      platform: "bluesky",
      encryptedAccessToken: "app-password",
      metadata: { handle: "fornesus.bsky.social" },
    } as never, payload({ socialPostDrafts: { bluesky: "Custom Bluesky caption" } }))).resolves.toEqual({
      externalId: "at://did:plc:abc/app.bsky.feed.post/3abc",
      externalUrl: "https://bsky.app/profile/fornesus.bsky.social/post/3abc",
    });

    const createBody = JSON.parse(String(fetchMock.mock.calls[3]![1]!.body));
    expect(createBody.record.text).toContain("https://platform.example.com/posts/60");
    expect(createBody.record.embed).toEqual({
      $type: "app.bsky.embed.external",
      external: {
        uri: "https://platform.example.com/posts/60",
        title: "Featured headline",
        description: "This is the post excerpt content for a card.",
        thumb: { $type: "blob", ref: { $link: "blob1" }, mimeType: "image/jpeg", size: 10 },
      },
    });
    expect(createBody.record.facets[0].features[0].uri).toBe("https://platform.example.com/posts/60");
  });

  it("publishes LinkedIn as an article post using the current version header", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("image-bytes", { headers: { "content-type": "image/png" } }))
      .mockResolvedValueOnce(jsonResponse({ value: { uploadUrl: "https://upload.linkedin.test/image", image: "urn:li:image:thumb1" } }))
      .mockResolvedValueOnce(new Response(null, { status: 201 }))
      .mockResolvedValueOnce(new Response(null, { status: 201, headers: { "x-restli-id": "urn:li:share:123" } }));
    vi.stubGlobal("fetch", fetchMock);

    await linkedinAdapter.publish({
      platform: "linkedin",
      encryptedAccessToken: "linkedin-token",
      metadata: { personId: "person-1", profileUrl: "fornesus" },
    } as never, payload({ socialPostDrafts: { linkedin: "Custom LinkedIn caption" } }));

    const postInit = fetchMock.mock.calls[3]![1]!;
    expect(postInit.headers).toEqual(expect.objectContaining({
      "LinkedIn-Version": DEFAULT_LINKEDIN_API_VERSION,
      "X-Restli-Protocol-Version": "2.0.0",
    }));
    const body = JSON.parse(String(postInit.body));
    expect(body.commentary).toContain("https://platform.example.com/posts/60");
    expect(body.content.article).toEqual({
      source: "https://platform.example.com/posts/60",
      title: "Featured headline",
      description: "This is the post excerpt content for a card.",
      thumbnail: "urn:li:image:thumb1",
    });
  });

  it("publishes Facebook Page posts as link-card feed posts even with a featured image", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({ id: "page_456" }));
    vi.stubGlobal("fetch", fetchMock);

    await facebookAdapter.publish({
      platform: "facebook",
      encryptedAccessToken: "page-token",
      metadata: { pageId: "page", username: "creatr" },
    } as never, payload({ socialPostDrafts: { facebook: "Custom Facebook caption" } }));

    expect(fetchMock.mock.calls[0]![0]).toBe("https://graph.facebook.com/v20.0/page/feed");
    const body = JSON.parse(String(fetchMock.mock.calls[0]![1]!.body));
    expect(body.link).toBe("https://platform.example.com/posts/60");
    expect(body.message).toContain("https://platform.example.com/posts/60");
  });

  it("keeps Instagram as an image post and includes the canonical URL in the caption", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ id: "container-1" }))
      .mockResolvedValueOnce(jsonResponse({ id: "media-1" }));
    vi.stubGlobal("fetch", fetchMock);

    await instagramAdapter.publish({
      platform: "instagram",
      encryptedAccessToken: "page-token",
      metadata: { igUserId: "ig-user", igUsername: "creatr" },
    } as never, payload({ socialPostDrafts: { instagram: "Custom Instagram caption" } }));

    const body = JSON.parse(String(fetchMock.mock.calls[0]![1]!.body));
    expect(body.image_url).toBe("https://platform.example.com/media/featured.jpg");
    expect(body.caption).toContain("https://platform.example.com/posts/60");
  });
});
