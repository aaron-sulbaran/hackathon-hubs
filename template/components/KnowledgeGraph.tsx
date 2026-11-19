"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { accentFor, initials } from "@/lib/web/people";
import { GROUPS, HUB_NODE, mapLayout, NARROW, neighborsOf, WIDE, type Edge, type GraphNode, type GroupId, type MapLayout, type NodeKind } from "@/lib/web/graph";

// The knowledge map. Two fixed layouts from lib/web/graph.ts, picked by CSS
// (narrow under 768px, wide above), both rendered on the server. On first
// paint every node flies out from the index to its place, cluster by cluster.
// Hover, focus, or a first tap lights a node and its neighbors, names it in the
// caption, and opens its area in the list under the map; a second tap, Enter,
// or Open opens the page. Links inside an area are always drawn; links between
// areas only for the node in hand, so the map never turns into a hairball.

export const GROUP_FILL: Record<GroupId, string> = {
  rules: "var(--g-rules)",
  tracks: "var(--g-tracks)",
  ideas: "var(--g-ideas)",
  team: "var(--g-team)",
  logistics: "var(--g-logistics)",
};

export const KIND_LABEL: Record<NodeKind, string> = {
  kb: "Page",
  item: "Open item",
  question: "Open question",
  decision: "Call on record",
  gate: "Checkpoint",
  person: "Person",
};

const GROUP_LABEL = Object.fromEntries(GROUPS.map((group) => [group.id, group.label])) as Record<GroupId, string>;
const LEADS = new Set(GROUPS.map((group) => group.lead));

type Sizes = { hub: number; lead: number; page: number; person: number; work: number; hit: number; label: number; title: number };
const SIZES: Record<"wide" | "narrow", Sizes> = {
  wide: { hub: 13, lead: 10, page: 6.5, person: 11, work: 5, hit: 15, label: 12.5, title: 15 },
  narrow: { hub: 12, lead: 9.5, page: 6.5, person: 10.5, work: 5, hit: 14, label: 12, title: 13.5 },
};

/** The shape of a node says its kind: circle page, square item, diamond question, ring for calls and checkpoints. */
function NodeShape({ node, x, y, sizes, grow }: { node: GraphNode; x: number; y: number; sizes: Sizes; grow: number }) {
  const fill = node.group ? GROUP_FILL[node.group] : "var(--primary)";
  if (node.id === HUB_NODE) return <circle cx={x} cy={y} r={sizes.hub + grow} fill="var(--primary)" stroke="var(--card)" strokeWidth={2} />;
  if (node.kind === "person") {
    const accent = accentFor(node.id);
    return (
      <>
        <circle cx={x} cy={y} r={sizes.person + grow} fill={accent.fill} stroke="var(--node-edge)" strokeWidth={1.5} />
        <text x={x} y={y + 3.5} textAnchor="middle" fill={accent.ink} className="text-[9.5px] font-semibold" aria-hidden="true">
          {initials(node.label)}
        </text>
      </>
    );
  }
  if (node.kind === "item") {
    const s = sizes.work + grow;
    return <rect x={x - s} y={y - s} width={s * 2} height={s * 2} rx={2} fill={fill} stroke="var(--node-edge)" strokeWidth={1.5} />;
  }
  if (node.kind === "question") {
    const s = sizes.work + 1 + grow;
    return <path d={`M${x} ${y - s}L${x + s} ${y}L${x} ${y + s}L${x - s} ${y}Z`} fill={fill} stroke="var(--node-edge)" strokeWidth={1.5} strokeLinejoin="round" />;
  }
  if (node.kind === "decision" || node.kind === "gate") return <circle cx={x} cy={y} r={sizes.work + grow} fill="var(--card)" stroke="var(--node-edge)" strokeWidth={1.75} />;
  return <circle cx={x} cy={y} r={(LEADS.has(node.id) ? sizes.lead : sizes.page) + grow} fill={fill} stroke="var(--node-edge)" strokeWidth={1.5} />;
}

function labelPosition(side: string, x: number, y: number, gap: number): { x: number; y: number; anchor: "start" | "end" | "middle" } {
  if (side === "right") return { x: x + gap, y: y + 4, anchor: "start" };
  if (side === "left") return { x: x - gap, y: y + 4, anchor: "end" };
  if (side === "above") return { x, y: y - gap, anchor: "middle" };
  return { x, y: y + gap + 9, anchor: "middle" };
}

