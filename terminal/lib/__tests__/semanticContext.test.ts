import { describe, expect, it } from "vitest";
import { createWorkspaceContextSession } from "@/lib/workspaceContextSession";
import {
  decodeNativeSemanticValue,
  encodeNativeSemanticValue,
  nativeGroupFromSemanticDeclaration,
  prepareNativeSemanticFrame,
  projectNativeSemanticPort,
  validateSemanticContextDelta,
  validateSemanticContextGroup,
  validateSemanticContextValue,
  type SemanticContextDelta,
  type SemanticContextGroup,
  type SemanticContextTransformAdapter,
} from "@/lib/semanticContext";
import {
  investigationSubjectsToSemanticValue,
  semanticEntityFromMarketOntology,
  semanticHistoricalCutoffFromReplay,
  semanticSecurityFromAiContextV1,
} from "@/lib/semanticContextAdapters";

const selection = (id: string) => ({
  kind: "entity_selection" as const,
  ref: { owner: "terminal.analysis_symbol", kind: "security", object_id: id },
});
const REF_SUPPORT = [{ owner: "terminal.analysis_symbol", kinds: ["security"] }];
const group = (): SemanticContextGroup => ({
  schema: "semantic_context_group.v1",
  session_epoch: "epoch-one",
  group_id: "primary_security",
  revision: 0,
  kind: "entity_selection",
  label: "Primary security",
  value: selection("AAPL"),
  ports: [
    { port_id: "chart", origin_id: "chart-origin", direction: "both", mode: "linked",
      accepts: ["entity_selection"], ref_accepts: REF_SUPPORT, temporal_capabilities: ["live"] },
    { port_id: "brain", origin_id: "brain-origin", direction: "consume", mode: "linked",
      accepts: ["entity_selection"], ref_accepts: REF_SUPPORT, temporal_capabilities: ["live"] },
    { port_id: "pinned", origin_id: "pinned-origin", direction: "both", mode: "pinned",
      accepts: ["entity_selection"], ref_accepts: REF_SUPPORT, temporal_capabilities: ["live"] },
    { port_id: "local", origin_id: "local-origin", direction: "both", mode: "local",
      accepts: ["entity_selection"], ref_accepts: REF_SUPPORT, temporal_capabilities: ["live"] },
    { port_id: "themes", origin_id: "theme-origin", direction: "consume", mode: "linked",
      accepts: ["entity_selection"],
      ref_accepts: [{ owner: "macro.theme_registry", kinds: ["theme"] }],
      adapter_id: "qualified_relationship", temporal_capabilities: ["live"] },
  ],
});
const delta = (patch: unknown = selection("NVDA"), extra: Record<string, unknown> = {}): SemanticContextDelta => ({
  schema: "semantic_context_delta.v1",
  session_epoch: "epoch-one",
  group_id: "primary_security",
  mutation_id: "mutation-one",
  origin_id: "chart-origin",
  base_revision: 0,
  patch: patch as SemanticContextDelta["patch"],
  cause: "user_action",
  ...extra,
});
function native(groupValue = group()) {
  const declaration = nativeGroupFromSemanticDeclaration(groupValue);
  expect(declaration.ok).toBe(true);
  if (!declaration.ok) throw Error("invalid test group");
  const session = createWorkspaceContextSession(groupValue.session_epoch, [declaration.value]);
  for (const port of groupValue.ports) {
    expect(session.register({
      id: port.port_id,
      group: groupValue.group_id,
      emit: port.direction !== "consume",
    })).toBe(true);
    if (port.mode !== "linked") expect(session.setMode(port.port_id, port.mode === "pinned" ? "pin" : "local")).toBe(true);
  }
  return session;
}
const projection = (
  session: ReturnType<typeof native>,
  p: string,
  adapters: readonly SemanticContextTransformAdapter[] = [],
) => projectNativeSemanticPort(session, group(), p, adapters);

