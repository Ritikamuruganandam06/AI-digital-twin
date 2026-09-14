import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { listServices } from '../api/services';
import { useApiQuery } from '../api/useApiQuery';
import { AsyncBoundary } from '../components/AsyncBoundary';
import { EmptyState } from '../components/ui/States';
import { PageHeader } from '../components/ui/PageHeader';
import { Button } from '../components/ui/Button';
import { computeTopologyLayout } from './topologyLayout';
import type { HealthStatus, ServiceRecord } from '../api/types';

const NODE_WIDTH = 220;
const NODE_HEIGHT = 108;

const HEALTH_FILL: Record<HealthStatus, string> = {
  healthy: 'var(--color-success-bg)',
  degraded: 'var(--color-warning-bg)',
  down: 'var(--color-danger-bg)',
};
const HEALTH_STROKE: Record<HealthStatus, string> = {
  healthy: 'var(--color-success-solid)',
  degraded: 'var(--color-warning-solid)',
  down: 'var(--color-danger-solid)',
};
const HEALTH_TEXT: Record<HealthStatus, string> = {
  healthy: 'var(--color-success-text)',
  degraded: 'var(--color-warning-text)',
  down: 'var(--color-danger-text)',
};

const LEGEND: { status: HealthStatus; label: string }[] = [
  { status: 'healthy', label: 'Healthy' },
  { status: 'degraded', label: 'Degraded' },
  { status: 'down', label: 'Down' },
];

const ZOOM_STEPS = [0.6, 0.75, 1, 1.25, 1.5];

export function TopologyPage() {
  const navigate = useNavigate();
  const servicesState = useApiQuery(() => listServices(), []);
  const [zoomIndex, setZoomIndex] = useState(2);
  const [focusedNode, setFocusedNode] = useState<string | null>(null);

  const zoom = ZOOM_STEPS[zoomIndex];

  return (
    <div className="page">
      <PageHeader
        title="Service Topology"
        subtitle="Arrows point from a service to what it depends on. Select a node to open its service details."
        actions={
          <div className="cluster" style={{ gap: 'var(--space-1)' }}>
            <Button variant="secondary" size="sm" onClick={() => setZoomIndex((i) => Math.max(0, i - 1))} aria-label="Zoom out" disabled={zoomIndex === 0}>
              −
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setZoomIndex(2)}>
              Reset
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setZoomIndex((i) => Math.min(ZOOM_STEPS.length - 1, i + 1))}
              aria-label="Zoom in"
              disabled={zoomIndex === ZOOM_STEPS.length - 1}
            >
              +
            </Button>
          </div>
        }
      />

      <div className="topology-legend cluster">
        {LEGEND.map((item) => (
          <span className="topology-legend__item" key={item.status}>
            <span className="badge__dot" style={{ background: HEALTH_STROKE[item.status] }} />
            {item.label}
          </span>
        ))}
      </div>

      <AsyncBoundary state={servicesState} errorTitle="Unable to load the topology">
        {(services) => {
          if (services.length === 0) {
            return <EmptyState title="No services seeded yet" body="The topology will appear once services exist in the backend." />;
          }

          const layout = computeTopologyLayout(services);
          const nodeByName = new Map(layout.nodes.map((n) => [n.name, n]));
          const byServiceName = new Map(services.map((s) => [s.name, s]));

          function openService(name: string) {
            navigate(`/services/${name}`);
          }

          return (
            <div className="topology-viewport">
              <svg
                role="img"
                aria-label="Service dependency graph"
                width={layout.width * zoom}
                height={layout.height * zoom}
                viewBox={`0 0 ${layout.width} ${layout.height}`}
              >
                <defs>
                  <marker id="topology-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                    <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--color-text-tertiary)" />
                  </marker>
                </defs>

                {layout.edges.map((edge) => {
                  const from = nodeByName.get(edge.from);
                  const to = nodeByName.get(edge.to);
                  if (!from || !to) return null;
                  const x1 = from.x + NODE_WIDTH;
                  const y1 = from.y + NODE_HEIGHT / 2;
                  const x2 = to.x;
                  const y2 = to.y + NODE_HEIGHT / 2;
                  const midX = (x1 + x2) / 2;
                  return (
                    <path
                      key={`${edge.from}->${edge.to}`}
                      d={`M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`}
                      fill="none"
                      stroke="var(--color-text-tertiary)"
                      strokeWidth={1.5}
                      markerEnd="url(#topology-arrow)"
                    />
                  );
                })}

                {layout.nodes.map((node) => {
                  const service: ServiceRecord = byServiceName.get(node.name) ?? node.service;
                  const isFocused = focusedNode === node.name;
                  return (
                    <g
                      key={node.name}
                      transform={`translate(${node.x}, ${node.y})`}
                      onClick={() => openService(node.name)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          openService(node.name);
                        }
                      }}
                      onFocus={() => setFocusedNode(node.name)}
                      onBlur={() => setFocusedNode((cur) => (cur === node.name ? null : cur))}
                      onMouseEnter={() => setFocusedNode(node.name)}
                      onMouseLeave={() => setFocusedNode((cur) => (cur === node.name ? null : cur))}
                      className="topology-node"
                      tabIndex={0}
                      role="button"
                      aria-label={`View ${service.displayName}, ${service.health.status}`}
                    >
                      <rect
                        width={NODE_WIDTH}
                        height={NODE_HEIGHT}
                        rx={10}
                        fill={HEALTH_FILL[service.health.status]}
                        stroke={HEALTH_STROKE[service.health.status]}
                        strokeWidth={isFocused ? 2.5 : 1.5}
                      />
                      <text x={16} y={26} fontSize={14} fontWeight={700} fill="var(--color-text-primary)">
                        {service.displayName}
                      </text>
                      <circle cx={20} cy={42} r={4} fill={HEALTH_STROKE[service.health.status]} />
                      <text x={30} y={46} fontSize={11} fontWeight={700} fill={HEALTH_TEXT[service.health.status]} letterSpacing={0.4}>
                        {service.health.status.toUpperCase()}
                      </text>
                      <line x1={16} y1={58} x2={NODE_WIDTH - 16} y2={58} stroke="var(--color-border)" />
                      <text x={16} y={78} fontSize={12} fill="var(--color-text-secondary)">
                        P50
                      </text>
                      <text x={NODE_WIDTH - 16} y={78} fontSize={12} fontWeight={600} textAnchor="end" fill="var(--color-text-primary)">
                        {service.health.latencyMsP50} ms
                      </text>
                      <text x={16} y={96} fontSize={12} fill="var(--color-text-secondary)">
                        Error
                      </text>
                      <text x={NODE_WIDTH - 16} y={96} fontSize={12} fontWeight={600} textAnchor="end" fill="var(--color-text-primary)">
                        {service.health.errorRatePercent}%
                      </text>
                    </g>
                  );
                })}
              </svg>
            </div>
          );
        }}
      </AsyncBoundary>
    </div>
  );
}