interface MapProps {
  layout: MapLayout;
  nodes: GraphNode[];
  edges: Edge[];
  active: string | null;
  neighbors: Set<string> | null;
  counts: Record<GroupId, number>;
  onHover: (id: string | null) => void;
  onTap: (id: string) => boolean;
  pointer: React.RefObject<string>;
}

function MapSvg({ layout, nodes, edges, active, neighbors, counts, onHover, onTap, pointer }: MapProps) {
  const { frame } = layout;
  const sizes = SIZES[frame.name];
  const wide = frame.name === "wide";
  const groupOf = new Map(nodes.map((node) => [node.id, node.group]));
  const lit = (id: string) => !active || id === active || Boolean(neighbors?.has(id));
  const order = new Map(GROUPS.map((group, i) => [group.id, i]));

  const handlers = (id: string) => ({
    onPointerDown: (event: React.PointerEvent) => {
      pointer.current = event.pointerType;
    },
    onPointerEnter: (event: React.PointerEvent) => {
      if (event.pointerType !== "touch") onHover(id);
    },
    onPointerLeave: (event: React.PointerEvent) => {
      if (event.pointerType !== "touch") onHover(null);
    },
    onFocus: () => onHover(id),
    onBlur: () => onHover(null),
    onClick: (event: React.MouseEvent) => {
      if (pointer.current === "touch" && onTap(id)) event.preventDefault();
    },
  });

  return (
    <svg viewBox={`0 0 ${frame.width} ${frame.height}`} className="block h-auto w-full touch-manipulation select-none" role="group" aria-label="Knowledge map">
      {layout.clusters.map((cluster) => (
        <circle key={cluster.group} cx={cluster.x} cy={cluster.y} r={cluster.radius + (wide ? 24 : 16)} fill={GROUP_FILL[cluster.group]} style={{ fillOpacity: "var(--halo-opacity)" }} />
      ))}
      {edges.map(([a, b]) => {
        const from = layout.nodes[a];
        const to = layout.nodes[b];
        if (!from || !to) return null;
        const hot = active === a || active === b;
        const spoke = a === HUB_NODE || b === HUB_NODE;
        // The index links to every page: draw one spoke per area lead, and the rest only for the node in hand.
        if (spoke && !LEADS.has(a === HUB_NODE ? b : a) && !hot) return null;
        const across = !spoke && groupOf.get(a) !== groupOf.get(b);
        if (across && !hot) return null;
        return (
          <line
            key={`${a}-${b}`}
            x1={from.x}
            y1={from.y}
            x2={to.x}
            y2={to.y}
            stroke={hot ? "var(--primary)" : "var(--ink-2)"}
            strokeOpacity={hot ? 0.85 : active ? 0.1 : 0.3}
            strokeWidth={hot ? 1.75 : 1}
            className="animate-fade-in transition-[stroke-opacity] duration-200"
          />
        );
      })}
      {layout.clusters.map((cluster) => {
        const group = GROUPS.find((candidate) => candidate.id === cluster.group)!;
        const lead = nodes.find((node) => node.id === group.lead);
        const y = cluster.y - cluster.radius - (wide ? 30 : 22);
        const text = (
          <text
            x={cluster.x}
            y={y}
            textAnchor="middle"
            fill="var(--ink)"
            stroke="var(--card)"
            strokeWidth={4}
            paintOrder="stroke"
            style={{ fontSize: sizes.title }}
            className="font-semibold"
          >
            {group.label}
            <tspan fill="var(--ink-2)" className="font-normal">
              {" "}
              {counts[cluster.group]}
            </tspan>
          </text>
        );
        if (!lead) return <g key={`title-${cluster.group}`}>{text}</g>;
        return (
          <Link key={`title-${cluster.group}`} href={lead.href} aria-label={`${group.label}, ${counts[cluster.group]} on the map: open ${lead.label}`} className="outline-none" {...handlers(lead.id)}>
            <rect x={cluster.x - 90} y={y - 20} width={180} height={30} fill="transparent" />
            {text}
          </Link>
        );
      })}
      {nodes.map((node) => {
        const place = layout.nodes[node.id];
        if (!place) return null;
        const isActive = node.id === active;
        const isLead = LEADS.has(node.id);
        const showLabel =
          node.id === HUB_NODE || isActive || (wide && !isLead && place.ring === 1) || (wide && place.ring === 2 && Boolean(neighbors?.has(node.id)));
        const label = node.id === HUB_NODE ? "Start here" : node.short;
        const position = labelPosition(node.id === HUB_NODE ? "below" : place.side, place.x, place.y, node.kind === "person" ? 15 : isLead ? 14 : 10);
        const hub = frame.hub;
        // The swarm: each node starts at the index and flies out, one area after another.
        const swarm = {
          "--dx": `${hub.x - place.x}px`,
          "--dy": `${hub.y - place.y}px`,
          animationDelay: `${(node.group ? (order.get(node.group) ?? 0) * 70 : 0) + place.ring * 60}ms`,
        } as React.CSSProperties;
        return (
          <Link
            key={node.id}
            href={node.href}
            aria-label={`${KIND_LABEL[node.kind]}: ${node.label}${node.group ? `, in ${GROUP_LABEL[node.group]}` : ""}`}
            className="outline-none [&:focus-visible_.focus-ring]:opacity-100"
            {...handlers(node.id)}
          >
            <g className="swarm-in" style={swarm}>
              <g style={{ opacity: lit(node.id) ? 1 : 0.25 }} className="transition-opacity duration-200">
                <circle cx={place.x} cy={place.y} r={sizes.hit} fill="transparent" />
                <circle className="focus-ring opacity-0" cx={place.x} cy={place.y} r={sizes.hit - 2} fill="none" stroke="var(--primary)" strokeWidth={2} />
                <NodeShape node={node} x={place.x} y={place.y} sizes={sizes} grow={isActive ? 2.5 : 0} />
                {showLabel && (
                  <text
                    x={position.x}
                    y={position.y}
                    textAnchor={position.anchor}
                    stroke="var(--card)"
                    strokeWidth={4}
                    paintOrder="stroke"
                    fill="var(--ink)"
                    style={{ fontSize: sizes.label }}
                    className={isActive || node.id === HUB_NODE ? "font-semibold" : ""}
                  >
                    {label}
                  </text>
                )}
              </g>
            </g>
          </Link>
        );
      })}
    </svg>
  );
}

