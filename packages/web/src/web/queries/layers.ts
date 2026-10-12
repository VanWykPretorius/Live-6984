import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { orpc } from "../lib/api";

export function useLayerLogOptions(enabled = true) {
  return useQuery({ ...orpc.layers.logOptions.queryOptions(), enabled });
}

export function useLayerOverview() {
  return useQuery(orpc.layers.overview.queryOptions());
}

function useInvalidate() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: orpc.layers.key() });
    void qc.invalidateQueries({ queryKey: orpc.broilers.key() });
    void qc.invalidateQueries({ queryKey: orpc.lists.key() });
  };
}

export function useLogEggCollection() {
  return useMutation(orpc.layers.logCollection.mutationOptions({ onSuccess: useInvalidate() }));
}
export function useLogLayerBirdEvent() {
  return useMutation(orpc.layers.logBirdEvent.mutationOptions({ onSuccess: useInvalidate() }));
}
export function useLogLayerFeed() {
  return useMutation(orpc.layers.logFeed.mutationOptions({ onSuccess: useInvalidate() }));
}
export function useVoidLayerFeedMovement() {
  return useMutation(orpc.layers.voidFeedMovement.mutationOptions({ onSuccess: useInvalidate() }));
}
export function useVoidEggCollection() {
  return useMutation(orpc.layers.voidCollection.mutationOptions({ onSuccess: useInvalidate() }));
}
export function useVoidLayerBirdEvent() {
  return useMutation(orpc.layers.voidBirdEvent.mutationOptions({ onSuccess: useInvalidate() }));
}
export function useSaveEggMobile() {
  return useMutation(orpc.layers.saveMobile.mutationOptions({ onSuccess: useInvalidate() }));
}
export function useSaveEggStockProduct() {
  return useMutation(orpc.layers.saveEggProduct.mutationOptions({ onSuccess: useInvalidate() }));
}
export function useAdjustEggStock() {
  return useMutation(orpc.layers.adjustStock.mutationOptions({ onSuccess: useInvalidate() }));
}
