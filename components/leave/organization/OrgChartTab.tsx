'use client';

import { useState } from 'react';
import { OrgTreeNode, deptColor } from './orgTypes';
import { Avatar, RoleChip } from './OrgUiPrimitives';

export function OrgTreeRow({
  node,
  depth,
  forceOpen,
}: {
  node: OrgTreeNode;
  depth: number;
  forceOpen?: boolean;
}) {
  const [open, setOpen] = useState(() => (forceOpen !== undefined ? forceOpen : depth < 2));
  const hasChildren = node.children.length > 0;

  return (
    <div className="relative">
      <div
        className="flex items-center gap-2.5 py-2 pr-3 rounded-lg cursor-pointer transition-colors hover:bg-[var(--bg-surface)]"
        style={{ paddingLeft: 12 + depth * 22 }}
        onClick={() => hasChildren && setOpen((o) => !o)}
      >
        {depth > 0 && (
          <span
            className="absolute border-l"
            style={{
              borderColor: 'var(--border)',
              left: 12 + (depth - 1) * 22 + 10,
              top: 0,
              bottom: hasChildren && open ? 0 : '50%',
            }}
          />
        )}
        <span className="w-3.5 text-[10px] shrink-0" style={{ color: 'var(--text-muted)' }}>
          {hasChildren ? (open ? '▾' : '▸') : ''}
        </span>
        <Avatar name={node.fullName} role={node.role} />
        <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
          {node.fullName}
        </span>
        <span className="text-xs tabular-nums" style={{ color: 'var(--text-muted)' }}>
          #{node.employeeCode}
        </span>
        <RoleChip role={node.role} />
        {node.department && (
          <span className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--text-muted)' }}>
            <span className="w-1.5 h-1.5 rounded-sm" style={{ background: deptColor(node.department) }} />
            {node.department}
          </span>
        )}
        {hasChildren && (
          <span className="ml-auto text-xs shrink-0" style={{ color: 'var(--text-muted)' }}>
            {node.children.length} direct report{node.children.length === 1 ? '' : 's'}
          </span>
        )}
      </div>
      {open && hasChildren && (
        <div>
          {node.children.map((c) => (
            <OrgTreeRow key={c.id} node={c} depth={depth + 1} forceOpen={forceOpen} />
          ))}
        </div>
      )}
    </div>
  );
}

export function UnplacedRow({ node }: { node: OrgTreeNode }) {
  return (
    <div className="flex items-center gap-2.5 py-1.5 px-3 rounded-lg hover:bg-[var(--bg-surface)]">
      <Avatar name={node.fullName} role={node.role} />
      <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
        {node.fullName}
      </span>
      <span className="text-xs tabular-nums" style={{ color: 'var(--text-muted)' }}>
        #{node.employeeCode}
      </span>
      <RoleChip role={node.role} />
      {node.department && (
        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
          {node.department}
        </span>
      )}
      <span className="ml-auto text-xs" style={{ color: 'var(--accent)' }}>
        no manager set
      </span>
    </div>
  );
}

export interface OrgChartTabProps {
  hierarchyRoots: OrgTreeNode[];
  unplacedRoots: OrgTreeNode[];
  orgTree: OrgTreeNode[];
  searchQuery: string;
  treeVersion: number;
  treeForceOpen?: boolean;
  unplacedOpen: boolean;
  onToggleUnplaced: () => void;
  onExpandAll: () => void;
  onCollapseAll: () => void;
}

export default function OrgChartTab({
  hierarchyRoots,
  unplacedRoots,
  orgTree,
  searchQuery,
  treeVersion,
  treeForceOpen,
  unplacedOpen,
  onToggleUnplaced,
  onExpandAll,
  onCollapseAll,
}: OrgChartTabProps) {
  return (
    <div className="space-y-4">
      <section className="rounded-xl border" style={{ borderColor: 'var(--border)', background: 'var(--bg-elevated)' }}>
        <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: 'var(--border)' }}>
          <div>
            <h2 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
              Reporting hierarchy
            </h2>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
              Read-only — use the tables below, or an employee's Adjust panel, to change who reports to whom.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={onExpandAll}
              className="text-xs rounded-lg px-2.5 py-1.5 border transition-colors"
              style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}
            >
              Expand all
            </button>
            <button
              type="button"
              onClick={onCollapseAll}
              className="text-xs rounded-lg px-2.5 py-1.5 border transition-colors"
              style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}
            >
              Collapse all
            </button>
          </div>
        </div>
        <div className="scroll-thin max-h-[26rem] overflow-y-auto p-2" key={treeVersion}>
          {hierarchyRoots.map((n) => (
            <OrgTreeRow key={n.id} node={n} depth={0} forceOpen={treeForceOpen} />
          ))}
          {hierarchyRoots.length === 0 && (
            <p className="text-sm py-8 text-center" style={{ color: 'var(--text-muted)' }}>
              {orgTree.length === 0
                ? 'No employees yet.'
                : searchQuery
                ? 'No match for that search.'
                : 'Nobody has direct reports yet — assign a manager below to start building the chart.'}
            </p>
          )}
        </div>
      </section>

      {/* ── Unplaced people — separated out instead of mixed flat into the tree ── */}
      {unplacedRoots.length > 0 && (
        <section
          id="unplaced-section"
          className="rounded-xl border"
          style={{ borderColor: 'rgba(251,146,60,0.3)', background: 'var(--bg-elevated)' }}
        >
          <div
            className="flex items-center justify-between px-4 py-3 cursor-pointer"
            onClick={onToggleUnplaced}
          >
            <div className="flex items-center gap-2">
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                {unplacedOpen ? '▾' : '▸'}
              </span>
              <h2 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                Not yet placed in the chain
              </h2>
              <span
                className="text-[10px] font-bold rounded-full px-1.5 py-0.5"
                style={{ background: 'rgba(251,146,60,0.16)', color: 'var(--accent)' }}
              >
                {unplacedRoots.length}
              </span>
            </div>
          </div>
          {unplacedOpen && (
            <div className="scroll-thin max-h-96 overflow-y-auto px-2 pb-2 border-t" style={{ borderColor: 'var(--border)' }}>
              {unplacedRoots.map((n) => (
                <UnplacedRow key={n.id} node={n} />
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
