
import { APIError, betterAuth } from "better-auth";
import { createAuthMiddleware } from "better-auth/api";
import { MongoClient } from "mongodb";
import { mongodbAdapter } from "@better-auth/mongo-adapter";

const client = new MongoClient(process.env.MONGODB_URI);
const db = client.db("sceneslot-db");

/* Password policy — mirrors sceneslot-client/src/lib/password-policy.ts (the
   Express server can't import TypeScript from the Next app), so the two
   runtimes can never drift apart without a deliberate change on both sides. */
const MIN_PASSWORD_LENGTH = 8;
const PASSWORD_NUMBER_REQUIRED_MESSAGE = "Password must include at least one number.";
const PASSWORD_PATHS = ["/sign-up/email", "/change-password", "/reset-password"];

export const auth = betterAuth({
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.BETTER_AUTH_URL,

  trustedOrigins: [process.env.CLIENT_URL].filter(Boolean),

  database: mongodbAdapter(db, { client }),

  emailAndPassword: {
    enabled: true,
    /* Explicit (Better Auth's silent default is also 8) — mirrors the Next app. */
    minPasswordLength: MIN_PASSWORD_LENGTH,
  },

  /* Digit rule server-side — same hook as the Next app's auth.ts. */
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      const password = ctx.body?.password;

      if (
        PASSWORD_PATHS.includes(ctx.path) &&
        typeof password === "string" &&
        !/\d/.test(password)
      ) {
        throw new APIError("BAD_REQUEST", { message: PASSWORD_NUMBER_REQUIRED_MESSAGE });
      }
    }),
  },

  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    },
  },

  session: {
    cookieCache: {
      enabled: true,
      maxAge: 5 * 60,
      strategy: "jwt",
    },
  },
});
