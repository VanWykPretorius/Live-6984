import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { orpc } from "../lib/api";

export function useSubscriptions() {
  return useQuery(orpc.subscriptions.list.queryOptions());
}

export function useSubscriptionDeliveries(id: number | null) {
  return useQuery({
    ...orpc.subscriptions.deliveries.queryOptions({ input: { id: id ?? 0 } }),
    enabled: id !== null,
  });
}

function useInvalidate() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: orpc.subscriptions.key() });
    qc.invalidateQueries({ queryKey: orpc.dashboard.key() });
    qc.invalidateQueries({ queryKey: orpc.billing.key() });
    qc.invalidateQueries({ queryKey: orpc.customers.key() });
  };
}

export function useCreateSubscription() {
  const invalidate = useInvalidate();
  return useMutation(orpc.subscriptions.create.mutationOptions({ onSuccess: invalidate }));
}

export function useUpdateSubscription() {
  const invalidate = useInvalidate();
  return useMutation(orpc.subscriptions.update.mutationOptions({ onSuccess: invalidate }));
}

export function usePauseSubscription() {
  const invalidate = useInvalidate();
  return useMutation(orpc.subscriptions.pause.mutationOptions({ onSuccess: invalidate }));
}

export function useResumeSubscription() {
  const invalidate = useInvalidate();
  return useMutation(orpc.subscriptions.resume.mutationOptions({ onSuccess: invalidate }));
}

export function useCancelSubscription() {
  const invalidate = useInvalidate();
  return useMutation(orpc.subscriptions.cancel.mutationOptions({ onSuccess: invalidate }));
}

export function useRemoveSubscription() {
  const invalidate = useInvalidate();
  return useMutation(orpc.subscriptions.remove.mutationOptions({ onSuccess: invalidate }));
}

export function useSkipDelivery() {
  const invalidate = useInvalidate();
  return useMutation(orpc.subscriptions.skipDelivery.mutationOptions({ onSuccess: invalidate }));
}

export function useUnskipDelivery() {
  const invalidate = useInvalidate();
  return useMutation(orpc.subscriptions.unskipDelivery.mutationOptions({ onSuccess: invalidate }));
}
