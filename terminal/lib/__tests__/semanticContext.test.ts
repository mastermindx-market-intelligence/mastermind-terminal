import { describe, expect, it } from "vitest";
import {
  createSemanticContextCoordinator,
  matchesSemanticContextGeneration,
  validateSemanticContextDelta,
  validateSemanticContextGroup,
  validateSemanticContextValue,
  type SemanticContextGroup,
  type SemanticContextTransformAdapter,
} from "@/lib/semanticContext";
import {
  investigationSubjectsToSemanticValue,
  semanticSecurityFromAiContextV1,
  semanticHistoricalCutoffFromReplay,
  semanticEntityFromMarketOntology,
} from "@/lib/semanticContextAdapters";

const securityAapl = {
  kind: "entity_selection" as const,
  ref: { owner: "terminal.analysis_symbol", kind: "security", object_id: "AAPL" },
};

const baseGroup = (): SemanticContextGroup => ({
  schema: "semantic_context_group.v1",
  session_epoch: "epoch-1",
  group_id: "primary-security",
  revision: 0,
  kind: "entity_selection",
  label: "Primary security",
  value: securityAapl,
  ports: [
    {
      port_id: "chart.primary",
      origin_id: "chart-origin",
      direction: "both",
      mode: "linked",
      accepts: ["entity_selection"],
      ref_accepts: [{ owner: "terminal.analysis_symbol", kinds: ["security"] }],
      temporal_capabilities: ["live"],
    },
    {
      port_id: "brain.scope",
      origin_id: "brain-origin",
      direction: "consume",
      mode: "linked",
      accepts: ["entity_selection"],
      ref_accepts: [{ owner: "terminal.analysis_symbol", kinds: ["security"] }],
      temporal_capabilities: ["live"],
    },
    {
      port_id: "chart.pinned",
      origin_id: "pinned-origin",
      direction: "both",
      mode: "pinned",
      accepts: ["entity_selection"],
      ref_accepts: [{ owner: "terminal.analysis_symbol", kinds: ["security"] }],
      temporal_capabilities: ["live"],
    },
    {
      port_id: "chart.local",
      origin_id: "local-origin",
      direction: "both",
      mode: "local",
      accepts: ["entity_selection"],
      ref_accepts: [{ owner: "terminal.analysis_symbol", kinds: ["security"] }],
      temporal_capabilities: ["live"],
    },
    {
      port_id: "set.consumer",
      origin_id: "set-origin",
      direction: "consume",
      mode: "linked",
      accepts: ["entity_set"],
      ref_accepts: [{ owner: "terminal.analysis_symbol", kinds: ["security"] }],
      adapter_id: "selection_to_set",
      temporal_capabilities: ["live"],
    },
  ],
});

function withoutReferenceSupport(port: SemanticContextGroup["ports"][number]) {
  const copy = { ...port };
  delete copy.ref_accepts;
  return copy;
}

const delta = (overrides: Record<string, unknown> = {}) => ({
  schema: "semantic_context_delta.v1",
  session_epoch: "epoch-1",
  group_id: "primary-security",
  base_revision: 0,
  mutation_id: "mutation-1",
  origin_id: "chart-origin",
  patch: {
    kind: "entity_selection",
    ref: { owner: "terminal.analysis_symbol", kind: "security", object_id: "NVDA" },
  },
  cause: "user_action",
  ...overrides,
});

const wrapSelection: SemanticContextTransformAdapter = {
  adapter_id: "selection_to_set",
  from_kind: "entity_selection",
  to_kind: "entity_set",
  project(value) {
    if (value.kind !== "entity_selection") return { ok: false, reason: "incompatible" };
    return { ok: true, value: { kind: "entity_set", refs: [value.ref] } };
  },
};