function KindGlyph({ node }: { node: GraphNode }) {
  const fill = node.group ? GROUP_FILL[node.group] : "var(--primary)";
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" className="shrink-0">
      {node.kind === "item" ? (
        <rect x="2.5" y="2.5" width="9" height="9" rx="2" fill={fill} stroke="var(--node-edge)" strokeWidth="1.25" />
      ) : node.kind === "question" ? (
        <path d="M7 1.5 12.5 7 7 12.5 1.5 7Z" fill={fill} stroke="var(--node-edge)" strokeWidth="1.25" strokeLinejoin="round" />
      ) : node.kind === "decision" || node.kind === "gate" ? (
        <circle cx="7" cy="7" r="5" fill="var(--card)" stroke="var(--node-edge)" strokeWidth="1.5" />
      ) : (
        <circle cx="7" cy="7" r="5.25" fill={node.kind === "person" ? accentFor(node.id).fill : fill} stroke="var(--node-edge)" strokeWidth="1.25" />
      )}
    </svg>
  );
}

export function KnowledgeGraph({ nodes, edges, listOpen = false }: { nodes: GraphNode[]; edges: Edge[]; listOpen?: boolean }) {
  const wide = useMemo(() => mapLayout(nodes, WIDE), [nodes]);
  const narrow = useMemo(() => mapLayout(nodes, NARROW), [nodes]);
  const [hovered, setHovered] = useState<string | null>(null);
  const [tapped, setTapped] = useState<string | null>(null);
  const pointer = useRef("mouse");
  const active = hovered ?? tapped;
  const neighbors = useMemo(() => (active ? neighborsOf(active, edges) : null), [active, edges]);
  const activeNode = nodes.find((node) => node.id === active) ?? null;
  const counts = useMemo(
    () => Object.fromEntries(GROUPS.map((group) => [group.id, nodes.filter((node) => node.group === group.id).length])) as Record<GroupId, number>,
    [nodes],
  );

  // A first tap names the node; a second tap on the same node opens it.
  const onTap = (id: string) => {
    if (tapped === id) return false;
    setTapped(id);
    return true;
  };
  const shared = { nodes, edges, active, neighbors, counts, onHover: setHovered, onTap, pointer };

  return (
    <section aria-labelledby="map-heading" className="rounded-card bg-card shadow-card">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 px-4 pt-3.5 sm:px-5">
        <h2 id="map-heading" className="text-[17px] font-semibold text-ink">
          What we know
        </h2>
        <p className="text-[13px] text-ink-2">Five areas, {nodes.filter((node) => node.kind === "kb").length} pages</p>
      </div>
      <div className="flex flex-col">
        <div className="flex min-h-[48px] items-center gap-2.5 border-b border-divider px-4 py-2 sm:px-5 md:order-last md:border-t md:border-b-0" aria-live="polite">
          {activeNode ? (
            <>
              <KindGlyph node={activeNode} />
              <p className="min-w-0 flex-1 text-[14px] leading-snug font-semibold text-ink">{activeNode.label}</p>
              <Link href={activeNode.href} className="flex min-h-11 shrink-0 items-center rounded-full bg-primary px-4 text-[14px] font-semibold text-on-primary">
                Open
              </Link>
            </>
          ) : (
            <p className="text-[13px] text-ink-2">
              <span className="md:hidden">Tap a dot or an area name to see it here.</span>
              <span className="max-md:hidden">Point at a dot to see its links. Circles are pages, squares open items, diamonds open questions.</span>
            </p>
          )}
        </div>
        <div
          className="px-2 sm:px-3"
          onClick={(event) => {
            if (event.target === event.currentTarget) setTapped(null);
          }}
        >
          <div className="mx-auto max-w-[400px] md:hidden">
            <MapSvg layout={narrow} {...shared} />
          </div>
          <div className="hidden md:block">
            <MapSvg layout={wide} {...shared} />
          </div>
        </div>
      </div>
      <MapList nodes={nodes} counts={counts} openGroup={activeNode?.group ?? null} allOpen={listOpen} />
    </section>
  );
}