describe("semantic context remains a pure typed validation boundary", () => {
  it("accepts one closed group with explicit ports, but never grants authority", () => {
    expect(validateSemanticContextGroup(group())).toEqual({ ok: true, value: group() });
    expect(validateSemanticContextGroup({ ...group(), principal: "forged" }).ok).toBe(false);
    const fabricated = group();
    fabricated.ports[0].ref_accepts = [{ owner: "terminal.analysis_symbol", kinds: ["security"], rights_granted: true }] as never;
    expect(validateSemanticContextGroup(fabricated).ok).toBe(false);
  });
  it("requires one unambiguous group emitter and closed owner/kind support", () => {
    const ambiguous = group();
    ambiguous.ports.push({ ...ambiguous.ports[0], port_id: "chart2" });
    expect(validateSemanticContextGroup(ambiguous).ok).toBe(false);
    const noSupport = group();
    delete noSupport.ports[0].ref_accepts;
    expect(validateSemanticContextGroup(noSupport).ok).toBe(false);
    const bad = group();
    bad.ports[0].ref_accepts = [{ owner: "bad/owner", kinds: ["security"] }];
    expect(validateSemanticContextGroup(bad).ok).toBe(false);
  });
  it("rejects non-zero synthetic source history because native session begins at revision zero", () => {
    expect(nativeGroupFromSemanticDeclaration({ ...group(), revision: 1 }).ok).toBe(false);
  });
  it("does not treat a theme owner as a security emitter", () => {
    const s = native();
    const bad = prepareNativeSemanticFrame(s, group(), "chart", delta({
      kind: "entity_selection", ref: { owner: "macro.theme_registry", kind: "theme", object_id: "theme.ai" },
    }), 1);
    expect(bad.ok).toBe(false);
    expect(s.snapshot("chart")?.group_revision).toBe(0);
  });
  it("admits only deliberate user/restore deltas, never data arrivals or receipts", () => {
    expect(validateSemanticContextDelta(delta()).ok).toBe(true);
    expect(validateSemanticContextDelta(delta(undefined, { cause: "explicit_restore" })).ok).toBe(true);
    expect(validateSemanticContextDelta(delta(undefined, { cause: "data_arrival" })).ok).toBe(false);
    expect(validateSemanticContextDelta(delta(undefined, { actor: "admin" })).ok).toBe(false);
  });
  it("validates 16 unique typed refs and refuses the 17th or duplicates", () => {
    const refs = Array.from({length:16},(_,i)=>({
      owner:"terminal.analysis_symbol",kind:"security",object_id:"SYM"+i,
    }));
    expect(validateSemanticContextValue({kind:"entity_set",refs}).ok).toBe(true);
    expect(validateSemanticContextValue({kind:"entity_set",refs:[...refs,refs[0]]}).ok).toBe(false);
    expect(validateSemanticContextValue({kind:"entity_set",refs:[refs[0],refs[0]]}).ok).toBe(false);
  });
  it("refuses date-only knowledge cutoffs and accepts an RFC3339 timestamp", () => {
    expect(validateSemanticContextValue({kind:"historical_cutoff",policy:"as_known",cutoff:"2026-10-09"}).ok).toBe(false);
    expect(validateSemanticContextValue({kind:"historical_cutoff",policy:"as_known",cutoff:"2026-10-09T14:30:00.000Z"}).ok).toBe(true);
  });
  it("contains hostile structural traps instead of throwing or executing array hooks", () => {
    const hostile = new Proxy({kind:"entity_selection",ref:selection("AAPL").ref},{
      ownKeys(){throw Error("trap");},
    });
    expect(() => validateSemanticContextValue(hostile)).not.toThrow();
    expect(validateSemanticContextValue(hostile).ok).toBe(false);
    let calls=0;
    const refs=[selection("AAPL").ref] as Array<unknown> & {toJSON?:()=>unknown};
    refs.toJSON=()=>{calls++;return [];};
    expect(validateSemanticContextValue({kind:"entity_set",refs}).ok).toBe(false);
    expect(calls).toBe(0);
  });
});

