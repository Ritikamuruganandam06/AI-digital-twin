import type { ServiceRecord } from '../api/types';

/**
 * A small, pure, hand-rolled layered layout for the dependency graph --
 * no charting/graph-drawing library, the same "hand-roll a small
 * mechanism rather than add a dependency for it" choice this project has
 * made throughout (the agent loop, cache-aside, the reliability
 * primitives). The algorithm is a standard layered/Sugiyama-style layout
 * simplified for a small graph: each service's layer (column) is one more
 * than the deepest of its dependencies, so an edge always points from a
 * later layer back to an earlier one -- which is what makes the resulting
 * picture read left-to-right as "what depends on what," not just a
 * scattered node-link diagram.
 *
 * Kept entirely separate from the rendering component (TopologyPage.tsx)
 * specifically so the layout math is unit-testable without a DOM/SVG at
 * all (tests/pages/topologyLayout.unit.test.ts).
 */

export interface LayoutNode {
  name: string;
  displayName: string;
  service: ServiceRecord;
  layer: number;
  indexInLayer: number;
  x: number;
  y: number;
}

export interface LayoutEdge {
  from: string;
  to: string;
}

export interface TopologyLayout {
  nodes: LayoutNode[];
  edges: LayoutEdge[];
  width: number;
  height: number;
}

// Sized for the richer node card the topology view renders (name, status,
// P50, error rate) -- purely presentational constants, doesn't change the
// layering algorithm itself.
const COLUMN_WIDTH = 264;
const ROW_HEIGHT = 132;
const MARGIN = 48;

/**
 * Longest-path layering: a node with no known dependencies is layer 0;
 * otherwise it's one more than the deepest dependency actually present in
 * this service list. A dependency name pointing at a service outside the
 * given list (or a cycle, which a real dependency graph shouldn't have,
 * but nothing here assumes it can't) is tolerated the same way
 * backend/src/services/topology.service.ts's `computeDependents()`
 * tolerates a dangling name -- it just doesn't contribute a layer bump,
 * rather than throwing.
 */
function computeLayers(services: ServiceRecord[]): Map<string, number> {
  const byName = new Map(services.map((s) => [s.name, s]));
  const layers = new Map<string, number>();

  function layerOf(name: string, visiting: Set<string>): number {
    if (layers.has(name)) return layers.get(name)!;
    if (visiting.has(name)) return 0; // cycle guard -- treat as a root rather than recursing forever

    const service = byName.get(name);
    if (!service || service.dependencies.length === 0) {
      layers.set(name, 0);
      return 0;
    }

    visiting.add(name);
    const knownDeps = service.dependencies.filter((d) => byName.has(d));
    const layer = knownDeps.length === 0 ? 0 : 1 + Math.max(...knownDeps.map((d) => layerOf(d, visiting)));
    visiting.delete(name);

    layers.set(name, layer);
    return layer;
  }

  for (const service of services) {
    layerOf(service.name, new Set());
  }

  return layers;
}

export function computeTopologyLayout(services: ServiceRecord[]): TopologyLayout {
  const layers = computeLayers(services);

  const byLayer = new Map<number, ServiceRecord[]>();
  for (const service of services) {
    const layer = layers.get(service.name) ?? 0;
    const bucket = byLayer.get(layer) ?? [];
    bucket.push(service);
    byLayer.set(layer, bucket);
  }

  const nodes: LayoutNode[] = [];
  for (const [layer, bucket] of byLayer.entries()) {
    bucket.sort((a, b) => a.name.localeCompare(b.name));
    bucket.forEach((service, indexInLayer) => {
      nodes.push({
        name: service.name,
        displayName: service.displayName,
        service,
        layer,
        indexInLayer,
        x: MARGIN + layer * COLUMN_WIDTH,
        y: MARGIN + indexInLayer * ROW_HEIGHT,
      });
    });
  }

  const byName = new Set(services.map((s) => s.name));
  const edges: LayoutEdge[] = [];
  for (const service of services) {
    for (const dep of service.dependencies) {
      if (byName.has(dep)) {
        edges.push({ from: service.name, to: dep });
      }
    }
  }

  const maxLayer = Math.max(0, ...nodes.map((n) => n.layer));
  const maxIndexInLayer = Math.max(0, ...nodes.map((n) => n.indexInLayer));

  return {
    nodes,
    edges,
    width: MARGIN * 2 + (maxLayer + 1) * COLUMN_WIDTH,
    height: MARGIN * 2 + (maxIndexInLayer + 1) * ROW_HEIGHT,
  };
}
