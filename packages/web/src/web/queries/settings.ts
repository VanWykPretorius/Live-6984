import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { orpc } from "../lib/api";

export function useSettings() {
  return useQuery(orpc.settings.get.queryOptions());
}

function useInvalidate() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: orpc.settings.key() });
    qc.invalidateQueries({ queryKey: orpc.dashboard.key() });
  };
}

export function useUpdateSettings() {
  const invalidate = useInvalidate();
  return useMutation(orpc.settings.update.mutationOptions({ onSuccess: invalidate }));
}

export function useRotateApiKey() {
  const invalidate = useInvalidate();
  return useMutation(orpc.settings.rotateApiKey.mutationOptions({ onSuccess: invalidate }));
}
