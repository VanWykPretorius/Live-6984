import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { client, orpc } from "../lib/api";
import { downloadCsv } from "../lib/format";

/** Fetch one stored batch and push it to the browser as a file download. */
export function useDownloadBatch() {
  return useMutation({
    mutationFn: async (id: number) => {
      const batch = await client.billing.batch({ id });
      downloadCsv(batch.fileName, batch.csv);
      return batch;
    },
  });
}

export function useDefaultRange() {
  return useQuery(orpc.billing.defaultRange.queryOptions());
}

export function useBillingPreview(from: string, to: string) {
  return useQuery(orpc.billing.preview.queryOptions({ input: { from, to } }));
}

export function useCombinedOptions(from: string, to: string) {
  return useQuery({
    ...orpc.billing.combinedOptions.queryOptions({ input: { from, to } }),
    enabled: Boolean(from && to && from <= to),
  });
}

export function useCombinedPreview() {
  return useMutation(orpc.billing.combinedPreview.mutationOptions());
}

export function useRunCombined() {
  return useMutation(orpc.billing.runCombined.mutationOptions({ onSuccess: useInvalidate() }));
}

export function useBatches() {
  return useQuery(orpc.billing.batches.queryOptions());
}

export function useBatch(id: number | null) {
  return useQuery({
    ...orpc.billing.batch.queryOptions({ input: { id: id ?? 0 } }),
    enabled: id !== null,
  });
}

function useInvalidate() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: orpc.billing.key() });
    qc.invalidateQueries({ queryKey: orpc.orders.key() });
    qc.invalidateQueries({ queryKey: orpc.subscriptions.key() });
    qc.invalidateQueries({ queryKey: orpc.dashboard.key() });
  };
}

export function useRunSubscriptions() {
  const invalidate = useInvalidate();
  return useMutation(orpc.billing.runSubscriptions.mutationOptions({ onSuccess: invalidate }));
}

export function useRunOrders() {
  const invalidate = useInvalidate();
  return useMutation(orpc.billing.runOrders.mutationOptions({ onSuccess: invalidate }));
}

export function useVoidBatch() {
  const invalidate = useInvalidate();
  return useMutation(orpc.billing.voidBatch.mutationOptions({ onSuccess: invalidate }));
}

export function useRemoveBatch() {
  const invalidate = useInvalidate();
  return useMutation(orpc.billing.removeBatch.mutationOptions({ onSuccess: invalidate }));
}
