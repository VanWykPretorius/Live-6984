import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { orpc } from "../lib/api";

export function useCustomers() {
  return useQuery(orpc.customers.list.queryOptions());
}

function useInvalidate() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: orpc.customers.key() });
    qc.invalidateQueries({ queryKey: orpc.subscriptions.key() });
    qc.invalidateQueries({ queryKey: orpc.dashboard.key() });
  };
}

export function useCreateCustomer() {
  const invalidate = useInvalidate();
  return useMutation(orpc.customers.create.mutationOptions({ onSuccess: invalidate }));
}

export function useUpdateCustomer() {
  const invalidate = useInvalidate();
  return useMutation(orpc.customers.update.mutationOptions({ onSuccess: invalidate }));
}

export function useRemoveCustomer() {
  const invalidate = useInvalidate();
  return useMutation(orpc.customers.remove.mutationOptions({ onSuccess: invalidate }));
}