describe("semantic context contract — closed mounted-session state", () => {
  it("accepts one closed group with bounded ports and exact typed value", () => {
    expect(validateSemanticContextGroup(baseGroup())).toEqual({ ok: true, value: baseGroup() });
  });

  it("rejects hidden authority, unsafe revisions, duplicate ports and unknown kinds", () => {
    expect(validateSemanticContextGroup({ ...baseGroup(), user_id: "forged" }).ok).toBe(false);
    expect(validateSemanticContextGroup({ ...baseGroup(), revision: -1 }).ok).toBe(false);
    expect(validateSemanticContextGroup({
      ...baseGroup(),
      ports: [...baseGroup().ports, baseGroup().ports[0]],
    }).ok).toBe(false);
    expect(validateSemanticContextGroup({ ...baseGroup(), kind: "ticker_guess" }).ok).toBe(false);
  });

  it("admits only deliberate user/restore deltas and rejects data-arrival emitters", () => {
    expect(validateSemanticContextDelta(delta()).ok).toBe(true);
    expect(validateSemanticContextDelta(delta({ cause: "explicit_restore" })).ok).toBe(true);
    expect(validateSemanticContextDelta(delta({ cause: "data_arrival" })).ok).toBe(false);
    expect(validateSemanticContextDelta(delta({ receipt: "ack" })).ok).toBe(false);
  });

  it("preserves exact entity identity and refuses duplicate entity-set identities", () => {
    const setGroup = {
      ...baseGroup(),
      kind: "entity_set",
      value: {
        kind: "entity_set",
        refs: [
          { owner: "terminal.analysis_symbol", kind: "security", object_id: "NVDA" },
          { owner: "macro.theme_registry", kind: "theme", object_id: "theme:ai" },
        ],
      },
      ports: baseGroup().ports.map(port => ({
        ...port,
        accepts: ["entity_set"],
        ref_accepts: [
          { owner: "terminal.analysis_symbol", kinds: ["security"] },
          { owner: "macro.theme_registry", kinds: ["theme"] },
        ],
      })),
    };
    expect(validateSemanticContextGroup(setGroup).ok).toBe(true);
    const duplicate = structuredClone(setGroup);
    duplicate.value.refs.push({ ...duplicate.value.refs[0] });
    expect(validateSemanticContextGroup(duplicate).ok).toBe(false);
  });

  it("requires a timezone-bearing historical cutoff and keeps scenario refs versioned", () => {
    const historical = {
      ...baseGroup(),
      kind: "historical_cutoff",
      value: { kind: "historical_cutoff", policy: "as_known", cutoff: "2026-10-03T14:30:00.000Z" },
      ports: baseGroup().ports.map(port => ({
        ...withoutReferenceSupport(port),
        accepts: ["historical_cutoff"],
        temporal_capabilities: ["as_known"],
      })),
    };
    expect(validateSemanticContextGroup(historical).ok).toBe(true);
    expect(validateSemanticContextGroup({
      ...historical,
      value: { kind: "historical_cutoff", policy: "as_known", cutoff: "2026-10-03" },
    }).ok).toBe(false);

    expect(validateSemanticContextGroup({
      ...baseGroup(),
      kind: "scenario_selection",
      value: {
        kind: "scenario_selection",
        ref: { owner: "macro.scenario_recipe", object_id: "recipe-1", version_ref: "v1" },
      },
      ports: baseGroup().ports.map(port => ({
        ...port,
        accepts: ["scenario_selection"],
        ref_accepts: [{ owner: "macro.scenario_recipe", kinds: ["scenario"] }],
        temporal_capabilities: ["scenario"],
      })),
    }).ok).toBe(true);
  });
});

