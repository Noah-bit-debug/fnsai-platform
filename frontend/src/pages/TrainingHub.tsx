import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

interface TrainingCard {
  icon: string;
  title: string;
  meta: string;
  pills: string[];
  progress: number;
}

const INITIAL_CARDS: TrainingCard[] = [
  { icon: '🏥', title: 'Placement Process', meta: 'From requisition to start date', pills: ['Placements', 'Beginner'], progress: 100 },
  { icon: '🏅', title: 'Credentialing 101', meta: 'Credentials, expiry, compliance', pills: ['Compliance'], progress: 60 },
  { icon: '📋', title: 'Harris Health Guide', meta: 'Specific Harris Health requirements', pills: ['Harris Health'], progress: 0 },
  { icon: '✍️', title: 'eSign Guide', meta: 'Sending and tracking e-signatures', pills: ['eSign', 'Contracts'], progress: 0 },
  { icon: '📧', title: 'Client Communication', meta: 'Email templates and best practices', pills: ['Clients', 'Email'], progress: 40 },
  { icon: '👋', title: 'New Employee Guide', meta: 'Start here — everything a new hire needs', pills: ['New hire', 'Essential'], progress: 0 },
];

const RECENT_COMPLETIONS = [
  { user: 'Sarah M.', module: 'Placement Process', completedAt: 'Apr 9 at 2:14 PM', score: '94%' },
  { user: 'Marcus G.', module: 'Credentialing 101', completedAt: 'Apr 8 at 11:30 AM', score: '87%' },
  { user: 'Jamie S.', module: 'New Employee Guide', completedAt: 'Apr 7 at 9:05 AM', score: '100%' },
];

const CATEGORIES = ['General', 'Compliance', 'Facilities', 'Contracts', 'Communications', 'New Hire'];

export default function TrainingHub() {
  const navigate = useNavigate();
  const [cards, setCards] = useState<TrainingCard[]>(INITIAL_CARDS);
  const [search, setSearch] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newLink, setNewLink] = useState('');
  const [newCategory, setNewCategory] = useState(CATEGORIES[0]);

  const filtered = cards.filter(c => c.title.toLowerCase().includes(search.toLowerCase()));

  const handleAdd = () => {
    if (!newTitle.trim()) return;
    setCards(prev => [
      ...prev,
      { icon: '📚', title: newTitle, meta: newDesc || 'New module', pills: [newCategory], progress: 0 },
    ]);
    setNewTitle('');
    setNewDesc('');
    setNewLink('');
    setShowAddForm(false);
  };

  return (
    <div>
      {/* Page Header */}
      <div className="ph">
        <div>
          <div className="pt">🎓 Training Hub</div>
          <div className="ps">Click any topic — AI teaches using Frontline's actual documents and videos</div>
        </div>
      </div>

      {/* Search */}
      <div style={{ marginBottom: 20 }}>
        <input
          className="fi"
          type="text"
          placeholder="🔍  Search modules…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ maxWidth: 340 }}
        />
      </div>

      {/* Training Cards Grid */}
      <div className="cg3" style={{ marginBottom: 28 }}>
        {filtered.map((card, i) => (
          <div
            key={i}
            className="training-card"
            onClick={() => navigate('/ai')}
            role="button"
            tabIndex={0}
            onKeyDown={e => e.key === 'Enter' && navigate('/ai')}
          >
            <div className="tc-title">
              <span>{card.icon}</span>
              {card.title}
            </div>
            <div className="tc-meta">{card.meta}</div>
            <div>
              {card.pills.map((pill, j) => (
                <span className="pill" key={j}>{pill}</span>
              ))}
            </div>
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--t3)', marginBottom: 4 }}>
                <span>Progress</span>
                <span>{card.progress}%</span>
              </div>
              <div className="pb">
                <div
                  className="pf"
                  style={{
                    width: `${card.progress}%`,
                    background: card.progress === 100 ? 'var(--ac)' : 'var(--pr)',
                  }}
                />
              </div>
            </div>
            <button
              className="btn btn-pr btn-sm"
              style={{ alignSelf: 'flex-start' }}
              onClick={e => { e.stopPropagation(); navigate('/ai'); }}
            >
              {card.progress === 100 ? '✓ Review' : card.progress > 0 ? '▶ Continue' : 'Start'}
            </button>
          </div>
        ))}
      </div>

      {/* Add Training Module Panel */}
      <div className="pn" style={{ marginBottom: 24 }}>
        <div className="pnh">
          <h3>+ Add Training Module</h3>
          <button className="btn btn-gh btn-sm" onClick={() => setShowAddForm(v => !v)}>
            {showAddForm ? '✕ Cancel' : '+ Add'}
          </button>
        </div>
        {showAddForm && (
          <div className="pnb">
            <div className="cg2" style={{ marginBottom: 12 }}>
              <div className="fg">
                <label className="fl">Title</label>
                <input
                  className="fi"
                  type="text"
                  placeholder="Module title"
                  value={newTitle}
                  onChange={e => setNewTitle(e.target.value)}
                />
              </div>
              <div className="fg">
                <label className="fl">Description</label>
                <input
                  className="fi"
                  type="text"
                  placeholder="Short description"
                  value={newDesc}
                  onChange={e => setNewDesc(e.target.value)}
                />
              </div>
              <div className="fg">
                <label className="fl">Link (YouTube / SharePoint URL)</label>
                <input
                  className="fi"
                  type="text"
                  placeholder="https://..."
                  value={newLink}
                  onChange={e => setNewLink(e.target.value)}
                />
              </div>
              <div className="fg">
                <label className="fl">Category</label>
                <select className="fi" value={newCategory} onChange={e => setNewCategory(e.target.value)}>
                  {CATEGORIES.map(c => <option key={c}>{c}</option>)}
                </select>
              </div>
            </div>
            <button className="btn btn-pr" onClick={handleAdd}>Add module</button>
          </div>
        )}
      </div>

      {/* Recently Completed */}
      <div className="pn">
        <div className="pnh">
          <h3>Recently Completed</h3>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>User</th>
                <th>Module</th>
                <th>Completed At</th>
                <th>Score</th>
              </tr>
            </thead>
            <tbody>
              {RECENT_COMPLETIONS.map((row, i) => (
                <tr key={i}>
                  <td>{row.user}</td>
                  <td>{row.module}</td>
                  <td className="t3">{row.completedAt}</td>
                  <td><span className="tag tg">{row.score}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
