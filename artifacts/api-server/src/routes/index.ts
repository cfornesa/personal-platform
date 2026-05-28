import { Router, type IRouter } from "express";
import healthRouter from "./health";
import postsRouter from "./posts";
import commentsRouter from "./comments";
import mediaRouter from "./media";
import usersRouter from "./users";
import siteSettingsRouter from "./site-settings";
import feedSourcesRouter from "./feed-sources";
import pendingPostsRouter from "./pending-posts";
import categoriesRouter from "./categories";
import navLinksRouter from "./nav-links";
import pagesRouter from "./pages";
import feedsCatalogRouter from "./feeds-catalog";
import aiRouter from "./ai";
import platformConnectionsRouter from "./platform-connections";
import platformOAuthRouter from "./platform-oauth";
import platformOAuthAppsRouter from "./platform-oauth-apps";
import artPiecesRouter from "./art-pieces";
import exhibitsRouter from "./exhibits";

const router: IRouter = Router();

router.use(healthRouter);
// Pending-posts router registers `/posts/pending`, `/posts/:id/approve`,
// `/posts/:id/reject`. Mount it BEFORE the generic posts router so the
// `/posts/pending` literal doesn't get swallowed by the `/posts/:id`
// catch-all in posts.ts.
router.use(pendingPostsRouter);
// Categories router registers `/categories` and `/categories/:slug` —
// no overlap with /posts but kept early so any future cross-feature
// middleware sits in front of it.
router.use(categoriesRouter);
router.use(postsRouter);
router.use(commentsRouter);
router.use(mediaRouter);
router.use(usersRouter);
router.use(aiRouter);
router.use(artPiecesRouter);
router.use(exhibitsRouter);
router.use(siteSettingsRouter);
router.use(feedSourcesRouter);
router.use(navLinksRouter);
// Pages router registers `/pages` and `/pages/:slug | :id`. Mounted
// after categories so neither route can swallow `/categories/...`.
router.use(pagesRouter);
// Public feeds catalog (`/api/feeds`) — separate from the inbound
// feed-sources router which lives under `/feeds/...` paths inside
// `feedSourcesRouter`. The top-level `/feeds` GET registered here
// does not collide because feed-sources mounts only nested paths.
router.use(feedsCatalogRouter);
router.use(platformConnectionsRouter);
router.use(platformOAuthRouter);
router.use(platformOAuthAppsRouter);

export default router;
