"use client";
import { useEffect, useState } from "react";
import { flowGetResult } from "@/lib/flowClientCache";
import { exposureMoveDistance } from "@/lib/exposureWorkspace";
import { exposureValue } from "@/lib/exposureMap";
import styles from "./ExposureMap.module.css";

/** One cached owner read per root; inspecting another strike does not refetch. */
export default function ExposureDistance({root,session,spot,target,zh}:{root:string;session:string|null;spot:number|null;target:number|null;zh:boolean}) {
  const [stored,setStored] = useState<{root:string; raw:unknown; now:number}|null>(null);
  useEffect(() => {
    let active = true;
    void flowGetResult(`moves:${root}`).then(result => {
      if (active) setStored({root,raw:result.status === "data" ? result.data : null,now:Date.now()});
    });
    return () => { active = false; };
  },[root]);
  const move = stored?.root === root ? exposureMoveDistance(stored.raw,root,session,spot,target,stored.now) : null;
  return <div className={styles.impliedDistance} data-testid="exposure-implied-distance"><span>{zh ? "隐含波动距离" : "IMPLIED-VOLATILITY DISTANCE"}</span><strong>{move ? `${exposureValue(move.distance,2)} σ` : "—"}</strong><small>{move ? (zh ? `${move.horizonDays} 天尺度 · ${move.session}` : `${move.horizonDays}-day scale · ${move.session}`) : (zh ? "需要匹配同一日期与参考现价的波动幅度" : "Requires a matching session and reference price")}</small><details><summary>{zh ? "计算依据" : "Basis"}</summary><p>{zh ? "距离除以现有预期波动来源的单标准差尺度。保留来源期限；不是触及概率或预测区间。" : "Distance divided by the existing move source’s one-standard-deviation scale, at its stated horizon. This is not a touch probability or forecast interval."}</p></details></div>;
}