describe("semantic context coordinator — one accepted generation per deliberate mutation", () => {
  it("applies linked ports, preserves pinned/local ports and uses only a named transform", () => {
    const coordinator = createSemanticContextCoordinator(baseGroup(), [wrapSelection]);
    const result = coordinator.apply(delta());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.changed).toBe(true);
    expect(result.snapshot.revision).toBe(1);
    expect(result.snapshot.value).toEqual(delta().patch);
    expect(result.receipt.accepted_revision).toBe(1);
    expect(result.receipt.applied_ports).toEqual(["brain.scope", "set.consumer"]);
    expect(result.receipt.pinned_ports).toEqual(["chart.pinned"]);
    expect(result.receipt.rejected_ports).toEqual([{ port_id: "chart.local", reason: "local" }]);
    expect(result.deliveries).toEqual([
      { port_id: "brain.scope", value: delta().patch },
      { port_id: "set.consumer", value: { kind: "entity_set", refs: [(delta().patch as typeof securityAapl).ref] } },
    ]);
  });

  it("reports a missing transform rather than coercing an entity into another kind", () => {
    const coordinator = createSemanticContextCoordinator(baseGroup());
    const result = coordinator.apply(delta());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.receipt.missing_adapters).toEqual([{
      port_id: "set.consumer",
      from_kind: "entity_selection",
      to_kinds: ["entity_set"],
      adapter_id: "selection_to_set",
    }]);
    expect(result.receipt.applied_ports).toEqual(["brain.scope"]);
  });

  it("rejects stale bases and wrong epochs without changing the group", () => {
    const coordinator = createSemanticContextCoordinator(baseGroup(), [wrapSelection]);
    const stale = coordinator.apply(delta({ base_revision: 9 }));
    expect(stale.ok).toBe(false);
    expect(stale.snapshot.revision).toBe(0);
    expect(stale.receipt.collisions).toEqual([{ code: "stale_base", expected: 0, received: 9 }]);

    const wrongEpoch = coordinator.apply(delta({ session_epoch: "old-epoch" }));
    expect(wrongEpoch.ok).toBe(false);
    expect(wrongEpoch.snapshot.revision).toBe(0);
    expect(wrongEpoch.receipt.collisions).toEqual([{ code: "epoch_mismatch" }]);
  });

  it("refuses emitters that are pinned, local, unknown or consume-only", () => {
    for (const origin_id of ["pinned-origin", "local-origin", "brain-origin", "unknown-origin"]) {
      const coordinator = createSemanticContextCoordinator(baseGroup(), [wrapSelection]);
      const result = coordinator.apply(delta({ origin_id }));
      expect(result.ok, origin_id).toBe(false);
      expect(result.snapshot.revision).toBe(0);
    }
  });

  it("deduplicates the exact mutation but conflicts on same id with changed body", () => {
    const coordinator = createSemanticContextCoordinator(baseGroup(), [wrapSelection]);
    const first = coordinator.apply(delta());
    expect(first.ok).toBe(true);
    const replay = coordinator.apply(delta());
    expect(replay.ok).toBe(true);
    if (replay.ok) {
      expect(replay.replayed).toBe(true);
      expect(replay.snapshot.revision).toBe(1);
    }
    const conflict = coordinator.apply(delta({
      base_revision: 1,
      patch: {
        kind: "entity_selection",
        ref: { owner: "terminal.analysis_symbol", kind: "security", object_id: "MSFT" },
      },
    }));
    expect(conflict.ok).toBe(false);
    expect(conflict.receipt.collisions).toEqual([{ code: "mutation_conflict" }]);
    expect(conflict.snapshot.revision).toBe(1);
  });

  it("does not publish a new generation for a new operation that repeats the current value", () => {
    const coordinator = createSemanticContextCoordinator(baseGroup(), [wrapSelection]);
    const noChange = coordinator.apply(delta({
      mutation_id: "mutation-same",
      patch: securityAapl,
    }));
    expect(noChange.ok).toBe(true);
    if (!noChange.ok) return;
    expect(noChange.changed).toBe(false);
    expect(noChange.snapshot.revision).toBe(0);
    expect(noChange.deliveries).toEqual([]);
  });

  it("reports temporal mismatches instead of feeding historical context into live-only ports", () => {
    const group: SemanticContextGroup = {
      schema: "semantic_context_group.v1",
      session_epoch: "epoch-time",
      group_id: "cutoff",
      revision: 0,
      kind: "historical_cutoff",
      label: "As known",
      value: { kind: "historical_cutoff", policy: "as_known", cutoff: "2026-10-03T14:30:00.000Z" },
      ports: [
        { port_id: "picker", origin_id: "picker-origin", direction: "emit", mode: "linked", accepts: ["historical_cutoff"], temporal_capabilities: ["as_known"] },
        { port_id: "qualified", origin_id: "qualified-origin", direction: "consume", mode: "linked", accepts: ["historical_cutoff"], temporal_capabilities: ["as_known"] },
        { port_id: "live-only", origin_id: "live-origin", direction: "consume", mode: "linked", accepts: ["historical_cutoff"], temporal_capabilities: ["live"] },
      ],
    };
    const coordinator = createSemanticContextCoordinator(group);
    const result = coordinator.apply({
      schema: "semantic_context_delta.v1",
      session_epoch: "epoch-time",
      group_id: "cutoff",
      base_revision: 0,
      mutation_id: "time-1",
      origin_id: "picker-origin",
      patch: { kind: "historical_cutoff", policy: "as_known", cutoff: "2026-10-03T15:00:00.000Z" },
      cause: "user_action",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.receipt.applied_ports).toEqual(["qualified"]);
    expect(result.receipt.temporal_mismatches).toEqual([{
      port_id: "live-only",
      requested: "as_known",
      supported: ["live"],
    }]);
  });

  it("rejects late data/results by exact session/group/revision generation", () => {
    const coordinator = createSemanticContextCoordinator(baseGroup(), [wrapSelection]);
    expect(matchesSemanticContextGeneration(coordinator.snapshot(), {
      session_epoch: "epoch-1", group_id: "primary-security", revision: 0,
    })).toBe(true);
    coordinator.apply(delta());
    expect(matchesSemanticContextGeneration(coordinator.snapshot(), {
      session_epoch: "epoch-1", group_id: "primary-security", revision: 0,
    })).toBe(false);
    expect(matchesSemanticContextGeneration(coordinator.snapshot(), {
      session_epoch: "epoch-1", group_id: "primary-security", revision: 1,
    })).toBe(true);
  });
});

describe("existing-owner adapters stay honest", () => {
  it("maps ai_context_client.v1 security only to the existing Terminal symbol owner", () => {
    const value = semanticSecurityFromAiContextV1({
      schema: "ai_context_client.v1",
      origin_id: "origin",
      context_revision: 4,
      captured_at: "2026-10-05T06:00:00.000Z",
      pinned: [],
      active: { type: "security", id: "NVDA" },
      ambient: { symbol: "NVDA", timeframe: "1D", page: "analysis", panel: "company" },
    });
    expect(value).toEqual({
      status: "qualified",
      value: {
        kind: "entity_selection",
        ref: { owner: "terminal.analysis_symbol", kind: "security", object_id: "NVDA" },
      },
    });
  });

  it("turns validated Investigation subjects into a subject set without inventing relationships", () => {
    expect(investigationSubjectsToSemanticValue([
      { owner: "terminal.analysis_symbol", kind: "security", object_id: "NVDA" },
      { owner: "macro.theme_registry", kind: "theme", object_id: "theme:ai", version_ref: "42" },
    ], [
      { owner: "terminal.analysis_symbol", kinds: ["security"] },
      { owner: "macro.theme_registry", kinds: ["theme"] },
    ])).toEqual({
      status: "qualified",
      value: {
        kind: "entity_set",
        refs: [
          { owner: "terminal.analysis_symbol", kind: "security", object_id: "NVDA" },
          { owner: "macro.theme_registry", kind: "theme", object_id: "theme:ai", version_ref: "42" },
        ],
      },
    });
  });

  it("does not relabel Options replay position as an AS_KNOWN cutoff", () => {
    expect(semanticHistoricalCutoffFromReplay({
      active: true,
      asOfStamp: "1430",
      atHead: false,
      live: false,
      archived: true,
      sessionDate: "2026-09-30",
      offHead: true,
    })).toEqual({
      status: "unsupported",
      reason: "session_replay_is_not_knowledge_cutoff",
    });
  });

  it("does not promote MarketOntology navigation labels into canonical owner identity", () => {
    expect(semanticEntityFromMarketOntology({
      from: "ontology",
      chain: "ai",
      theme: "theme:ai",
      security: "NVDA",
    })).toEqual({
      status: "missing_adapter",
      reason: "navigation_context_is_not_canonical_identity",
    });
  });
});


