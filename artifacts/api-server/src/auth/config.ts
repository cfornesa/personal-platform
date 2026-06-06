import type { ExpressAuthConfig } from "@auth/express";
import GitHub from "@auth/express/providers/github";
import Google from "@auth/express/providers/google";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { db, usersTable, accountsTable, sessionsTable, verificationTokensTable, eq, formatMysqlDateTime } from "@workspace/db";
import { autoClaimOwnerIfEligible } from "../lib/bootstrap";

// @auth/express derives the `/api/auth` base path from the Express mount.
// Letting it derive the origin from request headers avoids stale localhost,
// Replit preview, or deployment AUTH_URL values creating redirect mismatches.
delete process.env.AUTH_URL;
delete process.env.NEXTAUTH_URL;

type SessionUserWithId = {
  id?: string;
  role?: string;
  status?: string;
  name?: string | null;
  email?: string | null;
  image?: string | null;
};

export const authConfig: ExpressAuthConfig = {
  adapter: DrizzleAdapter(db, {
    usersTable,
    accountsTable,
    sessionsTable,
    verificationTokensTable,
  }),
  trustHost: true,
  secret: process.env.AUTH_SECRET,
  session: {
    strategy: "database",
  },
  providers: [
    GitHub({
      clientId: process.env.GITHUB_ID ?? "",
      clientSecret: process.env.GITHUB_SECRET ?? "",
    }),
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID ?? "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
    }),
  ],
  callbacks: {
    async session({ session, user }) {
      if (!session.user || !user?.id) {
        return session;
      }

      const dbUserRows = await db
        .select()
        .from(usersTable)
        .where(eq(usersTable.id, user.id))
        .limit(1);
      const dbUser = dbUserRows[0];

      const sessionUser = session.user as SessionUserWithId;
      sessionUser.id = user.id;
      sessionUser.role = dbUser?.role ?? "member";
      sessionUser.status = dbUser?.status ?? "active";

      return session;
    },
  },
  events: {
    async signIn({ user }) {
      if (!user?.id) {
        return;
      }

      await autoClaimOwnerIfEligible({
        userId: user.id,
        email: user.email,
      });

      await db
        .update(usersTable)
        .set({
          lastLoginAt: formatMysqlDateTime(),
          updatedAt: formatMysqlDateTime(),
        })
        .where(eq(usersTable.id, user.id));
    },
  },
};