const KIND_RANK: Record<NodeKind, number> = { kb: 0, person: 1, item: 2, question: 3, decision: 4, gate: 5 };

/** The same nodes as folding lists, one per area with its count; the area in hand opens on its own. */
function MapList({ nodes, counts, openGroup, allOpen }: { nodes: GraphNode[]; counts: Record<GroupId, number>; openGroup: GroupId | null; allOpen: boolean }) {
  return (
    <div className="border-t border-divider">
      {GROUPS.map((group) => {
        const members = nodes
          .filter((node) => node.group === group.id)
          .sort((a, b) => Number(LEADS.has(b.id)) - Number(LEADS.has(a.id)) || KIND_RANK[a.kind] - KIND_RANK[b.kind] || a.label.localeCompare(b.label));
        if (members.length === 0) return null;
        return (
          <details key={`${group.id}-${openGroup === group.id}`} className="group/list border-b border-divider last:border-b-0" open={allOpen || openGroup === group.id || undefined}>
            <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2.5 px-4 py-2 text-[15px] font-semibold text-ink hover:bg-hover sm:px-5 [&::-webkit-details-marker]:hidden">
              <span className="h-3.5 w-3.5 shrink-0 rounded-full border-[1.5px] border-[var(--node-edge)]" style={{ background: GROUP_FILL[group.id] }} aria-hidden="true" />
              <span className="flex-1">{group.label}</span>
              <span className="text-[13px] font-normal text-ink-2 tabular-nums">{counts[group.id]}</span>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="text-ink-2 transition-transform group-open/list:rotate-180">
                <path d="m6 9.5 6 6 6-6" />
              </svg>
            </summary>
            <ul className="grid grid-cols-1 px-2.5 pb-2 sm:grid-cols-2 sm:px-3.5 xl:grid-cols-3">
              {members.map((node) => (
                <li key={node.id}>
                  <Link href={node.href} className="flex min-h-11 items-center gap-2 rounded-control px-1.5 py-1.5 text-[14px] leading-snug text-ink hover:bg-hover">
                    <KindGlyph node={node} />
                    <span className="min-w-0 flex-1">{node.label}</span>
                    {node.kind !== "kb" && <span className="shrink-0 text-[12px] text-ink-2">{KIND_LABEL[node.kind].toLowerCase()}</span>}
                  </Link>
                </li>
              ))}
            </ul>
          </details>
        );
      })}
    </div>
  );
}
