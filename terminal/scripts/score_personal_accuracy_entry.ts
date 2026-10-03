import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  createServiceClient,
  scoreDueClaims,
} from "./score_personal_accuracy.mjs";
import {
  compareObserved,
  RESOLVER_REGISTRY,
  thresholdNumber,
} from "@/lib/personalAccuracyStore";

export {
  compareObserved,
  RESOLVER_REGISTRY,
  thresholdNumber,
};

type WorkerClient = Parameters<typeof scoreDueClaims>[0];
type WorkerOptions = {
  client?: WorkerClient;
  resolverDeps?: Parameters<typeof RESOLVER_REGISTRY[keyof typeof RESOLVER_REGISTRY]>[1];
  now?: string;
};

export async function runPersonalAccuracyNightly(
  client: WorkerClient | undefined,
  options: WorkerOptions = {},
) {
  const serviceClient = client ?? createServiceClient();
  if (!serviceClient) {
    console.error("score_personal_accuracy: service client unavailable");
    process.exit(2);
  }
  return scoreDueClaims(serviceClient, {
    registry: RESOLVER_REGISTRY,
    resolverDeps: options.resolverDeps,
    thresholdNumber,
    compareObserved,
    now: options.now,
  });
}

function isDirectRun(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return import.meta.url === pathToFileURL(resolve(entry)).href;
  } catch {
    return false;
  }
}

if (isDirectRun()) {
  runPersonalAccuracyNightly(undefined).then(
    (counts) => {
      console.log(
        `score_personal_accuracy: settled ${counts.settled}, undetermined ${counts.undetermined}, skipped ${counts.skipped}`,
      );
    },
    (error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    },
  );
}