describe("exact native owner — NO SECOND SESSION OR CONTROL PLANE", () => {
  it("builds a declaration for the *existing* mounted Chart Bus reducer, not its own session", () => {
    const compiled = nativeGroupFromSemanticDeclaration(group());
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    expect(compiled.value.id).toBe("primary_security");
    const s = native();
    expect(s.snapshot("chart")?.value).toEqual({
      kind:"entity_selection",owner:"terminal.analysis_symbol",ref_kind:"security",object_id:"AAPL",
    });
  });
  it("returns a pure frame, and the native reducer alone changes group revision and fans out", () => {
    const s = native(), proposal=prepareNativeSemanticFrame(s,group(),"chart",delta(),1);
    expect(proposal.ok).toBe(true);
    if(!proposal.ok)return;
    expect(s.snapshot("chart")?.group_revision).toBe(0);
    const receipt=s.publish(proposal.value);
    expect(receipt.status).toBe("applied");
    expect(s.snapshot("chart")?.group_revision).toBe(1);
    expect(receipt.followed).toContain("brain");
    expect(projection(s,"brain")).toMatchObject({status:"qualified",value:selection("NVDA")});
    expect(s.publish(proposal.value).status).toBe("duplicate");
    expect(s.snapshot("chart")?.group_revision).toBe(1);
  });
  it("preserves native pin/local values and native late-result invalidation", () => {
    const s=native(),token=s.token("brain")!;
    const prepared=prepareNativeSemanticFrame(s,group(),"chart",delta(),1);
    if(!prepared.ok)throw Error("prepare");
    s.publish(prepared.value);
    expect(projection(s,"pinned")).toMatchObject({status:"qualified",value:selection("AAPL")});
    expect(projection(s,"local")).toMatchObject({status:"qualified",value:selection("AAPL")});
    expect(s.isCurrent(token)).toBe(false);
    expect(s.isCurrent(s.token("brain")!)).toBe(true);
  });
  it("rejects stale native group revision and wrong epoch without any publication", () => {
    const s=native();
    expect(prepareNativeSemanticFrame(s,group(),"chart",delta(undefined,{base_revision:2}),1).ok).toBe(false);
    expect(prepareNativeSemanticFrame(s,group(),"chart",delta(undefined,{session_epoch:"past"}),1).ok).toBe(false);
    expect(s.snapshot("chart")?.group_revision).toBe(0);
  });
  it("cannot emit through a read-only consumer or a pinned port", () => {
    const s=native();
    expect(prepareNativeSemanticFrame(s,group(),"brain",delta(undefined,{origin_id:"brain-origin"}),1).ok).toBe(false);
    expect(prepareNativeSemanticFrame(s,group(),"pinned",delta(undefined,{origin_id:"pinned-origin"}),1).ok).toBe(false);
  });
  it("qualifies reference routing at *read projection*, never by mutating the native value", () => {
    const s=native(),frame=prepareNativeSemanticFrame(s,group(),"chart",delta(),1);
    if(!frame.ok)throw Error("prepare");
    s.publish(frame.value);
    expect(projection(s,"themes")).toEqual({
      status:"unsupported",reason:"reference_incompatible",
    });
    expect(s.snapshot("themes")?.group_revision).toBe(1);
    expect(s.snapshot("themes")?.value).toEqual(s.snapshot("brain")?.value);
  });
  it("permits named read-side conversion, without publishing another context frame", () => {
    const s=native(),frame=prepareNativeSemanticFrame(s,group(),"chart",delta(),1);
    if(!frame.ok)throw Error("prepare");
    s.publish(frame.value);
    const convert:SemanticContextTransformAdapter={
      adapter_id:"qualified_relationship",from_kind:"entity_selection",to_kind:"entity_selection",
      project(){return {ok:true,value:{
        kind:"entity_selection",ref:{owner:"macro.theme_registry",kind:"theme",object_id:"theme.ai"},
      }};},
    };
    expect(projection(s,"themes",[convert])).toMatchObject({
      status:"qualified",
      value:{kind:"entity_selection",ref:{owner:"macro.theme_registry",kind:"theme",object_id:"theme.ai"}},
    });
    expect(s.snapshot("themes")?.value).toEqual(s.snapshot("brain")?.value);
    expect(s.snapshot("themes")?.group_revision).toBe(1);
  });
  it("refuses unadmitted transform output, even when the shape is valid", () => {
    const s=native(),frame=prepareNativeSemanticFrame(s,group(),"chart",delta(),1);
    if(!frame.ok)throw Error("prepare");
    s.publish(frame.value);
    const bad:SemanticContextTransformAdapter={
      adapter_id:"qualified_relationship",from_kind:"entity_selection",to_kind:"entity_selection",
      project(){return {ok:true,value:{kind:"entity_selection",ref:{
        owner:"macro.issuer_registry",kind:"issuer",object_id:"issuer.one",
      }}};},
    };
    expect(projection(s,"themes",[bad])).toEqual({
      status:"unsupported",reason:"reference_incompatible",
    });
  });
  it("accepts unrelated groups but never coerces an event into a security group", () => {
    const s=native();
    const bad=prepareNativeSemanticFrame(s,group(),"chart",delta({
      kind:"entity_selection",ref:{owner:"macro.event_registry",kind:"event",object_id:"event.1"},
    }),1);
    expect(bad.ok).toBe(false);
    expect(s.snapshot("chart")?.group_revision).toBe(0);
  });
});

