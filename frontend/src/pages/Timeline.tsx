import React, { useState } from 'react';

interface ChecklistItem {
  id: string;
  label: string;
  done: boolean;
}

interface Phase {
  id: string;
  title: string;
  subtitle: string;
  statusTag: string;
  statusClass: string;
  items: ChecklistItem[];
}

const initialPhases: Phase[] = [
  {
    id: 'phase1',
    title: 'Phase 1',
    subtitle: 'Days 1–14 — Immediate Foundations',
    statusTag: 'In progress',
    statusClass: 'td',
    items: [
      { id: 'p1_1', label: 'Send RealTime renewal email (post-acquisition notice)', done: false },
      { id: 'p1_2', label: 'Get all 3 insurance quotes (Workers\' Comp, E&O, EPLI)', done: false },
      { id: 'p1_3', label: 'Verify BankEasy account + Line of Credit status', done: false },
      { id: 'p1_4', label: 'Set up incident reporting system', done: true },
    ],
  },
  {
    id: 'phase2',
    title: 'Phase 2',
    subtitle: 'Days 15–30 — Operational Setup',
    statusTag: 'Upcoming',
    statusClass: 'tw',
    items: [
      { id: 'p2_1', label: 'Bind all required insurance policies', done: false },
      { id: 'p2_2', label: 'Update facility service agreements with new entity', done: false },
      { id: 'p2_3', label: 'Activate LOC and confirm payroll funding process', done: false },
      { id: 'p2_4', label: 'Update staff employment contracts with correct employer name', done: false },
    ],
  },
  {
    id: 'phase3',
    title: 'Phase 3',
    subtitle: 'Days 31–60 — Full Independence',
    statusTag: 'Future',
    statusClass: 'tgr',
    items: [
      { id: 'p3_1', label: 'Complete full contract review with legal counsel', done: false },
      { id: 'p3_2', label: 'Establish timekeeping and payroll records system', done: false },
      { id: 'p3_3', label: 'Organize compliance document logs (I-9, certs, background checks)', done: false },
      { id: 'p3_4', label: 'Review per diem and travel reimbursement policies', done: false },
      { id: 'p3_5', label: 'Conduct first internal compliance audit', done: false },
    ],
  },
];

export default function Timeline() {
  const [phases, setPhases] = useState<Phase[]>(initialPhases);

  const toggleItem = (phaseId: string, itemId: string) => {
    setPhases(prev =>
      prev.map(phase => {
        if (phase.id !== phaseId) return phase;
        return {
          ...phase,
          items: phase.items.map(item =>
            item.id === itemId ? { ...item, done: !item.done } : item
          ),
        };
      })
    );
  };

  const getDoneCount = (phase: Phase) => phase.items.filter(i => i.done).length;

  return (
    <div>
      <div className="ph">
        <div>
          <div className="pt">📅 30–60 Day Transition</div>
          <div className="ps">Structured checklist to achieve full operational independence</div>
        </div>
      </div>

      <div className="ab ab-i" style={{ marginBottom: '1.5rem' }}>
        Complete each phase in order. Phase 1 items are time-critical and should be resolved within the first two weeks of operating independently.
      </div>

      {/* Progress summary */}
      <div className="cg3" style={{ marginBottom: '1.5rem' }}>
        {phases.map(phase => {
          const done = getDoneCount(phase);
          const total = phase.items.length;
          const pct = Math.round((done / total) * 100);
          return (
            <div className="sc" key={phase.id}>
              <div className="sl">{phase.title}</div>
              <div className="sv">{done}/{total}</div>
              <div className="progress-row" style={{ marginTop: '0.5rem' }}>
                <div className="pr-bar">
                  <div className="pr-fill" style={{ width: `${pct}%` }} />
                </div>
                <span className="pr-pct">{pct}%</span>
              </div>
            </div>
          );
        })}
      </div>

      <div className="cg2">
        {/* Left column: Phase 1 + Phase 3 */}
        <div>
          {[phases[0], phases[2]].map(phase => {
            const done = getDoneCount(phase);
            const total = phase.items.length;
            return (
              <div className="pn" key={phase.id} style={{ marginBottom: '1rem' }}>
                <div className="pnh">
                  <div>
                    <strong>{phase.title}</strong>
                    <span style={{ marginLeft: '0.5rem', fontSize: '0.85rem', color: 'var(--muted)' }}>{phase.subtitle}</span>
                  </div>
                  <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                    <span className={`tag ${phase.statusClass}`}>{phase.statusTag}</span>
                    <span className="tag tgr">{done}/{total} done</span>
                  </div>
                </div>
                <div className="pnb">
                  {phase.items.map(item => (
                    <div
                      key={item.id}
                      className={`cl-item${item.done ? ' done' : ''}`}
                      onClick={() => toggleItem(phase.id, item.id)}
                      style={{ cursor: 'pointer' }}
                    >
                      <div className="cl-cb">{item.done ? '✓' : ''}</div>
                      <span>{item.label}</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        {/* Right column: Phase 2 + info panel */}
        <div>
          {[phases[1]].map(phase => {
            const done = getDoneCount(phase);
            const total = phase.items.length;
            return (
              <div className="pn" key={phase.id} style={{ marginBottom: '1rem' }}>
                <div className="pnh">
                  <div>
                    <strong>{phase.title}</strong>
                    <span style={{ marginLeft: '0.5rem', fontSize: '0.85rem', color: 'var(--muted)' }}>{phase.subtitle}</span>
                  </div>
                  <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                    <span className={`tag ${phase.statusClass}`}>{phase.statusTag}</span>
                    <span className="tag tgr">{done}/{total} done</span>
                  </div>
                </div>
                <div className="pnb">
                  {phase.items.map(item => (
                    <div
                      key={item.id}
                      className={`cl-item${item.done ? ' done' : ''}`}
                      onClick={() => toggleItem(phase.id, item.id)}
                      style={{ cursor: 'pointer' }}
                    >
                      <div className="cl-cb">{item.done ? '✓' : ''}</div>
                      <span>{item.label}</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}

          <div className="pn">
            <div className="pnh">
              <span>Key Milestones</span>
            </div>
            <div className="pnb">
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                <div className="progress-row">
                  <span className="pr-label">Day 7 — Insurance quotes received</span>
                  <div className="pr-bar">
                    <div className="pr-fill" style={{ width: '0%' }} />
                  </div>
                  <span className="pr-pct">0%</span>
                </div>
                <div className="progress-row">
                  <span className="pr-label">Day 10 — Banking activated</span>
                  <div className="pr-bar">
                    <div className="pr-fill" style={{ width: '0%' }} />
                  </div>
                  <span className="pr-pct">0%</span>
                </div>
                <div className="progress-row">
                  <span className="pr-label">Day 14 — RealTime notice sent</span>
                  <div className="pr-bar">
                    <div className="pr-fill" style={{ width: '0%' }} />
                  </div>
                  <span className="pr-pct">0%</span>
                </div>
                <div className="progress-row">
                  <span className="pr-label">Day 21 — Contracts updated</span>
                  <div className="pr-bar">
                    <div className="pr-fill" style={{ width: '0%' }} />
                  </div>
                  <span className="pr-pct">0%</span>
                </div>
                <div className="progress-row">
                  <span className="pr-label">Day 60 — Full independence</span>
                  <div className="pr-bar">
                    <div className="pr-fill" style={{ width: '0%' }} />
                  </div>
                  <span className="pr-pct">0%</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