describe("semantic context adversarial coordinator cases", () => {
  it("allows one widget origin to own multiple ports when a later port is the deliberate emitter", () => {
    const group: SemanticContextGroup = {
      ...baseGroup(),
      ports: [
        {
          port_id: "same.consume",
          origin_id: "same-origin",
          direction: "consume",
          mode: "linked",
          accepts: ["entity_selection"],
          ref_accepts: [{ owner: "terminal.analysis_symbol", kinds: ["security"] }],
          temporal_capabilities: ["live"],
        },
        {
          port_id: "same.emit",
          origin_id: "same-origin",
          direction: "emit",
          mode: "linked",
          accepts: ["entity_selection"],
          ref_accepts: [{ owner: "terminal.analysis_symbol", kinds: ["security"] }],
          temporal_capabilities: ["live"],
        },
        ...baseGroup().ports.filter(port => port.port_id === "brain.scope"),
      ],
    };
    const coordinator = createSemanticContextCoordinator(group);
    const result = coordinator.apply(delta({ origin_id: "same-origin" }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.snapshot.revision).toBe(1);
    expect(result.receipt.applied_ports).toEqual(["same.consume", "brain.scope"]);
  });

  it("refuses revision overflow without changing the accepted snapshot", () => {
    const group: SemanticContextGroup = {
      ...baseGroup(),
      revision: 2_147_483_646,
    };
    const coordinator = createSemanticContextCoordinator(group);
    const result = coordinator.apply(delta({
      base_revision: 2_147_483_646,
      mutation_id: "max-revision",
    }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("revision_exhausted");
    expect(result.snapshot.revision).toBe(2_147_483_646);
  });

  it("replays an old accepted mutation after later revisions without re-delivering it", () => {
    const coordinator = createSemanticContextCoordinator(baseGroup(), [wrapSelection]);
    const first = coordinator.apply(delta());
    expect(first.ok).toBe(true);
    const second = coordinator.apply(delta({
      mutation_id: "mutation-2",
      base_revision: 1,
      patch: {
        kind: "entity_selection",
        ref: { owner: "terminal.analysis_symbol", kind: "security", object_id: "MSFT" },
      },
    }));
    expect(second.ok).toBe(true);
    const replay = coordinator.apply(delta());
    expect(replay.ok).toBe(true);
    if (!replay.ok) return;
    expect(replay.replayed).toBe(true);
    expect(replay.changed).toBe(false);
    expect(replay.snapshot.revision).toBe(2);
    expect(replay.deliveries).toEqual([]);
    expect(replay.receipt.accepted_revision).toBe(1);
  });

  it("contains adapter exceptions and hostile outputs without rejecting the accepted group change", () => {
    const throwing: SemanticContextTransformAdapter = {
      adapter_id: "selection_to_set",
      from_kind: "entity_selection",
      to_kind: "entity_set",
      project() { throw new Error("adapter failed"); },
    };
    const coordinator = createSemanticContextCoordinator(baseGroup(), [throwing]);
    const result = coordinator.apply(delta());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.snapshot.revision).toBe(1);
    expect(result.receipt.rejected_ports).toContainEqual({
      port_id: "set.consumer",
      reason: "adapter_error",
    });
    expect(result.receipt.applied_ports).toEqual(["brain.scope"]);
  });

  it("passes transforms a detached value and returns detached snapshots", () => {
    const mutating: SemanticContextTransformAdapter = {
      adapter_id: "selection_to_set",
      from_kind: "entity_selection",
      to_kind: "entity_set",
      project(value) {
        if (value.kind !== "entity_selection") return { ok: false, reason: "incompatible" };
        const original = { ...value.ref };
        value.ref.object_id = "MUTATED";
        return { ok: true, value: { kind: "entity_set", refs: [original] } };
      },
    };
    const coordinator = createSemanticContextCoordinator(baseGroup(), [mutating]);
    const result = coordinator.apply(delta());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.snapshot.value).toEqual(delta().patch);
    result.snapshot.value = securityAapl;
    expect(coordinator.snapshot().value).toEqual(delta().patch);
  });

  it("rejects unknown delta fields and non-plain group/value objects", () => {
    expect(validateSemanticContextDelta(delta({ user_id: "forged" })).ok).toBe(false);
    const protoValue = Object.create({ hidden: "authority" });
    protoValue.kind = "entity_selection";
    protoValue.ref = securityAapl.ref;
    expect(validateSemanticContextGroup({ ...baseGroup(), value: protoValue }).ok).toBe(false);
  });
});


describe("semantic context hostile-boundary and owner-admission cases", () => {
  it("refuses an unadmitted Investigation owner instead of promoting namespace shape to identity", () => {
    expect(investigationSubjectsToSemanticValue([
      { owner: "untrusted.fake_owner", kind: "security", object_id: "NVDA" },
    ])).toEqual({
      status: "missing_adapter",
      reason: "investigation_subject_owner_not_admitted",
    });
  });

  it("fails closed rather than throwing when a hostile value proxy traps structural inspection", () => {
    const hostile = new Proxy(
      { kind: "entity_selection", ref: securityAapl.ref },
      { ownKeys() { throw new Error("hostile ownKeys"); } },
    );
    expect(() => validateSemanticContextValue(hostile)).not.toThrow();
    expect(validateSemanticContextValue(hostile).ok).toBe(false);
  });

  it("fails closed without executing nested array toJSON hooks while validating a port", () => {
    let calls = 0;
    const accepts = ["entity_selection"] as string[] & { toJSON?: () => unknown };
    accepts.toJSON = () => {
      calls += 1;
      return ["entity_set"];
    };
    const group = baseGroup();
    group.ports[0] = { ...group.ports[0], accepts: accepts as SemanticContextGroup["ports"][number]["accepts"] };
    const result = validateSemanticContextGroup(group);
    expect(result.ok).toBe(false);
    expect(calls).toBe(0);
  });
});


describe("semantic context emission identity and dense-container cases", () => {
  it("rejects sparse port capability arrays instead of admitting holes as typed values", () => {
    const group = baseGroup();
    const accepts = new Array<SemanticContextGroup["ports"][number]["accepts"][number]>(1);
    group.ports[0] = { ...group.ports[0], accepts };
    expect(validateSemanticContextGroup(group).ok).toBe(false);
  });

  it("rejects two emitting ports for the same origin because a delta names no port id", () => {
    const group: SemanticContextGroup = {
      ...baseGroup(),
      ports: [
        {
          port_id: "same.emit.1",
          origin_id: "same-origin",
          direction: "emit",
          mode: "linked",
          accepts: ["entity_selection"],
          ref_accepts: [{ owner: "terminal.analysis_symbol", kinds: ["security"] }],
          temporal_capabilities: ["live"],
        },
        {
          port_id: "same.emit.2",
          origin_id: "same-origin",
          direction: "both",
          mode: "linked",
          accepts: ["entity_selection"],
          ref_accepts: [{ owner: "terminal.analysis_symbol", kinds: ["security"] }],
          temporal_capabilities: ["live"],
        },
        ...baseGroup().ports.filter(port => port.port_id === "brain.scope"),
      ],
    };
    expect(validateSemanticContextGroup(group).ok).toBe(false);
  });

  it("refuses a non-canonical Analysis symbol rather than silently promoting it to owner identity", () => {
    expect(semanticSecurityFromAiContextV1({
      schema: "ai_context_client.v1",
      origin_id: "origin",
      context_revision: 1,
      captured_at: "2026-10-05T06:00:00.000Z",
      pinned: [],
      active: { type: "security", id: "nvda" },
      ambient: { symbol: "nvda", timeframe: "1D", page: "analysis", panel: "company" },
    })).toEqual({
      status: "unsupported",
      reason: "security_context_invalid",
    });
  });
});


describe("semantic context owner/kind compatibility", () => {
  it("does not permit a security chart emitter to silently reinterpret a theme as a security", () => {
    const coordinator = createSemanticContextCoordinator(baseGroup());
    const result = coordinator.apply(delta({
      patch: {
        kind: "entity_selection",
        ref: { owner: "macro.theme_registry", kind: "theme", object_id: "theme.ai" },
      },
    }));
    expect(result.ok).toBe(false);
    expect(coordinator.snapshot().value).toEqual(securityAapl);
  });
});

describe("semantic context per-port reference support", () => {
  it("blocks incompatible direct destinations even when they accept the same value kind", () => {
    const group = baseGroup();
    group.ports[1] = {
      ...group.ports[1],
      ref_accepts: [{ owner: "macro.theme_registry", kinds: ["theme"] }],
    };
    const coordinator = createSemanticContextCoordinator(group, [wrapSelection]);
    const result = coordinator.apply(delta());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.receipt.applied_ports).toEqual(["set.consumer"]);
    expect(result.receipt.rejected_ports).toContainEqual({
      port_id: "brain.scope",
      reason: "reference_incompatible",
    });
    expect(result.deliveries.some(delivery => delivery.port_id === "brain.scope")).toBe(false);
  });

  it("permits an owner/kind conversion only through an explicitly named compatible transform", () => {
    const group = baseGroup();
    group.ports[1] = {
      ...group.ports[1],
      ref_accepts: [{ owner: "macro.theme_registry", kinds: ["theme"] }],
      adapter_id: "qualified_relationship",
    };
    const qualified: SemanticContextTransformAdapter = {
      adapter_id: "qualified_relationship",
      from_kind: "entity_selection",
      to_kind: "entity_selection",
      project(value) {
        if (value.kind !== "entity_selection") return { ok: false, reason: "incompatible" };
        return {
          ok: true,
          value: {
            kind: "entity_selection",
            ref: { owner: "macro.theme_registry", kind: "theme", object_id: "theme.ai" },
          },
        };
      },
    };
    const result = createSemanticContextCoordinator(group, [qualified, wrapSelection]).apply(delta());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.receipt.applied_ports).toEqual(["brain.scope", "set.consumer"]);
    expect(result.deliveries[0]).toEqual({
      port_id: "brain.scope",
      value: {
        kind: "entity_selection",
        ref: { owner: "macro.theme_registry", kind: "theme", object_id: "theme.ai" },
      },
    });
  });

  it("rejects a named transform that emits a valid shape for an unadmitted owner", () => {
    const group = baseGroup();
    group.ports[1] = {
      ...group.ports[1],
      ref_accepts: [{ owner: "macro.theme_registry", kinds: ["theme"] }],
      adapter_id: "bad_relationship",
    };
    const bad: SemanticContextTransformAdapter = {
      adapter_id: "bad_relationship",
      from_kind: "entity_selection",
      to_kind: "entity_selection",
      project() {
        return {
          ok: true,
          value: {
            kind: "entity_selection",
            ref: { owner: "macro.issuer_registry", kind: "issuer", object_id: "issuer:1" },
          },
        };
      },
    };
    const result = createSemanticContextCoordinator(group, [bad, wrapSelection]).apply(delta());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.receipt.rejected_ports).toContainEqual({
      port_id: "brain.scope",
      reason: "reference_incompatible",
    });
    expect(result.deliveries.every(delivery => delivery.port_id !== "brain.scope")).toBe(true);
  });

  it("rejects undeclared reference-support and a group whose emitting source cannot represent its value", () => {
    const missing = baseGroup();
    delete missing.ports[1].ref_accepts;
    expect(validateSemanticContextGroup(missing).ok).toBe(false);

    const incompatible = baseGroup();
    incompatible.ports[0] = {
      ...incompatible.ports[0],
      ref_accepts: [{ owner: "macro.theme_registry", kinds: ["theme"] }],
    };
    expect(validateSemanticContextGroup(incompatible).ok).toBe(false);

    const unauthorized = baseGroup();
    unauthorized.ports[0] = {
      ...unauthorized.ports[0],
      ref_accepts: [{ owner: "terminal.analysis_symbol", kinds: ["security"], rights_granted: true }] as unknown as SemanticContextGroup["ports"][number]["ref_accepts"],
    };
    expect(validateSemanticContextGroup(unauthorized).ok).toBe(false);
  });

  it("requires every member of an entity set to be admitted, not just its first member", () => {
    const mixedGroup = {
      ...baseGroup(),
      kind: "entity_set",
      value: {
        kind: "entity_set",
        refs: [
          { owner: "terminal.analysis_symbol", kind: "security", object_id: "AAPL" },
          { owner: "macro.theme_registry", kind: "theme", object_id: "theme.ai" },
        ],
      },
      ports: baseGroup().ports.map(port => ({
        ...port,
        accepts: ["entity_set"],
        ref_accepts: [
          { owner: "terminal.analysis_symbol", kinds: ["security"] },
          { owner: "macro.theme_registry", kinds: ["theme"] },
        ],
      })),
    };
    expect(validateSemanticContextGroup(mixedGroup).ok).toBe(true);
    const coordinator = createSemanticContextCoordinator(mixedGroup as SemanticContextGroup);
    const attempted = coordinator.apply({
      ...delta(),
      patch: {
        kind: "entity_set",
        refs: [
          { owner: "terminal.analysis_symbol", kind: "security", object_id: "MSFT" },
          { owner: "macro.economy_registry", kind: "economy", object_id: "economy.us" },
        ],
      },
    });
    expect(attempted.ok).toBe(false);
    expect(coordinator.snapshot().revision).toBe(0);
  });
});