describe("explicit scalar codec limitations of incumbent owner",()=>{
  it("roundtrips a typed security and native close revokes all snapshots",()=>{
    const raw=selection("NVDA"), encoded=encodeNativeSemanticValue(raw);
    expect(encoded.ok).toBe(true);
    if(!encoded.ok)return;
    expect(decodeNativeSemanticValue(encoded.value)).toEqual({ok:true,value:raw});
    const s=native();s.close();expect(s.snapshot("chart")).toBeNull();
  });
  it("roundtrips a short multi-subject set without truncation",()=>{
    const value={kind:"entity_set" as const,refs:[
      {owner:"terminal.analysis_symbol",kind:"security",object_id:"AAPL"},
      {owner:"macro.theme_registry",kind:"theme",object_id:"ai"},
    ]};
    const e=encodeNativeSemanticValue(value);
    expect(e.ok).toBe(true);
    if(e.ok)expect(decodeNativeSemanticValue(e.value)).toEqual({ok:true,value});
  });
  it("reports the native flat-value 512-character limit for 16 fully-qualified long refs",()=>{
    const value={kind:"entity_set" as const,refs:Array.from({length:16},(_,i)=>({
      owner:"terminal.analysis_symbol",kind:"security",object_id:"SYM"+i+"x".repeat(120),
    }))};
    expect(validateSemanticContextValue(value).ok).toBe(true);
    expect(encodeNativeSemanticValue(value)).toEqual({
      ok:false,reason:"native_capacity_exceeded",
    });
  });
  it("does not turn an Options replay stamp into a knowledge-time cutoff",()=>{
    expect(semanticHistoricalCutoffFromReplay({
      active:true,asOfStamp:"1430",atHead:false,live:false,archived:true,
      sessionDate:"2026-09-30",offHead:true,
    })).toEqual({status:"unsupported",reason:"session_replay_is_not_knowledge_cutoff"});
  });
  it("refuses MarketOntology navigation labels as owner identity",()=>{
    expect(semanticEntityFromMarketOntology({from:"ontology",chain:"ai",security:"NVDA"}))
      .toEqual({status:"missing_adapter",reason:"navigation_context_is_not_canonical_identity"});
  });
  it("uses the existing Analysis symbol identity only when active and ambient agree",()=>{
    const basis={
      schema:"ai_context_client.v1" as const, origin_id:"origin",context_revision:4,
      captured_at:"2026-10-09T00:00:00.000Z",pinned:[],
      active:{type:"security" as const,id:"NVDA"},
      ambient:{symbol:"NVDA",timeframe:"1D",page:"analysis",panel:"company"},
    };
    expect(semanticSecurityFromAiContextV1(basis)).toEqual({
      status:"qualified",value:selection("NVDA"),
    });
    expect(semanticSecurityFromAiContextV1({...basis,ambient:{...basis.ambient,symbol:"AAPL"}}))
      .toEqual({status:"incompatible",reason:"active_ambient_mismatch"});
  });
  it("never admits Investigation subjects without an existing owner/kind adapter",()=>{
    const subjects=[{owner:"terminal.analysis_symbol",kind:"security",object_id:"NVDA"}];
    expect(investigationSubjectsToSemanticValue(subjects))
      .toEqual({status:"missing_adapter",reason:"investigation_subject_owner_not_admitted"});
    expect(investigationSubjectsToSemanticValue(subjects,[{
      owner:"terminal.analysis_symbol",kinds:["security"],
    }])).toEqual({status:"qualified",value:selection("NVDA")});
  });
});


