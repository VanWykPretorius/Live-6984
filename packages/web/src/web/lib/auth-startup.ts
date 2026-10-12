import { authClient } from "./auth";

// Top-level OAuth redirects finish once at startup; popup sign-in completes in place.
void authClient.managedAuth.handleRedirect().catch((error: unknown) => {
  console.error("Manager sign-in could not be completed", error);
});
