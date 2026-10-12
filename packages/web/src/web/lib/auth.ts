import { createAuthClient } from "better-auth/react";
import { managedAuthClient } from "@runablehq/managed-auth/client";

export const authClient = createAuthClient({
  baseURL: import.meta.env.VITE_WEBSITE_URL ?? window.location.origin,
  basePath: "/api/auth",
  plugins: [
    managedAuthClient({
      applicationId: import.meta.env.VITE_APPLICATION_ID,
      issuer: import.meta.env.VITE_RUNABLE_AUTH_ISSUER,
    }),
  ],
  fetchOptions: {
    auth: { type: "Bearer", token: () => sessionStorage.getItem("farm-manager-email-token") ?? "" },
    onSuccess: (ctx) => {
      const token = ctx.response.headers.get("set-auth-token");
      if (token) sessionStorage.setItem("farm-manager-email-token", token);
    },
  },
});

export function managerToken() {
  return (
    authClient.managedAuth.getToken() || sessionStorage.getItem("farm-manager-email-token") || ""
  );
}

export async function signOutManager() {
  try {
    const token = managerToken();
    const request = authClient.signOut({ fetchOptions: {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    } });
    authClient.managedAuth.clearToken();
    sessionStorage.removeItem("farm-manager-email-token");
    await request;
  } finally {
    authClient.managedAuth.clearToken();
    sessionStorage.removeItem("farm-manager-email-token");
  }
}