describe("native owner cannot be widened by heterogeneous emitters", () => {
  it("refuses mixed emitter owner declarations the native publisher cannot distinguish", () => {
    const g=group();
    g.ports.push({
      port_id:"theme-source",origin_id:"theme-source-origin",direction:"emit",mode:"linked",
      accepts:["entity_selection"],ref_accepts:[{owner:"macro.theme_registry",kinds:["theme"]}],
      temporal_capabilities:["live"],
    });
    expect(validateSemanticContextGroup(g).ok).toBe(true);
    expect(nativeGroupFromSemanticDeclaration(g)).toEqual({
      ok:false,reason:"native_emitter_support_conflict",
    });
  });
  it("refuses altered native refs_json that could decode duplicate object keys", () => {
    expect(decodeNativeSemanticValue({
      kind:"entity_set",
      refs_json:'[{"owner":"terminal.analysis_symbol","kind":"security","object_id":"AAPL","object_id":"NVDA"}]',
    }).ok).toBe(false);
  });
  it("uses #802 incarnation fencing for an old prepared frame after consumer remount", () => {
    const s=native();
    const planned=prepareNativeSemanticFrame(s,group(),"chart",delta(),1);
    expect(planned.ok).toBe(true);
    if(!planned.ok)return;
    s.unregister("chart");
    expect(s.register({id:"chart",group:"primary_security",emit:true})).toBe(true);
    expect(s.publish(planned.value).status).toBe("stale_origin");
    expect(s.snapshot("chart")?.group_revision).toBe(0);
  });
});


describe("native identity and transport refusal", () => {
  it("refuses a semantic group or port ID that the incumbent native owner cannot register", () => {
    expect(validateSemanticContextGroup({ ...group(), group_id: "primary.security" }).ok).toBe(true);
    expect(nativeGroupFromSemanticDeclaration({ ...group(), group_id: "primary.security" })).toEqual({
      ok: false, reason: "native_identifier_unsupported",
    });
    const withUnsupportedPort=group();
    withUnsupportedPort.ports[0]={...withUnsupportedPort.ports[0],port_id:"chart.primary"};
    expect(validateSemanticContextGroup(withUnsupportedPort).ok).toBe(true);
    expect(nativeGroupFromSemanticDeclaration(withUnsupportedPort)).toEqual({
      ok:false, reason:"native_identifier_unsupported",
    });
  });
  it("refuses a native declaration without a linked emitter", () => {
    const onlyReaders=group();
    onlyReaders.ports=onlyReaders.ports.map(port=>({...port,direction:"consume"}));
    expect(nativeGroupFromSemanticDeclaration(onlyReaders)).toEqual({
      ok:false,reason:"native_no_emitter",
    });
  });
  it("does not mint missing group history or reinterpret a detached old native frame", () => {
    const g=group(),s=native(g);
    expect(nativeGroupFromSemanticDeclaration({...g,revision:7})).toEqual({
      ok:false,reason:"native_history_not_importable",
    });
    const original=prepareNativeSemanticFrame(s,g,"chart",delta(),1);
    if(!original.ok)throw Error("not prepared");
    expect(s.publish(original.value).status).toBe("applied");
    const stale=prepareNativeSemanticFrame(s,g,"chart",delta(undefined,{base_revision:0}),2);
    expect(stale.ok).toBe(false);
    expect(s.publish(original.value).status).toBe("duplicate");
    expect(s.snapshot("chart")?.group_revision).toBe(1);
  });
});


