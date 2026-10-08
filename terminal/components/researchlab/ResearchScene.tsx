"use client";
import React, { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { Lang } from "@/lib/i18n";
import type { ResearchDomain, ResearchMark } from "./researchLabAdapter";
import styles from "./ResearchLab.module.css";

/** One batched point draw, demand-driven frames; no data requests and no animation loop. */
export default function ResearchScene({ marks, domain, selected, onSelect, onFailure, lang }: {
  marks: ResearchMark[]; domain: ResearchDomain; selected: string | null;
  onSelect: (key: string, origin: HTMLCanvasElement) => void; onFailure: () => void; lang: Lang;
}) {
  const pick = (en: string, zh: string) => lang === "zh" ? zh : en;
  const host = useRef<HTMLDivElement>(null);
  const actions = useRef<{ preset: (mode: string) => void; select: (key: string | null) => void;
    update: (marks: ResearchMark[], domain: ResearchDomain) => void } | null>(null);
  const callbacks = useRef({ onSelect, onFailure, selected });
  useEffect(() => { callbacks.current = { onSelect, onFailure, selected }; }, [onSelect, onFailure, selected]);
  useEffect(() => {
    const container = host.current;
    if (!container) return;
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "low-power" }); }
    catch { callbacks.current.onFailure(); return; }
    let drawn: ResearchMark[] = [];
    const extent = { magnitude: 1.6, strike: 1, expiry: .75 };
    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-2.5, 2.5, 1.65, -1.65, .1, 100);
    const canvas = renderer.domElement;
    canvas.tabIndex = 0;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    container.append(canvas);
    const controls = new OrbitControls(camera, canvas);
    controls.enableDamping = false; controls.minZoom = .6; controls.maxZoom = 5;
    controls.target.set(0, 0, 0);
    const geometry = new THREE.BufferGeometry();
    let positions = new Float32Array(0), sizes = new Float32Array(0);
    let colors = new Float32Array(0), hollow = new Float32Array(0), highlights = new Float32Array(0);
    const material = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, uniforms: { pixelRatio: { value: renderer.getPixelRatio() }, ink: { value: new THREE.Color() } },
      vertexShader: `attribute float markSize; attribute vec3 markColor; attribute float hollow; attribute float highlight;
        uniform float pixelRatio; varying vec3 vColor; varying float vHollow; varying float vHighlight;
        void main(){vColor=markColor;vHollow=hollow;vHighlight=highlight;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);gl_PointSize=(markSize+highlight*6.)*pixelRatio;}`,
      fragmentShader: `uniform vec3 ink; varying vec3 vColor; varying float vHollow; varying float vHighlight;
        void main(){float d=length(gl_PointCoord-vec2(.5));if(d>.5)discard;
        if(vHollow>.5&&d<.34)discard;vec3 c=vHighlight>.5&&d>.4?ink:vColor;gl_FragColor=vec4(c,.86);}` });
    const points = new THREE.Points(geometry, material); points.visible = false; scene.add(points);
    const grid = new THREE.GridHelper(3.6, 12); grid.position.y = -1.1; scene.add(grid);
    const render = () => { if (!renderer.getContext().isContextLost()) renderer.render(scene,camera); };
    const paint = () => {
      const css = getComputedStyle(container);
      const call = new THREE.Color(css.getPropertyValue("--brand-2").trim());
      const put = new THREE.Color(css.getPropertyValue("--warn").trim());
      drawn.forEach((m,i) => { const c=m.side==="call"?call:put; colors.set([c.r,c.g,c.b],i*3); });
      geometry.attributes.markColor.needsUpdate=true;
      material.uniforms.ink.value.set(css.getPropertyValue("--text").trim());
      const line = css.getPropertyValue("--line-3").trim();
      (Array.isArray(grid.material)?grid.material:[grid.material]).forEach(m => { (m as THREE.LineBasicMaterial).color.set(line); });
      render();
    };
    const resize = () => {
      const w = Math.max(1, container.clientWidth), h = Math.max(1, container.clientHeight);
      renderer.setSize(w, h);
      // A sphere around the full normalized snapshot fits at every orbit angle.
      // Reserve 22 CSS px for the largest 34px mark + 6px selection ring, with
      // a small margin. Fit the shorter viewport axis, not just its height.
      // Filters retain these bounds; explicit user zoom/pan remain untouched.
      const radius = Math.hypot(extent.magnitude, extent.strike, extent.expiry);
      const unitsPerPixel = 2 * radius / Math.max(1, Math.min(w, h) - 44);
      camera.left = -w * unitsPerPixel / 2; camera.right = -camera.left;
      camera.top = h * unitsPerPixel / 2; camera.bottom = -camera.top;
      camera.updateProjectionMatrix(); render();
    };
    const preset = (mode: string) => {
      camera.up.set(0,1,0); camera.zoom=1;
      if(mode==="front")camera.position.set(0,0,6);
      else if(mode==="top"){camera.position.set(0,6,.001);camera.up.set(0,0,-1);}
      else camera.position.set(3,2.2,5);
      controls.target.set(0,0,0); controls.update(); camera.updateProjectionMatrix();render();
    };
    const select = (key: string | null) => {drawn.forEach((m,i)=>{highlights[i]=m.key===key?1:0;});if(geometry.attributes.highlight)geometry.attributes.highlight.needsUpdate=true;render();};
    const update = (marks: ResearchMark[], domain: ResearchDomain) => {
      drawn = marks.slice(0, 20000);
      if (sizes.length !== drawn.length) {
        // Release the old GPU buffers before replacing attributes. The renderer,
        // camera and controls stay mounted, including the user's current orbit.
        geometry.dispose();
        positions = new Float32Array(drawn.length * 3); sizes = new Float32Array(drawn.length);
        colors = new Float32Array(drawn.length * 3); hollow = new Float32Array(drawn.length); highlights = new Float32Array(drawn.length);
        geometry.setAttribute("position", new THREE.BufferAttribute(positions,3));
        geometry.setAttribute("markSize", new THREE.BufferAttribute(sizes,1));
        geometry.setAttribute("markColor", new THREE.BufferAttribute(colors,3));
        geometry.setAttribute("hollow", new THREE.BufferAttribute(hollow,1));
        geometry.setAttribute("highlight", new THREE.BufferAttribute(highlights,1));
      }
      const { expiries, minStrike: lo, maxStrike: hi, maxValue: maximum } = domain;
      const expiryIndex = new Map(expiries.map((e,i) => [e,i]));
      drawn.forEach((m,i) => {
        positions[i*3] = (m.side === "put" ? -1 : 1) * Math.abs(m.value) / maximum * extent.magnitude;
        positions[i*3+1] = hi === lo ? 0 : ((m.strike-lo)/(hi-lo)*2-1) * extent.strike;
        positions[i*3+2] = expiries.length === 1 ? 0 : (expiryIndex.get(m.expiry)!/(expiries.length-1)*2-1) * extent.expiry;
        sizes[i] = Math.max(2, Math.min(domain.maxDiameter, Math.sqrt(Math.abs(m.value)/maximum)*domain.maxDiameter));
        hollow[i] = m.value < 0 ? 1 : 0;
        highlights[i] = m.key === callbacks.current.selected ? 1 : 0;
      });
      for (const name of ["position", "markSize", "hollow", "highlight"]) geometry.attributes[name].needsUpdate = true;
      geometry.computeBoundingSphere();
      points.visible = drawn.length > 0;
      paint();
    };
    actions.current = { preset, select, update };
    const resizeObserver = new ResizeObserver(resize); resizeObserver.observe(container);
    const themeObserver = new MutationObserver(paint);themeObserver.observe(document.documentElement,{attributes:true,attributeFilter:["data-theme","class"]});
    controls.addEventListener("change",render);
    let start = { x:0,y:0 };
    const down=(e:PointerEvent)=>{start={x:e.clientX,y:e.clientY};};
    const up=(e:PointerEvent)=>{
      if(Math.hypot(e.clientX-start.x,e.clientY-start.y)>5)return;
      const began=performance.now(), rect=canvas.getBoundingClientRect(), v=new THREE.Vector3();
      let found=-1, best=Infinity;
      // Project to screen for the same screen-space radius as the shader; no financial
      // value is reconstructed from screen position. The retained array owns identity.
      drawn.forEach((_,i)=>{v.fromArray(positions,i*3).project(camera);if(v.z < -1 || v.z > 1)return;
        const x=rect.left+(v.x+1)/2*rect.width,y=rect.top+(1-v.y)/2*rect.height;
        const distance=Math.hypot(e.clientX-x,e.clientY-y);
        if(distance<=Math.max(8,sizes[i]/2)&&distance<best){best=distance;found=i;}});
      canvas.dataset.pickMs=String(performance.now()-began);
      if(found>=0){canvas.focus();callbacks.current.onSelect(drawn[found].key,canvas);}
    };
    const key=(e:KeyboardEvent)=>{if(!["ArrowLeft","ArrowRight","ArrowUp","ArrowDown"].includes(e.key))return;e.preventDefault();
      const current=drawn.findIndex(m=>m.key===callbacks.current.selected);
      const delta=e.key==="ArrowLeft"||e.key==="ArrowUp"?-1:1;
      const index=(current+delta+drawn.length)%drawn.length;if(drawn[index])callbacks.current.onSelect(drawn[index].key,canvas);};
    const lost=(e:Event)=>{e.preventDefault();callbacks.current.onFailure();};
    canvas.addEventListener("pointerdown",down);canvas.addEventListener("pointerup",up);canvas.addEventListener("keydown",key);canvas.addEventListener("webglcontextlost",lost);
    preset("iso");resize();
    return ()=>{actions.current=null;resizeObserver.disconnect();themeObserver.disconnect();controls.removeEventListener("change",render);controls.dispose();
      canvas.removeEventListener("pointerdown",down);canvas.removeEventListener("pointerup",up);canvas.removeEventListener("keydown",key);canvas.removeEventListener("webglcontextlost",lost);
      geometry.dispose();material.dispose();grid.geometry.dispose();(Array.isArray(grid.material)?grid.material:[grid.material]).forEach(m=>m.dispose());renderer.dispose();renderer.forceContextLoss();canvas.remove();};
  }, []);
  useEffect(() => { actions.current?.update(marks, domain); }, [marks, domain]);
  useEffect(() => { actions.current?.select(selected); }, [selected]);
  useEffect(() => {
    host.current?.querySelector("canvas")?.setAttribute("aria-label", lang === "zh" ? "期权链三维图，方向键选择，精确值见下表" : "3D chain. Arrow keys select. Exact values are in the table below.");
  }, [lang]);
  const first=domain.expiries[0],last=domain.expiries.at(-1);
  return <><div className={styles.axes}><span>{pick("Strike ↑", "行权价 ↑")}: {domain.minStrike}–{domain.maxStrike}</span><span>{pick("Expiry depth", "到期日纵深")}: {first} → {last}</span>
    <span>{pick("Distance and area: magnitude · fixed snapshot scale", "距离与面积：绝对值 · 固定快照比例")}: 0–{domain.maxValue.toLocaleString()}</span></div>
    <div ref={host} className={styles.scene} data-testid="research-scene" />
    <div className={styles.sceneControls}>{[["iso",lang==="zh"?"重置":"Reset"],["front",lang==="zh"?"正视":"Front"],["top",lang==="zh"?"俯视":"Top"]].map(([mode,label])=><button key={mode} onClick={()=>actions.current?.preset(mode)}>{label}</button>)}</div></>;
}
