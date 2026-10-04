let scoringPasses = 0;

function chain(onThen) {
  return new Proxy({}, {
    get(_target, property) {
      if (property === "then" && onThen) {
        return onThen;
      }
      return () => chain(onThen);
    },
  });
}

export function createClient() {
  scoringPasses += 1;
  console.log(`BUNDLE_SCORING_PASSES=${scoringPasses}`);
  const client = {
    from(table) {
      if (table === "user_claims") {
        return {
          select() { return chain(() => Promise.resolve({ data: [], error: null })); },
          update() { return chain(() => Promise.resolve({ error: null })); },
        };
      }
      return {};
    },
  };
  process.nextTick(() => {
    console.log("score_personal_accuracy: settled 0, undetermined 0, skipped 0");
  });
  return client;
}
