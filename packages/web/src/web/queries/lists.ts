import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { client, orpc } from "../lib/api";
import { downloadCsv } from "../lib/format";

export type WeeklyList = "harvest" | "meat" | "eggs" | "veldwonder" | "milkwood";

export function useRuns() {
  return useQuery(orpc.lists.runs.queryOptions());
}

export function useRunDetail(runId: number | null) {
  return useQuery({
    ...orpc.lists.detail.queryOptions({ input: { runId: runId ?? 0 } }),
    enabled: runId !== null,
  });
}

function useInvalidate() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: orpc.lists.key() });
}

export function useImportReport() {
  const invalidate = useInvalidate();
  return useMutation(orpc.lists.importReport.mutationOptions({ onSuccess: invalidate }));
}

export function useSaveRecipe() {
  const invalidate = useInvalidate();
  return useMutation(orpc.lists.saveRecipe.mutationOptions({ onSuccess: invalidate }));
}

export function useRemoveRun() {
  const invalidate = useInvalidate();
  return useMutation(orpc.lists.removeRun.mutationOptions({ onSuccess: invalidate }));
}

/** Fetch one weekly list and push it to the browser as a CSV download. */
export function useExportList() {
  return useMutation({
    mutationFn: async (input: { runId: number; list: WeeklyList }) => {
      const res = await client.lists.exportCsv(input);
      downloadCsv(res.fileName, res.csv);
      return res;
    },
  });
}
