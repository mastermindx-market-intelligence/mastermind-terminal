// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import ResearchScene from "@/components/researchlab/ResearchScene";
import type { ResearchDomain, ResearchMark } from "@/components/researchlab/researchLabAdapter";

// jsdom has no GPU. Keep the real scene, geometry, camera, and OrbitControls;
// replace only WebGL submission and examine the actual projected mark extents.
const frame = vi.hoisted(() => ({ scene: null as unknown, camera: null as unknown }));
vi.mock("three", async importOriginal => {
  const actual = await importOriginal<typeof import("three")>();
  return { ...actual, WebGLRenderer: class {
    domElement = document.createElement("canvas");
    setPixelRatio() {}
    getPixelRatio() { return 1; }
    setSize() {}
    getContext() { return { isContextLost: () => false }; }
    render(scene: THREE.Scene, camera: THREE.Camera) {
      scene.updateMatrixWorld(); camera.updateMatrixWorld();
      frame.scene = scene; frame.camera = camera;
    }
    dispose() {}
    forceContextLoss() {}
  } };
});

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const domain: ResearchDomain = { minStrike: 100, maxStrike: 200, maxValue: 100,
  expiries: ["2026-10-09", "2026-11-20"], maxDiameter: 34 };
const marks: ResearchMark[] = domain.expiries.flatMap(expiry => [100, 200].flatMap(strike =>
  (["call", "put"] as const).map(side => ({ key: `${expiry}|${strike}|${side}`, expiry, strike, side, value: 100 }))));
let root: Root, host: HTMLDivElement, sheet: HTMLStyleElement;
let width = 300, height = 400, resize: () => void;

beforeEach(() => {
  frame.scene = null; frame.camera = null;
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(() => width);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(() => height);
  vi.stubGlobal("ResizeObserver", class {
    constructor(callback: () => void) { resize = callback; }
    observe() {}
    disconnect() {}
  });
  sheet = document.createElement("style");
  sheet.textContent = "div{--brand-2:#4d82ff;--warn:#e8a33d;--text:#d6dae3;--line-3:#33373f}";
  document.head.append(sheet);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount()); host.remove(); sheet.remove();
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});
function mount() {
  act(() => root.render(<ResearchScene marks={marks} domain={domain} selected={marks[0].key}
    onSelect={() => {}} onFailure={() => { throw new Error("unexpected renderer failure"); }} lang="en" />));
}
function view(label: string) {
  const button = [...host.querySelectorAll("button")].find(b => b.textContent === label)!;
  act(() => button.click());
}
function expectAllMarksInside() {
  const scene = frame.scene as THREE.Scene, camera = frame.camera as THREE.Camera;
  const points = scene.children.find(child => child instanceof THREE.Points) as THREE.Points;
  const geometry = points.geometry, position = geometry.getAttribute("position");
  for (let i = 0; i < position.count; i++) {
    const projected = new THREE.Vector3().fromBufferAttribute(position, i).project(camera);
    const radius = (geometry.getAttribute("markSize").getX(i) + geometry.getAttribute("highlight").getX(i) * 6) / 2;
    expect(Math.abs(projected.x) * width / 2 + radius, `mark ${i} horizontal edge`).toBeLessThanOrEqual(width / 2);
    expect(Math.abs(projected.y) * height / 2 + radius, `mark ${i} vertical edge`).toBeLessThanOrEqual(height / 2);
    expect(Math.abs(projected.z)).toBeLessThanOrEqual(1);
  }
}

describe("research scene framing", () => {
  for (const size of [[128, 320], [300, 400], [800, 400], [1440, 320]]) {
    for (const label of ["Reset", "Front", "Top"]) {
      it(`fits the full snapshot and selected ring in ${label} at ${size.join("x")}`, () => {
        [width, height] = size; mount(); view(label); expectAllMarksInside();
      });
    }
  }
  it("reframes a resized viewport without remounting, losing selection, or resetting user zoom", () => {
    width = 800; height = 400; mount(); view("Front");
    const canvas = host.querySelector("canvas"), camera = frame.camera as THREE.OrthographicCamera;
    const position = camera.position.clone();
    camera.zoom = .8; camera.updateProjectionMatrix();
    width = 128; height = 320; act(() => resize());
    expect(host.querySelector("canvas")).toBe(canvas);
    expect(camera.position.equals(position)).toBe(true);
    expect(camera.zoom).toBe(.8);
    const points = (frame.scene as THREE.Scene).children.find(child => child instanceof THREE.Points) as THREE.Points;
    expect(points.geometry.getAttribute("highlight").getX(0)).toBe(1);
    expectAllMarksInside();
  });
  it("keeps the full snapshot in frame between presets and keeps its scale when filtering", () => {
    width = 128; height = 320; mount();
    const camera = frame.camera as THREE.OrthographicCamera;
    const bounds = [camera.left, camera.right, camera.top, camera.bottom];
    for (const position of [[6, -2, -3], [-6, 2, 3], [0, -6, .1]]) {
      camera.position.set(position[0], position[1], position[2]);
      camera.lookAt(0, 0, 0); camera.updateMatrixWorld();
      expectAllMarksInside();
    }
    act(() => root.render(<ResearchScene marks={marks.slice(0, 2)} domain={domain} selected={marks[0].key}
      onSelect={() => {}} onFailure={() => { throw new Error("unexpected renderer failure"); }} lang="en" />));
    expect([camera.left, camera.right, camera.top, camera.bottom]).toEqual(bounds);
    expectAllMarksInside();
  });
});
