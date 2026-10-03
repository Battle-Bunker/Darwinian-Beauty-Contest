// Draws a garden Frame into an SVG group, imperatively: the bees, glows, effects and labels are built once
// and their attributes set each animation frame (only when they change), so a garden of many bees taking
// five turns a second costs a few attribute writes per bee per frame and no React work at all.
import type { BeeDraw, Frame, Layout } from "./gardenModel";
import { headOf } from "./gardenModel";

const NS = "http://www.w3.org/2000/svg";
type Attrs = Record<string, string | number>;

function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Attrs = {}, parent?: Element): SVGElementTagNameMap[K] {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  parent?.appendChild(e);
  return e;
}

/** setAttribute, skipped when the value hasn't changed since the last write. */
class Cached {
  private last = new Map<Element, Map<string, string>>();
  set(e: Element, name: string, value: string) {
    let m = this.last.get(e);
    if (!m) this.last.set(e, (m = new Map()));
    if (m.get(name) === value) return;
    m.set(name, value);
    e.setAttribute(name, value);
  }
  text(e: Element, value: string) {
    let m = this.last.get(e);
    if (!m) this.last.set(e, (m = new Map()));
    if (m.get("#text") === value) return;
    m.set("#text", value);
    e.textContent = value;
  }
}

interface BeeNodes {
  g: SVGGElement; halo: SVGCircleElement; visitor: SVGCircleElement; pose: SVGGElement; wings: SVGGElement;
  name: SVGTextElement; bubble: SVGGElement; bubbleRect: SVGRectElement; bubbleText: SVGTextElement;
}
interface FxNodes { g: SVGGElement; glow: SVGCircleElement; sparkles: SVGPathElement[]; text: SVGTextElement }

export interface PainterTeam { name: string; color: string }

const SPARKLE = "M0 -4 L1.2 -1.2 4 0 1.2 1.2 0 4 -1.2 1.2 -4 0 -1.2 -1.2Z";
const f1 = (x: number) => x.toFixed(1);

export class GardenPainter {
  private c = new Cached();
  private bees: BeeNodes[] = [];
  private glows: SVGCircleElement[] = [];
  private pings: SVGCircleElement[] = [];
  private fxPool: FxNodes[] = [];
  private labelPool: SVGTextElement[] = [];
  private trail: SVGPathElement;
  private readout: { g: SVGGElement; rect: SVGRectElement; t1: SVGTextElement; t2: SVGTextElement };
  private layout: Layout;

