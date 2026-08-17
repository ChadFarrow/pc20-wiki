/**
 * The link graph.
 *
 * podroll-atlas reaches for d3 because it draws a thousand nodes. This graph
 * has a couple of dozen, so a hand-rolled spring layout is smaller than the
 * script tag that would fetch d3 — and it keeps the wiki free of external
 * requests, which is the whole point of a static reference that should still
 * work in five years.
 */

(() => {
  const canvas = document.getElementById('graph-canvas');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  const styles = getComputedStyle(document.documentElement);
  const colour = (name, fallback) => styles.getPropertyValue(name).trim() || fallback;

  const INK = colour('--ink', '#17150f');
  const SOFT = colour('--ink-soft', '#55503f');
  const RULE = colour('--rule', '#e0d9c8');
  const ACCENT = colour('--accent', '#8a3b12');
  const PAPER = colour('--paper', '#faf7f0');

  const focus = new URLSearchParams(location.search).get('focus');

  let nodes = [];
  let edges = [];
  let view = { x: 0, y: 0, scale: 1 };
  let hovered = null;
  let dragging = null;
  let panning = null;
  let alpha = 1;
  let spread = 1;
  let touched = false;   // set once the reader pans, zooms or drags

  /**
   * Size by total degree, not inbound alone.
   *
   * A map of content is the most useful node on the graph and the least
   * linked-to — it points outward at everything and almost nothing points back.
   * Ranking by inbound would draw the best entry points as the smallest dots.
   */
  const radius = (node) => 5 + Math.min(node.degree ?? node.inbound, 10) * 1.5;

  fetch('/data/graph.json')
    .then((response) => response.json())
    .then((data) => {
      // A ring start beats random placement: the layout settles the same way
      // every time, so the graph a reader shares looks like the one they saw.
      // Spacing scales with the square root of the node count, so the graph
      // stays as readable at 200 notes as it was at 23 instead of collapsing
      // into a ball of overlapping labels.
      spread = Math.sqrt(Math.max(data.nodes.length, 12) / 24);

      nodes = data.nodes.map((node, i) => {
        const angle = (i / data.nodes.length) * Math.PI * 2;
        const r = 220 * spread;
        return { ...node, x: Math.cos(angle) * r, y: Math.sin(angle) * r, vx: 0, vy: 0 };
      });
      const bySlug = new Map(nodes.map((node) => [node.slug, node]));
      edges = data.edges
        .map((edge) => ({ source: bySlug.get(edge.from), target: bySlug.get(edge.to) }))
        .filter((edge) => edge.source && edge.target);

      for (const node of nodes) node.degree = 0;
      for (const edge of edges) {
        edge.source.degree++;
        edge.target.degree++;
      }

      canvas.classList.add('ready');
      resize();
      requestAnimationFrame(tick);
    })
    .catch(() => {
      /* The fallback paragraph in the markup stays visible. */
    });

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    view.x = rect.width / 2;
    view.y = rect.height / 2;
    fitToContent();
    draw();
  }

  function step() {
    const REPULSION = 7000 * spread * spread;
    const SPRING = 0.012;
    const LENGTH = 110 * spread;
    const CENTRE = 0.004 / spread;

    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i];
      for (let j = i + 1; j < nodes.length; j++) {
        const b = nodes[j];
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let distSq = dx * dx + dy * dy;
        if (distSq < 1) {
          dx = (i - j) * 0.5;
          dy = 0.5;
          distSq = 1;
        }
        const force = REPULSION / distSq;
        const dist = Math.sqrt(distSq);
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        a.vx -= fx;
        a.vy -= fy;
        b.vx += fx;
        b.vy += fy;
      }
    }

    for (const edge of edges) {
      const dx = edge.target.x - edge.source.x;
      const dy = edge.target.y - edge.source.y;
      const dist = Math.hypot(dx, dy) || 1;
      const force = (dist - LENGTH) * SPRING;
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;
      edge.source.vx += fx;
      edge.source.vy += fy;
      edge.target.vx -= fx;
      edge.target.vy -= fy;
    }

    for (const node of nodes) {
      node.vx -= node.x * CENTRE;
      node.vy -= node.y * CENTRE;
      if (node === dragging) {
        node.vx = 0;
        node.vy = 0;
        continue;
      }
      node.vx *= 0.82;
      node.vy *= 0.82;
      node.x += node.vx * alpha;
      node.y += node.vy * alpha;
    }
  }

  function draw() {
    const rect = canvas.getBoundingClientRect();
    ctx.clearRect(0, 0, rect.width, rect.height);
    ctx.save();
    ctx.translate(view.x, view.y);
    ctx.scale(view.scale, view.scale);

    const lit = hovered ?? nodes.find((node) => node.slug === focus) ?? null;
    const connected = new Set();
    if (lit) {
      connected.add(lit.slug);
      for (const edge of edges) {
        if (edge.source === lit) connected.add(edge.target.slug);
        if (edge.target === lit) connected.add(edge.source.slug);
      }
    }

    ctx.lineWidth = 1;
    for (const edge of edges) {
      const active = lit && (edge.source === lit || edge.target === lit);
      ctx.strokeStyle = active ? ACCENT : RULE;
      ctx.globalAlpha = lit && !active ? 0.25 : 0.7;
      ctx.beginPath();
      ctx.moveTo(edge.source.x, edge.source.y);
      ctx.lineTo(edge.target.x, edge.target.y);
      ctx.stroke();
    }

    ctx.globalAlpha = 1;
    for (const node of nodes) {
      const dim = lit && !connected.has(node.slug);
      const r = radius(node);

      ctx.globalAlpha = dim ? 0.3 : 1;
      ctx.beginPath();
      ctx.arc(node.x, node.y, r, 0, Math.PI * 2);

      if (node.stub) {
        // Hollow: linked, but nobody has written it yet.
        ctx.fillStyle = PAPER;
        ctx.fill();
        ctx.strokeStyle = node === lit ? ACCENT : SOFT;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([2, 2]);
        ctx.stroke();
        ctx.setLineDash([]);
      } else {
        ctx.fillStyle = node === lit ? ACCENT : node.type === 'moc' ? ACCENT : INK;
        ctx.fill();
      }

      if (!dim && (node === lit || view.scale > 0.5 || node.degree > 3)) {
        ctx.fillStyle = node === lit ? ACCENT : SOFT;
        // Drawn inside the scaled context, so the size is divided back out and
        // labels stay legible at any zoom instead of ballooning with it.
        const size = Math.min(13, 12 / view.scale);
        ctx.font = `${node === lit ? 600 : 400} ${size}px 'IBM Plex Mono', monospace`;
        ctx.textAlign = 'center';
        ctx.fillText(node.title, node.x, node.y - r - 5);
      }
    }

    ctx.restore();
    ctx.globalAlpha = 1;
  }

  /**
   * Frames the whole graph once the layout has settled.
   *
   * Without this the reader lands on the middle of a graph that is bigger than
   * the canvas and has to discover panning before they can see there is more.
   * Skipped the moment they touch it — refitting under someone's hands would be
   * the software arguing with them.
   */
  function fitToContent() {
    if (touched || !nodes.length) return;
    const rect = canvas.getBoundingClientRect();
    const xs = nodes.map((n) => n.x);
    const ys = nodes.map((n) => n.y);
    const pad = 60;
    const width = Math.max(...xs) - Math.min(...xs) + pad * 2;
    const height = Math.max(...ys) - Math.min(...ys) + pad * 2;

    // Floored, not just capped: shrinking far enough to fit everything can take
    // the labels below the size at which they are drawn at all, and a graph of
    // anonymous dots is not worth framing perfectly.
    view.scale = Math.max(0.62, Math.min(1.1, Math.min(rect.width / width, rect.height / height)));
    view.x = rect.width / 2 - ((Math.min(...xs) + Math.max(...xs)) / 2) * view.scale;
    view.y = rect.height / 2 - ((Math.min(...ys) + Math.max(...ys)) / 2) * view.scale;
  }

  function tick() {
    if (alpha > 0.02) {
      step();
      alpha *= 0.985;
      fitToContent();
    }
    draw();
    requestAnimationFrame(tick);
  }

  function toWorld(event) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left - view.x) / view.scale,
      y: (event.clientY - rect.top - view.y) / view.scale,
    };
  }

  function nodeAt(point) {
    let found = null;
    for (const node of nodes) {
      const r = radius(node) + 6;
      if (Math.hypot(node.x - point.x, node.y - point.y) <= r) found = node;
    }
    return found;
  }

  canvas.addEventListener('pointermove', (event) => {
    const point = toWorld(event);

    if (dragging) {
      dragging.x = point.x;
      dragging.y = point.y;
      alpha = Math.max(alpha, 0.35);
      return;
    }
    if (panning) {
      view.x += event.clientX - panning.x;
      view.y += event.clientY - panning.y;
      panning = { x: event.clientX, y: event.clientY };
      return;
    }

    const hit = nodeAt(point);
    if (hit !== hovered) {
      hovered = hit;
      canvas.style.cursor = hit ? 'pointer' : 'grab';
    }
  });

  canvas.addEventListener('pointerdown', (event) => {
    touched = true;
    canvas.setPointerCapture(event.pointerId);
    const hit = nodeAt(toWorld(event));
    if (hit) {
      dragging = hit;
      dragging.moved = false;
    } else {
      panning = { x: event.clientX, y: event.clientY };
    }
  });

  canvas.addEventListener('pointerup', (event) => {
    // A click that never moved is navigation; a drag that moved is layout.
    if (dragging && !dragging.moved) {
      const hit = nodeAt(toWorld(event));
      if (hit === dragging) location.href = `/notes/${hit.slug}/`;
    }
    dragging = null;
    panning = null;
  });

  canvas.addEventListener('pointermove', () => {
    if (dragging) dragging.moved = true;
  });

  canvas.addEventListener(
    'wheel',
    (event) => {
      event.preventDefault();
      touched = true;
      const rect = canvas.getBoundingClientRect();
      const mx = event.clientX - rect.left;
      const my = event.clientY - rect.top;
      const factor = Math.exp(-event.deltaY * 0.0015);
      const next = Math.min(3, Math.max(0.3, view.scale * factor));

      // Zoom toward the pointer rather than the origin.
      view.x = mx - ((mx - view.x) * next) / view.scale;
      view.y = my - ((my - view.y) * next) / view.scale;
      view.scale = next;
    },
    { passive: false },
  );

  window.addEventListener('resize', resize);
})();
