import { useMemo, useRef, useState } from "react";
import { useChartBus, type ChartBusHost } from "../../useChartBus";
import { replaceAiPartition, storedAiObjects } from "../../drawingAiPersistence";
import type { Drawing } from "../../drawings";

export type TestChartBusHost = Omit<ChartBusHost, "drawingOwner"> & {
  drawingOwner?: ChartBusHost["drawingOwner"];
};

/** The owner fixture supplies the canonical collection port; the real hook,
 * reducer, normalization and command queue still execute in every existing test. */
export function useTestChartBus(host: TestChartBusHost) {
  const [collections, setCollections] = useState<Record<string, Drawing[]>>({});
  const working = useRef(collections);
  working.current = collections;
  const generation = useMemo(() => ({}), []);
  const loaded = useMemo(() => ({ ...collections,
    [host.activeSymbol]: collections[host.activeSymbol] ?? host.userDrawings,
  }), [collections, host.activeSymbol, host.userDrawings]);
  return useChartBus({ ...host, drawingOwner: host.drawingOwner ?? {
    key: "account:chart-fixture", generation, collections: loaded,
    replaceAi: (symbol, objects, hidden) => {
      const current = working.current[symbol] ?? (symbol === host.activeSymbol ? host.userDrawings : []);
      const result = replaceAiPartition(current, objects, hidden);
      if (!result.ok) return result;
      working.current = { ...working.current, [symbol]: result.drawings };
      setCollections(working.current);
      return { ok: true, objects: storedAiObjects(result.drawings) };
    },
  } });
}