  constructor(private root: SVGGElement, layout: Layout, teams: PainterTeam[], clipId: string) {
    this.layout = layout;
    root.replaceChildren();
    const defs = el("defs", {}, root);
    const clip = el("clipPath", { id: clipId }, defs);
    el("ellipse", { rx: 11, ry: 7.5 }, clip);

    const glowLayer = el("g", {}, root);
    teams.forEach((_, f) => {
      const h = headOf(layout, f);
      this.glows.push(el("circle", { cx: f1(h.x), cy: f1(h.y), r: 34, class: "visit-glow", opacity: 0 }, glowLayer));
      this.pings.push(el("circle", { cx: f1(h.x), cy: f1(h.y), r: 40, class: "focus-ping", opacity: 0 }, glowLayer));
    });
    this.trail = el("path", { class: "focus-trail", d: "", opacity: 0 }, root);

    const beeLayer = el("g", {}, root);
    teams.forEach((t) => {
      const g = el("g", { class: "bee" }, beeLayer);
      const title = el("title", {}, g);
      title.textContent = `${t.name}'s bee`;
      const halo = el("circle", { r: 19, class: "bee-halo", display: "none" }, g);
      const visitor = el("circle", { r: 18, class: "bee-visitor", display: "none" }, g);
      const pose = el("g", {}, g);
      const wings = el("g", {}, pose);
      el("ellipse", { cx: -3, cy: -9, rx: 7, ry: 5, class: "bee-wing" }, wings);
      el("ellipse", { cx: 4, cy: -9, rx: 6, ry: 4.5, class: "bee-wing" }, wings);
      el("path", { d: "M-11 0 l-5 0 l5 -2.5z", class: "bee-sting" }, pose);
      el("ellipse", { rx: 11, ry: 7.5, fill: t.color, class: "bee-body" }, pose);
      const stripes = el("g", { "clip-path": `url(#${clipId})` }, pose);
      el("rect", { x: -6, y: -8, width: 3.4, height: 16, class: "bee-stripe" }, stripes);
      el("rect", { x: 0.5, y: -8, width: 3.4, height: 16, class: "bee-stripe" }, stripes);
      el("ellipse", { rx: 11, ry: 7.5, fill: "none", class: "bee-outline" }, pose);
      el("circle", { cx: 11.5, cy: -1, r: 4.6, class: "bee-head" }, pose);
      el("circle", { cx: 13, cy: -2.3, r: 1.3, class: "bee-eye" }, pose);
      const name = el("text", { y: 23, class: "bee-name" }, g);
      name.textContent = t.name.length > 12 ? t.name.slice(0, 11) + "…" : t.name;
      const bubble = el("g", { display: "none" }, g);
      const bubbleRect = el("rect", { y: -9, height: 17, rx: 8.5, class: "bubble" }, bubble);
      const bubbleText = el("text", { y: 4, class: "bubble-text" }, bubble);
      this.bees.push({ g, halo, visitor, pose, wings, name, bubble, bubbleRect, bubbleText });
    });

    const fxLayer = el("g", { class: "fx" }, root);
    for (let i = 0; i < Math.max(16, teams.length + 4); i++) {
      const g = el("g", { display: "none" }, fxLayer);
      const glow = el("circle", { r: 18, class: "fx-glow" }, g);
      const sparkles = [0, 1, 2, 3, 4].map(() => el("path", { d: SPARKLE, class: "fx-sparkle" }, g));
      el("path", { d: "M0 -12 C -4 -6 -7 -2 -7 2 a7 7 0 0 0 14 0 c0 -4 -3 -8 -7 -14z", class: "fx-drop", transform: "translate(0 -16) scale(.7)" }, g);
      const text = el("text", { x: 9, y: -18, class: "fx-text" }, g);
      this.fxPool.push({ g, glow, sparkles, text });
    }
    const labelLayer = el("g", {}, root);
    for (let i = 0; i < 24; i++) this.labelPool.push(el("text", { class: "float-label", display: "none" }, labelLayer));

    const rg = el("g", { class: "readout", display: "none" }, root);
    this.readout = {
      g: rg,
      rect: el("rect", { rx: 8, height: 34, class: "readout-box" }, rg),
      t1: el("text", { y: 13, class: "readout-1" }, rg),
      t2: el("text", { y: 28, class: "readout-2" }, rg),
    };
  }

