"use client";
import { exposureMapT } from "./exposureMapStrings";
import { useEffect, useState } from "react";
import { flowGetResult } from "@/lib/flowClientCache";
import { exposureMoveDistance } from "@/lib/exposureWorkspace";
import { exposureValue } from "@/lib/exposureMap";
import styles from "./ExposureMap.module.css";

/** One cached owner read per root; inspecting another strike does not refetch. */
export default function ExposureDistance({root,session,spot,target,zh}:{root:string;session:string|null;spot:number|null;target:number|null;zh:boolean}) {
  const t = exposureMapT(zh ? "zh" : "en");
  const [stored,setStored] = useState<{root:string; raw:unknown; now:number}|null>(null);
  useEffect(() => {
    let active = true;
    void flowGetResult(`moves:${root}`).then(result => {
      if (active) setStored({root,raw:result.status === "data" ? result.data : null,now:Date.now()});
    });
    return () => { active = false; };
  },[root]);
  const move = stored?.root === root ? exposureMoveDistance(stored.raw,root,session,spot,target,stored.now) : null;
  return <div className={styles.impliedDistance} data-testid="exposure-implied-distance"><span>{t("impliedVolatilityDistance")}</span><strong>{move ? `${exposureValue(move.distance,2)} σ` : "—"}</strong><small>{move ? (zh ? `${move.horizonDays} 天尺度 · ${move.session}` : `${move.horizonDays}-day scale · ${move.session}`) : (t("requiresAMatchingSessionAndReferencePrice"))}</small><details><summary>{t("basis")}</summary><p>{t("distanceDividedByTheExistingMoveSourceS")}</p></details></div>;
}