describe("P2 uses the *existing* Chart Bus active_security group", () => {
  const nativeChart = () => {
    const session=createWorkspaceContextSession("epoch-one",[{
      id:"active_security",
      initial:{kind:"security",id:"AAPL",timeframe:"1D",pane_id:0},
      accepts:(value)=>Object.keys(value).length===4
        &&value.kind==="security"&&typeof value.id==="string"
        &&typeof value.timeframe==="string"
        &&Number.isInteger(value.pane_id)&&Number(value.pane_id)>=0,
    }]);
    expect(session.register({id:"active-chart",group:"active_security",emit:true})).toBe(true);
    expect(session.register({id:"brain",group:"active_security",emit:false})).toBe(true);
    return session;
  };
  const declared = (): SemanticContextGroup => ({
    ...group(),group_id:"active_security",
    ports: [
      {...group().ports[0],port_id:"active-chart",origin_id:"chart-origin"},
      {...group().ports[1],port_id:"brain",origin_id:"brain-origin"},
    ],
  });
  it("updates the original active-security group, retaining timeframe/pane, with one native revision", () => {
    const s=nativeChart(),g=declared();
    const prepared=prepareNativeSemanticFrame(s,g,"active-chart",
      delta(selection("NVDA"),{group_id:"active_security"}),1);
    expect(prepared).toEqual({ok:true,value:{
      epoch:"epoch-one",origin:"active-chart",origin_generation:1,sequence:1,
      value:{kind:"security",id:"NVDA",timeframe:"1D",pane_id:0},
    }});
    if(!prepared.ok)return;
    expect(s.snapshot("brain")?.group_revision).toBe(0);
    expect(s.publish(prepared.value).status).toBe("applied");
    expect(s.snapshot("brain")?.group_revision).toBe(1);
    expect(s.snapshot("active-chart")?.value).toEqual({
      kind:"security",id:"NVDA",timeframe:"1D",pane_id:0,
    });
    expect(projectNativeSemanticPort(s,g,"brain")).toEqual({
      status:"qualified",value:selection("NVDA"),
    });
    expect(s.publish(prepared.value).status).toBe("duplicate");
  });
  it("does not invent a timeframe or pane when native Chart Bus context is incomplete", () => {
    const s=createWorkspaceContextSession("epoch-one",[{
      id:"active_security",initial:{kind:"security",id:"AAPL",timeframe:"1D",pane_id:0},
      accepts:()=>true,
    }]);
    s.register({id:"active-chart",group:"active_security",emit:true});
    s.publish({epoch:"epoch-one",origin:"active-chart",
      origin_generation:s.snapshot("active-chart")!.incarnation,sequence:1,
      value:{kind:"security",id:"AAPL"},
    });
    const result=prepareNativeSemanticFrame(s,declared(),"active-chart",
      delta(selection("NVDA"),{group_id:"active_security",base_revision:1}),2);
    expect(result).toEqual({ok:false,reason:"native_chart_context_invalid"});
  });
  it("refuses a noncanonical symbol instead of normalizing the owner value", () => {
    const s=nativeChart();
    const input=delta(selection("nvda"),{group_id:"active_security"});
    expect(prepareNativeSemanticFrame(s,declared(),"active-chart",input,1)).toEqual({
      ok:false,reason:"native_chart_context_invalid",
    });
    expect(s.snapshot("active-chart")?.group_revision).toBe(0);
  });
});
