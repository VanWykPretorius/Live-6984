import { useCallback, useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Redirect, useLocation } from "wouter";
import { Layout } from "./layout";
import { Loading } from "./ui/misc";
import Timesheets from "@/pages/timesheets";
import { useManagerSession } from "@/queries/timesheets";
import { signOutManager } from "@/lib/auth";

/** Gate before private pages mount, so their queries never run anonymously. */
export function FarmAccess({ children }: { children: React.ReactNode }) {
  const [location, navigate] = useLocation();
  const session = useManagerSession();
  const qc = useQueryClient();
  const authenticated = !!session.data && !session.error;
  const wasAuthenticated = useRef(false);
  const logout = useCallback(async () => {
    // Clear locally even if the server cannot be reached during sign-out.
    const request = signOutManager().catch(() => {});
    await qc.cancelQueries();
    qc.clear();
    navigate("/lists");
    await request;
  }, [qc, navigate]);

  useEffect(() => {
    if (wasAuthenticated.current && !authenticated) {
      void qc.cancelQueries().then(() => qc.clear());
    }
    wasAuthenticated.current = authenticated;
  }, [authenticated, qc]);

  useEffect(() => {
    if (!authenticated) return;
    let timer: ReturnType<typeof setTimeout>;
    const reset = () => {
      clearTimeout(timer);
      timer = setTimeout(() => void logout(), 10 * 60 * 1000);
    };
    reset();
    window.addEventListener("pointerdown", reset);
    window.addEventListener("keydown", reset);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("pointerdown", reset);
      window.removeEventListener("keydown", reset);
    };
  }, [authenticated, logout]);

  if (location === "/" && !authenticated && !session.isLoading) {
    return <Redirect to="/lists" />;
  }
  const publicPage = location === "/lists" || location === "/timesheets";
  return (
    <Layout authenticated={authenticated} onLogout={() => void logout()}>
      {!publicPage && session.isLoading ? (
        <Loading label="Checking manager access" />
      ) : !publicPage && !authenticated ? (
        <Timesheets />
      ) : children}
    </Layout>
  );
}