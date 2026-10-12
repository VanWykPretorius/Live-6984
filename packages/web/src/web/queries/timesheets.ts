import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { client, orpc } from "../lib/api";
import { downloadCsv } from "../lib/format";

export function useTimeOptions() {
  return useQuery(orpc.timesheets.options.queryOptions());
}
export function useTimeDay(employeeId: number | null, date: string) {
  return useQuery({
    ...orpc.timesheets.day.queryOptions({ input: { employeeId: employeeId ?? 0, date } }),
    enabled: employeeId !== null,
  });
}
export function useTimeHistory(employeeId: number | null, from: string, to: string) {
  return useQuery({
    ...orpc.timesheets.history.queryOptions({ input: { employeeId: employeeId ?? 0, from, to } }),
    enabled: employeeId !== null,
  });
}
export function useManagerSession() {
  return useQuery({
    ...orpc.timesheets.managerSession.queryOptions(),
    retry: false,
    retryOnMount: false,
    refetchOnWindowFocus: true,
    refetchInterval: 60_000,
  });
}
export function useReviewList(from: string, to: string) {
  return useQuery(orpc.timesheets.reviewList.queryOptions({ input: { from, to } }));
}
export function useTimeSetup() {
  return useQuery(orpc.timesheets.setup.queryOptions());
}
export function useClearManagerCache() {
  const qc = useQueryClient();
  return useCallback(() => {
    void qc.cancelQueries().then(() => qc.clear());
  }, [qc]);
}
function useInvalidate() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: orpc.timesheets.key() });
}
export function useSaveTime() {
  return useMutation(orpc.timesheets.save.mutationOptions({ onSuccess: useInvalidate() }));
}
export function useReviewTime() {
  return useMutation(orpc.timesheets.review.mutationOptions({ onSuccess: useInvalidate() }));
}
export function useDeleteTimesheetDay() {
  return useMutation(orpc.timesheets.deleteDay.mutationOptions({ onSuccess: useInvalidate() }));
}
export function useSaveEmployee() {
  return useMutation(orpc.timesheets.saveEmployee.mutationOptions({ onSuccess: useInvalidate() }));
}
export function useSaveProject() {
  return useMutation(orpc.timesheets.saveProject.mutationOptions({ onSuccess: useInvalidate() }));
}
export function useSetManagerPassword() {
  return useMutation(orpc.timesheets.setPassword.mutationOptions());
}
export function useExportTimes() {
  return useMutation({
    mutationFn: async (input: { from: string; to: string }) => {
      const result = await client.timesheets.exportCsv(input);
      downloadCsv(result.fileName, result.csv);
      return result;
    },
  });
}
