import { animate as animateValue } from "motion";

/** Data stays final in the DOM; motion supports reading and selection. */
export function createStoryMotion() {
  const media = window.matchMedia("(prefers-reduced-motion: reduce)");
  const active = new Set();
  const cancellers = new Set();
  const listeners = new Set();
  const entered = new WeakSet();
  const counters = new WeakMap();
  const scrollTasks = new Map();
  const deferredEntries = new Set();
  let frame = null;
  let forceUpdate = false;
  const easing = "cubic-bezier(0.22, 1, 0.36, 1)";
  const reduced = () => media.matches;
  const clamp = value => Math.max(0, Math.min(1, value));

  function cancelAll() {
    for (const animation of active) animation.cancel();
    active.clear();
    for (const cancel of [...cancellers]) cancel();
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
  }
  function updateScroll() {
    frame = null;
    const force = forceUpdate;
    forceUpdate = false;
    if (document.hidden) return;
    // Batch layout reads before visual writes.
    const readings = [...scrollTasks].map(([element, task]) => {
      const rect = element.getBoundingClientRect();
      const from = innerHeight * task.start;
      const to = innerHeight * task.end;
      const progress = reduced() ? 1 : clamp((from - rect.top) / Math.max(1, from - to));
      return { task, progress };
    });
    for (const { task, progress } of readings) {
      if (force || task.last !== progress) {
        task.last = progress;
        task.draw(progress, reduced());
      }
    }
    const extent = document.documentElement.scrollHeight - innerHeight;
    document.querySelector(".reading-progress")?.style.setProperty("--progress", extent > 0 ? clamp(scrollY / extent) : 1);
  }
  function refresh(force = false) {
    forceUpdate ||= force;
    if (frame === null && !document.hidden) frame = requestAnimationFrame(updateScroll);
  }
  function sync() {
    document.documentElement.classList.toggle("motion-reduced", reduced());
    if (reduced()) cancelAll();
    for (const listener of listeners) listener(reduced());
    refresh(true);
  }
  media.addEventListener("change", sync);
  window.addEventListener("scroll", () => refresh(), { passive: true });
  window.addEventListener("resize", () => refresh(true), { passive: true });
  window.addEventListener("pageshow", () => refresh(true));
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) cancelAll();
    else {
      for (const start of [...deferredEntries]) {
        deferredEntries.delete(start);
        start();
      }
      refresh(true);
    }
  });
  window.addEventListener("pagehide", cancelAll);
  new ResizeObserver(() => refresh(true)).observe(document.body);
  sync();

  function animate(element, frames, options = {}) {
    if (!element || reduced() || document.hidden || !element.animate) return;
    const { concurrent = false, ...timing } = options;
    if (!concurrent) element.getAnimations().forEach(animation => animation.cancel());
    const animation = element.animate(frames, {
      duration: 500, easing, fill: "backwards", ...timing,
    });
    active.add(animation);
    animation.finished.then(() => active.delete(animation), () => active.delete(animation));
    return animation;
  }

  function once(element, callback, { amount = 0.15, margin = "0px 0px -48px 0px" } = {}) {
    if (!element) return;
    const threshold = amount === "all" ? 1 : amount === "some" ? 0 : amount;
    let observer = null;
    let stopped = false;
    function stop() {
      stopped = true;
      observer?.disconnect();
      deferredEntries.delete(start);
    }
    function start() {
      if (stopped) return;
      observer?.disconnect();
      if (document.hidden) {
        deferredEntries.add(start);
        return;
      }
      observer = new IntersectionObserver(entries => {
        if (stopped) return;
        if (document.hidden) {
          // Re-observe on return: a background intersection must not consume once.
          observer.disconnect();
          deferredEntries.add(start);
          return;
        }
        for (const entry of entries) {
          // isIntersecting alone may be true before the requested ratio is reached.
          if (!entry.isIntersecting || entry.intersectionRatio < threshold) continue;
          stop();
          entered.add(element);
          if (!reduced()) callback();
          break;
        }
      }, { threshold, rootMargin: margin });
      observer.observe(element);
    }
    start();
    return stop;
  }
  function draw(path, duration = 800, delay = 0) {
    if (!path || reduced()) return;
    const length = path.getTotalLength();
    if (!Number.isFinite(length) || length <= 0) return;
    animate(path, [
      { strokeDasharray: length + " " + length, strokeDashoffset: length },
      { strokeDasharray: length + " " + length, strokeDashoffset: 0 },
    ], { duration, delay });
  }
  function scroll(element, draw, { start = 0.9, end = 0.3 } = {}) {
    if (!element) return;
    scrollTasks.set(element, { draw, start, end, last: null });
    refresh(true);
  }
  function trace(path, halo, marker, duration = 1400) {
    if (!path || reduced() || document.hidden) return () => {};
    const length = path.getTotalLength();
    if (!Number.isFinite(length) || length <= 0) return () => {};
    const strokes = [path, halo].filter(Boolean);
    let controls;
    let settled = false;
    function cancel() {
      if (settled) return;
      settled = true;
      controls?.stop();
      for (const stroke of strokes) {
        stroke.style.removeProperty("stroke-dasharray");
        stroke.style.removeProperty("stroke-dashoffset");
      }
      if (marker) marker.style.opacity = "0";
      cancellers.delete(cancel);
    }
    function update(progress) {
      if (reduced() || document.hidden || !path.isConnected) {
        cancel();
        return;
      }
      for (const stroke of strokes) stroke.style.strokeDashoffset = length * (1 - progress);
      if (marker) {
        const point = path.getPointAtLength(length * progress);
        marker.setAttribute("cx", point.x);
        marker.setAttribute("cy", point.y);
        marker.style.opacity = "1";
      }
    }
    for (const stroke of strokes) {
      stroke.style.strokeDasharray = length + " " + length;
      stroke.style.strokeDashoffset = length;
    }
    cancellers.add(cancel);
    controls = animateValue(0, 1, {
      duration: duration / 1000,
      ease: [0.4, 0, 0.2, 1],
      onUpdate: update,
      onComplete: cancel,
    });
    return cancel;
  }
  function count(element, from, to, { duration = 1200, format = value => String(Math.round(value)) } = {}) {
    if (!element) return;
    counters.get(element)?.cancel();
    const finalText = format(to);
    element.textContent = finalText;
    if (reduced() || document.hidden || from === to) return;

    // Assistive technology reads only the final value, never the intermediate frames.
    const accessible = document.createElement("span");
    accessible.className = "sr-only";
    accessible.textContent = finalText;
    const visual = document.createElement("span");
    visual.setAttribute("aria-hidden", "true");
    visual.textContent = format(from);
    element.replaceChildren(accessible, visual);
    let controls;
    let settled = false;
    const handle = { cancel };
    function cancel() {
      if (settled) return;
      settled = true;
      controls?.stop();
      if (counters.get(element) === handle) {
        element.textContent = finalText;
        counters.delete(element);
      }
      cancellers.delete(cancel);
    }
    counters.set(element, handle);
    cancellers.add(cancel);
    controls = animateValue(from, to, {
      duration: duration / 1000,
      ease: [0.22, 1, 0.36, 1],
      onUpdate(value) {
        if (!element.isConnected || document.hidden || reduced()) return cancel();
        visual.textContent = format(value);
      },
      onComplete: cancel,
    });
    return handle;
  }
  return {
    reduced, animate, draw, once, scroll, refresh, trace, count,
    entered: element => entered.has(element),
    onChange: listener => { listeners.add(listener); listener(reduced()); },
  };
}
