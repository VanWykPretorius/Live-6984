import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { orpc } from "../lib/api";

export function useOrders(statuses?: string[]) {
  return useQuery(orpc.orders.list.queryOptions({ input: statuses ? { statuses } : {} }));
}

function useInvalidate() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: orpc.orders.key() });
    qc.invalidateQueries({ queryKey: orpc.products.key() });
    qc.invalidateQueries({ queryKey: orpc.dashboard.key() });
    qc.invalidateQueries({ queryKey: orpc.billing.key() });
  };
}

export function useImportOrders() {
  const invalidate = useInvalidate();
  return useMutation(orpc.orders.importCsv.mutationOptions({ onSuccess: invalidate }));
}

export function useResolveLine() {
  const invalidate = useInvalidate();
  return useMutation(orpc.orders.resolveLine.mutationOptions({ onSuccess: invalidate }));
}

export function useUpdateLine() {
  const invalidate = useInvalidate();
  return useMutation(orpc.orders.updateLine.mutationOptions({ onSuccess: invalidate }));
}

export function useSyncPrices() {
  const invalidate = useInvalidate();
  return useMutation(orpc.orders.syncPrices.mutationOptions({ onSuccess: invalidate }));
}

export function useSetOrderStatus() {
  const invalidate = useInvalidate();
  return useMutation(orpc.orders.setStatus.mutationOptions({ onSuccess: invalidate }));
}

export function useRemoveOrder() {
  const invalidate = useInvalidate();
  return useMutation(orpc.orders.remove.mutationOptions({ onSuccess: invalidate }));
}