describe("semantic context reference-support routing and non-authority", () => {
  it("allows explicitly declared theme owners on theme-aware emitters and consumers", () => {
    const group: SemanticContextGroup = {
      ...baseGroup(),
      value: {
        kind: "entity_selection",
        ref: { owner: "macro.theme_registry", kind: "theme", object_id: "theme.ai" },
      },
      ports: baseGroup().ports.map(port => ({
        ...port,
        ref_accepts: [
          { owner: "terminal.analysis_symbol", kinds: ["security"] },
          { owner: "macro.theme_registry", kinds: ["theme"] },
        ],
      })),
    };
    const coordinator = createSemanticContextCoordinator(group, [wrapSelection]);
    const result = coordinator.apply(delta({
      mutation_id: "theme-selection",
      patch: {
        kind: "entity_selection",
        ref: { owner: "macro.theme_registry", kind: "theme", object_id: "theme.energy" },
      },
    }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.snapshot.revision).toBe(1);
    expect(result.receipt.applied_ports).toEqual(["brain.scope", "set.consumer"]);
    expect(result.deliveries[1]).toEqual({
      port_id: "set.consumer",
      value: {
        kind: "entity_set",
        refs: [{ owner: "macro.theme_registry", kind: "theme", object_id: "theme.energy" }],
      },
    });
  });

  it("accepts a mutation but explicitly refuses a direct consumer that cannot interpret its owner", () => {
    const group: SemanticContextGroup = {
      ...baseGroup(),
      ports: baseGroup().ports.map(port =>
        port.port_id === "chart.primary"
          ? {
              ...port,
              ref_accepts: [
                { owner: "terminal.analysis_symbol", kinds: ["security"] },
                { owner: "macro.theme_registry", kinds: ["theme"] },
              ],
            }
          : port),
    };
    const result = createSemanticContextCoordinator(group).apply(delta({
      patch: {
        kind: "entity_selection",
        ref: { owner: "macro.theme_registry", kind: "theme", object_id: "theme.ai" },
      },
    }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.receipt.applied_ports).toEqual([]);
    expect(result.receipt.rejected_ports).toContainEqual({
      port_id: "brain.scope",
      reason: "reference_incompatible",
    });
    expect(result.deliveries).toEqual([]);
    expect(result.snapshot.revision).toBe(1);
  });

  it("refuses a transformed reference outside the target port's declared owner/kind support", () => {
    const transform: SemanticContextTransformAdapter = {
      adapter_id: "selection_to_set",
      from_kind: "entity_selection",
      to_kind: "entity_set",
      project() {
        return {
          ok: true,
          value: {
            kind: "entity_set",
            refs: [{ owner: "macro.theme_registry", kind: "theme", object_id: "theme.ai" }],
          },
        };
      },
    };
    const result = createSemanticContextCoordinator(baseGroup(), [transform]).apply(delta());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.receipt.applied_ports).toEqual(["brain.scope"]);
    expect(result.receipt.rejected_ports).toContainEqual({
      port_id: "set.consumer",
      reason: "reference_incompatible",
    });
    expect(result.deliveries).toEqual([
      { port_id: "brain.scope", value: delta().patch },
    ]);
  });

  it("refuses spoofed/duplicate owner declarations before coordination", () => {
    const group = baseGroup();
    group.ports[0] = {
      ...group.ports[0],
      ref_accepts: [
        { owner: "terminal.analysis_symbol", kinds: ["security"] },
        { owner: "terminal.analysis_symbol", kinds: ["theme"] },
      ],
    };
    expect(validateSemanticContextGroup(group).ok).toBe(false);
    group.ports[0] = {
      ...group.ports[0],
      ref_accepts: [{ owner: "bad/owner", kinds: ["security"] }],
    };
    expect(validateSemanticContextGroup(group).ok).toBe(false);
  });

  it("does not require entity-owner metadata on non-reference temporal ports", () => {
    const base: SemanticContextGroup = {
      ...baseGroup(),
      kind: "historical_cutoff",
      value: {
        kind: "historical_cutoff",
        policy: "as_known",
        cutoff: "2026-10-09T14:00:00.000Z",
      },
      ports: baseGroup().ports.map(port => ({
        ...withoutReferenceSupport(port),
        accepts: ["historical_cutoff"],
        temporal_capabilities: ["as_known"],
      })),
    };
    expect(validateSemanticContextGroup(base).ok).toBe(true);
  });
});


describe("P2 review repair — temporal projections and bounded receipts", () => {
  function horizonGroup(supported: Array<"live" | "as_known" | "scenario"> = ["live"]): SemanticContextGroup {
    return {
      schema: "semantic_context_group.v1", session_epoch: "temporal-epoch", group_id: "horizon",
      revision: 0, kind: "time_horizon", label: "Horizon",
      value: {kind: "time_horizon", horizon: "1Y"},
      ports: [
        {port_id: "source", origin_id: "picker-origin", direction: "emit", mode: "linked",
          accepts: ["time_horizon"], temporal_capabilities: ["live"]},
        {port_id: "sink", origin_id: "sink-origin", direction: "consume", mode: "linked",
          accepts: ["historical_cutoff"], adapter_id: "horizon_to_as_known", temporal_capabilities: supported},
      ],
    };
  }
  const temporalDelta = (id: string, revision = 0, horizon = "3Y") => ({
    schema: "semantic_context_delta.v1", session_epoch: "temporal-epoch", group_id: "horizon",
    mutation_id: id, base_revision: revision, origin_id: "picker-origin",
    patch: {kind: "time_horizon", horizon}, cause: "user_action" as const,
  });
  const historicalAdapter: SemanticContextTransformAdapter = {
    adapter_id: "horizon_to_as_known", from_kind: "time_horizon", to_kind: "historical_cutoff",
    project: () => ({ok:true, value:{kind:"historical_cutoff",policy:"as_known",cutoff:"2026-01-01T00:00:00.000Z"}}),
  };

  it("blocks a transformed historical cutoff from a LIVE-only port", () => {
    const result = createSemanticContextCoordinator(horizonGroup(), [historicalAdapter]).apply(temporalDelta("one"));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.snapshot.revision).toBe(1);
    expect(result.deliveries).toEqual([]);
    expect(result.receipt.temporal_mismatches).toEqual([
      {port_id:"sink",requested:"as_known",supported:["live"]},
    ]);
  });
  it("permits the same transformed value through an explicitly AS_KNOWN capable port", () => {
    const result = createSemanticContextCoordinator(horizonGroup(["as_known"]), [historicalAdapter]).apply(temporalDelta("one"));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.receipt.applied_ports).toEqual(["sink"]);
    expect(result.receipt.temporal_mismatches).toEqual([]);
    expect(result.deliveries[0].value).toEqual(
      {kind:"historical_cutoff",policy:"as_known",cutoff:"2026-01-01T00:00:00.000Z"},
    );
  });
  it("also gates a projected scenario, even with correct owner-kind routing", () => {
    const group = horizonGroup();
    group.ports[1] = {...group.ports[1], accepts:["scenario_selection"],
      adapter_id:"horizon_to_scenario",ref_accepts:[{owner:"macro.scenario_recipe",kinds:["scenario"]}]};
    const adapter: SemanticContextTransformAdapter = {
      adapter_id:"horizon_to_scenario",from_kind:"time_horizon",to_kind:"scenario_selection",
      project:()=>({ok:true,value:{kind:"scenario_selection",
        ref:{owner:"macro.scenario_recipe",object_id:"recipe-1",version_ref:"v1"}}}),
    };
    const refused = createSemanticContextCoordinator(group,[adapter]).apply(temporalDelta("one"));
    expect(refused.ok).toBe(true);
    if (!refused.ok) return;
    expect(refused.deliveries).toEqual([]);
    expect(refused.receipt.temporal_mismatches).toEqual([
      {port_id:"sink",requested:"scenario",supported:["live"]},
    ]);
    group.ports[1].temporal_capabilities = ["scenario"];
    const admitted = createSemanticContextCoordinator(group,[adapter]).apply(temporalDelta("one"));
    expect(admitted.ok).toBe(true);
    if (admitted.ok) expect(admitted.receipt.applied_ports).toEqual(["sink"]);
  });
  it("caps no-op receipts at 1024 without forgetting exact prior identities", () => {
    const c = createSemanticContextCoordinator(baseGroup());
    for(let i=0;i<1024;i++){
      const result=c.apply(delta({mutation_id:"noop-"+i,patch:securityAapl}));
      expect(result.ok).toBe(true);
      if(result.ok) expect(result.changed).toBe(false);
    }
    const before=c.snapshot();
    const exhausted=c.apply(delta({mutation_id:"new-after-cap"}));
    expect(exhausted.ok).toBe(false);
    if(!exhausted.ok)expect(exhausted.code).toBe("mutation_history_exhausted");
    expect(c.snapshot()).toEqual(before);
    for(const i of [0,1023]){
      const replay=c.apply(delta({mutation_id:"noop-"+i,patch:securityAapl}));
      expect(replay.ok).toBe(true);
      if(replay.ok) expect(replay.replayed).toBe(true);
    }
    const conflict=c.apply(delta({mutation_id:"noop-0"}));
    expect(conflict.ok).toBe(false);
    if(!conflict.ok)expect(conflict.code).toBe("mutation_conflict");
  });
  it("caps changing receipts without losing the first immutable response", () => {
    const c = createSemanticContextCoordinator(horizonGroup());
    for(let i=0;i<1024;i++){
      const result=c.apply(temporalDelta("changed-"+i,i,i%2===0?"3Y":"1Y"));
      expect(result.ok).toBe(true);
      if(result.ok)expect(result.snapshot.revision).toBe(i+1);
    }
    const before=c.snapshot();
    const refused=c.apply(temporalDelta("overflow",1024));
    expect(refused.ok).toBe(false);
    if(!refused.ok)expect(refused.code).toBe("mutation_history_exhausted");
    expect(c.snapshot()).toEqual(before);
    const replay=c.apply(temporalDelta("changed-0",0,"3Y"));
    expect(replay.ok).toBe(true);
    if(replay.ok){
      expect(replay.replayed).toBe(true);
      expect(replay.receipt.accepted_revision).toBe(1);
      expect(replay.deliveries).toEqual([]);
    }
  });
  it("close is idempotent and permanently refuses old, new, and malformed actions", () => {
    const c = createSemanticContextCoordinator(baseGroup());
    expect(c.apply(delta()).ok).toBe(true);
    const before=c.snapshot();
    c.close();
    c.close();
    for(const input of [delta(),delta({mutation_id:"later",base_revision:1}),null]){
      const refused=c.apply(input);
      expect(refused.ok).toBe(false);
      if(!refused.ok) expect(refused.code).toBe("coordinator_closed");
      expect(refused.snapshot).toEqual(before);
    }
    const external=c.snapshot();
    external.label="changed externally";
    expect(c.snapshot()).toEqual(before);
  });
});
