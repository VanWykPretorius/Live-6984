import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { orpc } from "../lib/api";

export function useProducts() {
  return useQuery(orpc.products.list.queryOptions());
}

function useInvalidate() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: orpc.products.key() });
    qc.invalidateQueries({ queryKey: orpc.orders.key() });
    qc.invalidateQueries({ queryKey: orpc.subscriptions.key() });
    qc.invalidateQueries({ queryKey: orpc.dashboard.key() });
    qc.invalidateQueries({ queryKey: orpc.billing.key() });
  };
}

export function useCreateProduct() {
  const invalidate = useInvalidate();
  return useMutation(orpc.products.create.mutationOptions({ onSuccess: invalidate }));
}

export function useUpdateProduct() {
  const invalidate = useInvalidate();
  return useMutation(orpc.products.update.mutationOptions({ onSuccess: invalidate }));
}

export function useRemoveProduct() {
  const invalidate = useInvalidate();
  return useMutation(orpc.products.remove.mutationOptions({ onSuccess: invalidate }));
}

export function useRemoveAlias() {
  const invalidate = useInvalidate();
  return useMutation(orpc.products.removeAlias.mutationOptions({ onSuccess: invalidate }));
}

export function useImportProducts() {
  const invalidate = useInvalidate();
  return useMutation(orpc.products.importCsv.mutationOptions({ onSuccess: invalidate }));
}

export function useExportProducts() {
  return useMutation(orpc.products.exportCsv.mutationOptions());
}

export function useSetPrices() {
  const invalidate = useInvalidate();
  return useMutation(orpc.products.setPrices.mutationOptions({ onSuccess: invalidate }));
}
