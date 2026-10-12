import { ORPCError } from "@orpc/server";
import { base } from "../__core/app";
import { auth } from "../auth";

export const MANAGER_EMAIL = "vanwyk@favourfarm.co.za";
export const manager = base.use(async ({ context, next }) => {
  // All private farm RPCs require the bearer, not an ambient shared-device cookie.
  if (!context.headers.get("authorization")?.startsWith("Bearer ")) {
    throw new ORPCError("UNAUTHORIZED", { message: "Sign in as the farm manager." });
  }
  const session = await auth.api.getSession({ headers: context.headers });
  if (!session)
    throw new ORPCError("UNAUTHORIZED", { message: "Sign in as the farm manager." });
  if (!session.user.emailVerified || session.user.email.toLowerCase() !== MANAGER_EMAIL) {
    throw new ORPCError("FORBIDDEN", {
      message: "Only the verified farm manager can access this screen.",
    });
  }
  return next({ context: { manager: session.user } });
});