  paint(frame: Frame, names: boolean) {
    const c = this.c;
    frame.glow.forEach((v, f) => {
      const g = this.glows[f];
      if (!g) return;
      c.set(g, "opacity", (0.5 * v).toFixed(2));
      if (v > 0) c.set(g, "r", f1(32 + 6 * (1 - v)));
    });
    frame.ping.forEach((v, f) => {
      const g = this.pings[f];
      if (!g) return;
      c.set(g, "opacity", v.toFixed(2));
      if (v > 0) c.set(g, "r", f1(40 + 16 * (1 - v)));
    });
    if (frame.trail) {
      const { from: a, to: b, o } = frame.trail;
      const dist = Math.hypot(b.x - a.x, b.y - a.y);
      const cy = Math.min(a.y, b.y) - 10 - dist * 0.16;
      c.set(this.trail, "d", `M${f1(a.x)} ${f1(a.y)} Q ${f1((a.x + b.x) / 2)} ${f1(cy)} ${f1(b.x)} ${f1(b.y)}`);
      c.set(this.trail, "opacity", o.toFixed(2));
    } else c.set(this.trail, "opacity", "0");

    frame.bees.forEach((b, i) => this.paintBee(this.bees[i], b, names));

    this.fxPool.forEach((nodes, i) => {
      const f = frame.fx[i];
      if (!f) { c.set(nodes.g, "display", "none"); return; }
      const u = f.u;
      const fade = u < 0.12 ? u / 0.12 : 1 - Math.max(0, (u - 0.55) / 0.45);
      c.set(nodes.g, "display", "inline");
      c.set(nodes.g, "transform", `translate(${f1(f.x)} ${f1(f.y - 6 - u * 18)})`);
      c.set(nodes.g, "opacity", fade.toFixed(2));
      c.set(nodes.glow, "r", f1(14 + u * 10));
      c.text(nodes.text, f.text ?? "");
      nodes.sparkles.forEach((s, k) => {
        const a = (k / 5) * Math.PI * 2 + u * 3, r = 10 + u * 13;
        c.set(s, "transform", `translate(${f1(Math.cos(a) * r)} ${f1(Math.sin(a) * r)})`);
      });
    });

    this.labelPool.forEach((t, i) => {
      const l = frame.labels[i];
      if (!l) { c.set(t, "display", "none"); return; }
      const fade = l.u < 0.1 ? l.u / 0.1 : 1 - Math.max(0, (l.u - 0.6) / 0.4);
      c.set(t, "display", "inline");
      c.set(t, "x", f1(l.x));
      c.set(t, "y", f1(l.y - l.u * 22));
      c.set(t, "opacity", fade.toFixed(2));
      c.set(t, "class", `float-label float-${l.kind}`);
      c.text(t, l.text);
    });

    const r = frame.readout, ro = this.readout;
    if (!r || !this.layout.pos[r.flower]) c.set(ro.g, "display", "none");
    else {
      const p = this.layout.pos[r.flower];
      const w = Math.max(r.line1.length, r.line2.length) * 6.3 + 16;
      c.set(ro.g, "display", "inline");
      c.set(ro.g, "transform", `translate(${f1(p.x)} ${f1(p.y + 52)})`);
      c.set(ro.g, "class", `readout readout-${r.kind} ${r.age < 140 ? "fresh" : ""}`);
      c.set(ro.rect, "x", f1(-w / 2));
      c.set(ro.rect, "width", f1(w));
      c.text(ro.t1, r.line1);
      c.text(ro.t2, r.line2);
    }
  }

  private paintBee(n: BeeNodes | undefined, b: BeeDraw, names: boolean) {
    if (!n) return;
    const c = this.c;
    c.set(n.g, "transform", `translate(${f1(b.x)} ${f1(b.y)})`);
    c.set(n.g, "class", `bee bee-${b.mode}`);
    c.set(n.halo, "display", b.ring === "mine" ? "inline" : "none");
    c.set(n.visitor, "display", b.ring === "visitor" ? "inline" : "none");
    c.set(n.pose, "transform", `rotate(${b.tilt.toFixed(0)}) scale(${b.flip ? -1 : 1} 1)`);
    c.set(n.wings, "transform", b.flap < 1 ? `translate(0 -5) scale(1 ${b.flap.toFixed(2)}) translate(0 5)` : "");
    c.set(n.name, "display", names || b.named ? "inline" : "none");
    if (!b.bubble) { c.set(n.bubble, "display", "none"); return; }
    const w = 12 + b.bubble.length * 6.6;
    c.set(n.bubble, "display", "inline");
    c.set(n.bubble, "transform", `translate(${b.flip ? -16 : 16} -22) scale(${(0.75 + 0.25 * b.pop).toFixed(2)})`);
    c.set(n.bubble, "class", `bubble-g bubble-${b.bubbleKind}`);
    c.set(n.bubbleRect, "x", f1(-w / 2));
    c.set(n.bubbleRect, "width", f1(w));
    c.text(n.bubbleText, b.bubble);
  }

  destroy() { this.root.replaceChildren(); }
}
