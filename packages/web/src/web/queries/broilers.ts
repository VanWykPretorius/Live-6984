import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { orpc } from "../lib/api";

export function useBroilerLogOptions(enabled = true) {
  return useQuery({ ...orpc.broilers.logOptions.queryOptions(), enabled });
}

export function useBroilerOverview() {
  return useQuery(orpc.broilers.overview.queryOptions());
}

function useInvalidate() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: orpc.broilers.key() });
    void qc.invalidateQueries({ queryKey: orpc.lists.key() });
  };
}

export function useCreateBroilerBatch() {
  return useMutation(orpc.broilers.createBatch.mutationOptions({ onSuccess: useInvalidate() }));
}
export function useUpdateBroilerPlan() {
  return useMutation(orpc.broilers.updateBatchPlan.mutationOptions({ onSuccess: useInvalidate() }));
}
export function useConfirmBroilerArrival() {
  return useMutation(orpc.broilers.confirmArrival.mutationOptions({ onSuccess: useInvalidate() }));
}
export function useLogBroilerDeath() {
  return useMutation(orpc.broilers.logDeath.mutationOptions({ onSuccess: useInvalidate() }));
}
export function useLogBroilerMove() {
  return useMutation(orpc.broilers.logMove.mutationOptions({ onSuccess: useInvalidate() }));
}
export function useLogBroilerSlaughter() {
  return useMutation(orpc.broilers.logSlaughter.mutationOptions({ onSuccess: useInvalidate() }));
}
export function useLogBroilerFeed() {
  return useMutation(orpc.broilers.logFeed.mutationOptions({ onSuccess: useInvalidate() }));
}
export function useLogBroilerGas() {
  return useMutation(orpc.broilers.logGas.mutationOptions({ onSuccess: useInvalidate() }));
}
export function useSaveBroilerGasSettings() {
  return useMutation(orpc.broilers.saveGasSettings.mutationOptions({ onSuccess: useInvalidate() }));
}
export function useVoidBroilerGasMovement() {
  return useMutation(orpc.broilers.voidGasMovement.mutationOptions({ onSuccess: useInvalidate() }));
}
export function useSaveBroilerPen() {
  return useMutation(orpc.broilers.savePen.mutationOptions({ onSuccess: useInvalidate() }));
}
export function useSaveBroilerFeedType() {
  return useMutation(orpc.broilers.saveFeedType.mutationOptions({ onSuccess: useInvalidate() }));
}
export function useSaveBroilerStockProduct() {
  return useMutation(orpc.broilers.saveStockProduct.mutationOptions({ onSuccess: useInvalidate() }));
}
export function useAdjustBroilerStock() {
  return useMutation(orpc.broilers.adjustStock.mutationOptions({ onSuccess: useInvalidate() }));
}
export function useVoidBroilerEvent() {
  return useMutation(orpc.broilers.voidEvent.mutationOptions({ onSuccess: useInvalidate() }));
}
export function useVoidBroilerFeedMovement() {
  return useMutation(
    orpc.broilers.voidFeedMovement.mutationOptions({ onSuccess: useInvalidate() }),
  );
}
export function useBroilerRunStockPreview() {
  return useMutation(orpc.broilers.previewRunStock.mutationOptions());
}
export function useApplyBroilerRunStock() {
  return useMutation(orpc.broilers.applyRunStock.mutationOptions({ onSuccess: useInvalidate() }));
}
export function useReverseBroilerRunStock() {
  return useMutation(orpc.broilers.reverseRunStock.mutationOptions({ onSuccess: useInvalidate() }));
}
