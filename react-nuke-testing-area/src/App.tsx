import { useCallback, useEffect, useState } from 'react';
import './App.css';

type TeamKey = 'teamA' | 'teamB';
type TeamNameEditorProps = { name: string; onChange: (name: string) => void; onStartEditing: () => void; isEditing: boolean; onStopEditing: () => void };
type EventTone = 'goal' | 'save' | 'foul' | 'yellow' | 'red';
type MatchEvent = { id: number; team: TeamKey; label: string; minute: string; period: string; tone: EventTone; memberId?: number; memberName: string };
type DurationMode = 40 | 60 | 90 | 'extra';
type Member = { id: number; name: string; number: string; team: TeamKey };
type PendingEvent = { id: number; team: TeamKey; tone: EventTone; label: string };
type MatchSnapshot = { id: number; savedAt: string; teamA: string; teamB: string; stats: { teamA: typeof initialStats; teamB: typeof initialStats }; seconds: number; durationMode: DurationMode; events: MatchEvent[]; members: Member[] };

const initialStats = { goals: 0, saves: 0, fouls: 0, yellow: 0, red: 0 };
const savedMatchesKey = 'football-scoreboard-saved-matches';
const durationOptions: DurationMode[] = [40, 60, 90, 'extra'];
const initialMembers: Member[] = [
  { id: 1, name: 'Maya Chen', number: '08', team: 'teamA' },
  { id: 2, name: 'Noah Williams', number: '11', team: 'teamA' },
  { id: 3, name: 'Amara Okafor', number: '10', team: 'teamB' },
  { id: 4, name: 'Leo Martins', number: '07', team: 'teamB' },
];

type EventMemberDialogProps = { pending: PendingEvent; teamName: string; members: Member[]; onConfirm: (member?: Member) => void; onCancel: () => void };
function EventMemberDialog({ pending, teamName, members, onConfirm, onCancel }: EventMemberDialogProps) {
  const [selectedId, setSelectedId] = useState<number | null>(members[0]?.id ?? null);
  return <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel(); }}><section className="event-dialog" role="dialog" aria-modal="true" aria-labelledby="event-dialog-title"><p className="eyebrow">{teamName} / {pending.label.toUpperCase()}</p><h2 id="event-dialog-title">Who was involved?</h2><p className="dialog-copy">The event was already timestamped. Choose the member to attach to it.</p>{members.length === 0 ? <p className="dialog-copy">Add a member to this team first, or continue without one.</p> : <div className="member-picker">{members.map((member) => <label className={`member-option ${selectedId === member.id ? 'selected' : ''}`} key={member.id}><input type="radio" name="event-member" checked={selectedId === member.id} onChange={() => setSelectedId(member.id)} /><span className="member-number">{member.number}</span><span>{member.name}</span></label>)}</div>}<div className="dialog-actions"><button className="dialog-cancel" onClick={onCancel}>Leave unassigned</button><button className="dialog-confirm" onClick={() => onConfirm(members.find((member) => member.id === selectedId))}>Assign member</button></div></section></div>;
}

function TeamNameEditor({ name, onChange, onStartEditing, isEditing, onStopEditing }: TeamNameEditorProps) {
  const [draftName, setDraftName] = useState(name);
  if (!isEditing) return <button type="button" className="team-name-button" onClick={onStartEditing}>{name}</button>;
  return <input autoFocus aria-label="Team name" className="team-name-input" value={draftName} onChange={(event) => setDraftName(event.target.value)} onBlur={() => { onChange(draftName.trim() || name); onStopEditing(); }} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); if (event.key === 'Escape') { setDraftName(name); onStopEditing(); } }} />;
}

function App() {
  const [teamA, setTeamA] = useState('Team A');
  const [teamB, setTeamB] = useState('Team B');
  const [editingTeam, setEditingTeam] = useState<TeamKey | null>(null);
  const [stats, setStats] = useState({ teamA: { ...initialStats }, teamB: { ...initialStats } });
  const [seconds, setSeconds] = useState(0);
  const [isRunning, setIsRunning] = useState(false);
  const [events, setEvents] = useState<MatchEvent[]>([]);
  const [durationMode, setDurationMode] = useState<DurationMode>(90);
  const [members, setMembers] = useState(initialMembers);
  const [pendingEvent, setPendingEvent] = useState<PendingEvent | null>(null);
  const [showMemberForm, setShowMemberForm] = useState<TeamKey | null>(null);
  const [newMemberName, setNewMemberName] = useState('');
  const [newMemberNumber, setNewMemberNumber] = useState('');
  const [savedMatches, setSavedMatches] = useState<MatchSnapshot[]>(() => {
    const stored = localStorage.getItem(savedMatchesKey);
    return stored ? JSON.parse(stored) as MatchSnapshot[] : [];
  });
  const [showSavedMatches, setShowSavedMatches] = useState(false);
  const [compactMode, setCompactMode] = useState(false);
  const durationSeconds = durationMode === 'extra' ? 120 * 60 : durationMode * 60;
  const period = seconds < 45 * 60 ? '1ST HALF' : seconds < 90 * 60 ? '2ND HALF' : 'EXTRA TIME';

  const formatTime = (totalSeconds: number) => `${Math.floor(totalSeconds / 60).toString().padStart(2, '0')}:${(totalSeconds % 60).toString().padStart(2, '0')}`;
  const teamName = (team: TeamKey) => team === 'teamA' ? teamA : teamB;

  useEffect(() => {
    if (!isRunning) return undefined;
    const interval = window.setInterval(() => setSeconds((current) => {
      if (current >= durationSeconds) {
        setIsRunning(false);
        return current;
      }
      return current + 1;
    }), 1000);
    return () => window.clearInterval(interval);
  }, [durationSeconds, isRunning]);

  const changeStat = useCallback((team: TeamKey, stat: keyof typeof initialStats, amount: number) => setStats((current) => ({ ...current, [team]: { ...current[team], [stat]: Math.max(0, current[team][stat] + amount) } })), []);
  const addEvent = useCallback((team: TeamKey, tone: EventTone, label: string, member?: Member) => {
    if (seconds >= durationSeconds) return undefined;
    const stat = tone === 'yellow' || tone === 'red' ? tone : tone === 'goal' ? 'goals' : tone === 'save' ? 'saves' : 'fouls';
    const eventId = Date.now();
    changeStat(team, stat, 1);
    setEvents((current) => [{ id: eventId, team, label, minute: formatTime(seconds), period, tone, memberId: member?.id, memberName: member?.name ?? 'Unassigned' }, ...current]);
    return eventId;
  }, [changeStat, durationSeconds, period, seconds]);

  const requestEvent = (team: TeamKey, tone: EventTone, label: string) => {
    const eventId = addEvent(team, tone, label);
    if (eventId) setPendingEvent({ id: eventId, team, tone, label });
  };
  const assignPendingEvent = (member?: Member) => {
    if (pendingEvent && member) {
      setEvents((current) => current.map((event) => event.id === pendingEvent.id ? { ...event, memberId: member.id, memberName: member.name } : event));
    }
    setPendingEvent(null);
  };
  const cancelPendingEvent = () => setPendingEvent(null);
  const addMember = (team: TeamKey) => {
    const name = newMemberName.trim();
    if (!name) return;
    setMembers((current) => [...current, { id: Date.now(), name, number: newMemberNumber.trim() || '--', team }]);
    setNewMemberName(''); setNewMemberNumber(''); setShowMemberForm(null);
  };

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement) return;
      const team = event.shiftKey ? 'teamB' : 'teamA';
      if (event.code === 'Space') { event.preventDefault(); setIsRunning((running) => !running); }
      if (event.key.toLowerCase() === 'g') addEvent(team, 'goal', 'Goal');
      if (event.key.toLowerCase() === 'f') addEvent(team, 'foul', 'Foul');
      if (event.key.toLowerCase() === 'y') addEvent(team, 'yellow', 'Yellow card');
      if (event.key.toLowerCase() === 'r') addEvent(team, 'red', 'Red card');
    };
    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  }, [addEvent]);

  const resetMatch = () => { setStats({ teamA: { ...initialStats }, teamB: { ...initialStats } }); setSeconds(0); setIsRunning(false); setEvents([]); };
  const saveMatch = () => {
    const snapshot: MatchSnapshot = { id: Date.now(), savedAt: new Date().toLocaleString(), teamA, teamB, stats, seconds, durationMode, events, members };
    const nextMatches = [snapshot, ...savedMatches].slice(0, 20);
    setSavedMatches(nextMatches);
    localStorage.setItem(savedMatchesKey, JSON.stringify(nextMatches));
  };
  const loadMatch = (snapshot: MatchSnapshot) => {
    setTeamA(snapshot.teamA); setTeamB(snapshot.teamB); setStats(snapshot.stats); setSeconds(snapshot.seconds); setDurationMode(snapshot.durationMode); setEvents(snapshot.events); setMembers(snapshot.members); setIsRunning(false); setShowSavedMatches(false);
  };
  const deleteSavedMatch = (id: number) => {
    const nextMatches = savedMatches.filter((match) => match.id !== id);
    setSavedMatches(nextMatches);
    localStorage.setItem(savedMatchesKey, JSON.stringify(nextMatches));
  };
  const updateMember = (id: number, name: string) => setMembers((current) => current.map((member) => member.id === id ? { ...member, name } : member));
  const renderTeamCard = (team: TeamKey, color: 'coral' | 'mint') => {
    const name = teamName(team); const teamStats = stats[team]; const setName = team === 'teamA' ? setTeamA : setTeamB;
    return <section className={`team-card ${color}`} aria-label={`${name} match controls`}><div className="team-card-header"><TeamNameEditor name={name} onChange={setName} onStartEditing={() => setEditingTeam(team)} isEditing={editingTeam === team} onStopEditing={() => setEditingTeam(null)} /><span className="team-tag">{team === 'teamA' ? 'HOME' : 'AWAY'}</span></div><div className="score-row"><strong>{teamStats.goals}</strong><div className="score-actions"><button className="icon-button primary" onClick={() => requestEvent(team, 'goal', 'Goal')} aria-label={`Add goal for ${name}`}>+</button><button className="icon-button" onClick={() => changeStat(team, 'goals', -1)} aria-label={`Remove goal for ${name}`}>−</button></div></div><div className="stat-grid"><StatControl label="Saves" value={teamStats.saves} onAdd={() => requestEvent(team, 'save', 'Save')} onRemove={() => changeStat(team, 'saves', -1)} /><StatControl label="Fouls" value={teamStats.fouls} onAdd={() => requestEvent(team, 'foul', 'Foul')} onRemove={() => changeStat(team, 'fouls', -1)} /><StatControl label="Yellow" value={teamStats.yellow} accent="yellow" onAdd={() => requestEvent(team, 'yellow', 'Yellow card')} onRemove={() => changeStat(team, 'yellow', -1)} /><StatControl label="Red" value={teamStats.red} accent="red" onAdd={() => requestEvent(team, 'red', 'Red card')} onRemove={() => changeStat(team, 'red', -1)} /></div></section>;
  };

  return <main className={`app-shell ${compactMode ? 'compact-mode' : ''}`}>{pendingEvent && <EventMemberDialog pending={pendingEvent} teamName={teamName(pendingEvent.team)} members={members.filter((member) => member.team === pendingEvent.team)} onConfirm={assignPendingEvent} onCancel={cancelPendingEvent} />}<header className="topbar"><div><p className="eyebrow">MATCH CENTRE / LIVE</p><h1>Football scoreboard</h1></div><div className="top-actions"><label className="toggle-control"><input type="checkbox" checked={compactMode} onChange={(event) => setCompactMode(event.target.checked)} /><span className="toggle-track"></span><span>Compact</span></label><button className="saved-button" onClick={() => setShowSavedMatches((visible) => !visible)}>Saved ({savedMatches.length})</button><button className="reset-button" onClick={resetMatch}>Reset match</button></div></header>{showSavedMatches && <section className="saved-panel"><div className="panel-heading"><div><p className="eyebrow">LOCAL STORAGE</p><h2>Saved matches</h2></div><button className="close-saved" onClick={() => setShowSavedMatches(false)} aria-label="Close saved matches">×</button></div>{savedMatches.length === 0 ? <div className="empty-state"><p>No saved matches yet.</p></div> : <div className="saved-list">{savedMatches.map((match) => <div className="saved-row" key={match.id}><div><strong>{match.teamA} {match.stats.teamA.goals} — {match.stats.teamB.goals} {match.teamB}</strong><span>{match.savedAt} · {match.events.length} events</span></div><button onClick={() => loadMatch(match)}>Load</button><button onClick={() => deleteSavedMatch(match.id)} aria-label={`Delete saved match from ${match.savedAt}`}>×</button></div>)}</div>}</section>}<section className="scoreboard-hero"><div className="match-meta"><span>Friendly match</span><span className={isRunning ? 'live-dot' : ''}>{isRunning ? 'LIVE' : 'READY'}</span></div><div className="hero-score"><div className="hero-team"><span className="team-mark coral-mark">A</span><span>{teamA}</span></div><div className="hero-score-number"><strong>{stats.teamA.goals}</strong><span>:</span><strong>{stats.teamB.goals}</strong></div><div className="hero-team away"><span>{teamB}</span><span className="team-mark mint-mark">B</span></div></div><div className="timer-block"><span>{formatTime(seconds)}</span><div><button className="timer-button" onClick={() => setIsRunning((running) => !running)}>{isRunning ? 'Pause' : 'Start clock'}</button><button className="timer-button ghost" onClick={() => setSeconds(0)}>Reset clock</button></div></div><div className="duration-picker" role="group" aria-label="Match duration"><span>FORMAT</span>{durationOptions.map((option) => <button className={durationMode === option ? 'selected' : ''} key={option} onClick={() => { setDurationMode(option); setSeconds(0); setIsRunning(false); }}>{option === 'extra' ? 'ET' : `${option}'`}</button>)}</div></section><div className="dashboard-grid">{renderTeamCard('teamA', 'coral')}{renderTeamCard('teamB', 'mint')}<section className="members-panel"><div className="panel-heading"><div><p className="eyebrow">SQUAD LIST</p><h2>Members</h2></div><span>{members.length} players</span></div><div className="member-columns">{(['teamA', 'teamB'] as TeamKey[]).map((team) => <div className="member-column" key={team}><p className="member-team-name"><span className={`member-dot ${team === 'teamA' ? 'coral-dot' : 'mint-dot'}`}></span>{teamName(team)}<button className="add-member-button" onClick={() => setShowMemberForm(showMemberForm === team ? null : team)}>+ member</button></p>{showMemberForm === team && <div className="member-entry"><input autoFocus placeholder="Member name" value={newMemberName} onChange={(event) => setNewMemberName(event.target.value)} /><input className="number-input" placeholder="#" value={newMemberNumber} onChange={(event) => setNewMemberNumber(event.target.value)} /><button onClick={() => addMember(team)}>Add</button></div>}{members.filter((member) => member.team === team).map((member) => <label className="member-row" key={member.id}><span>{member.number}</span><input aria-label={`Player name ${member.number}`} value={member.name} onChange={(event) => updateMember(member.id, event.target.value)} /></label>)}</div>)}</div></section><section className="events-panel"><div className="panel-heading"><div><p className="eyebrow">MATCH LOG / {period}</p><h2>Timeline</h2></div><div className="timeline-actions"><button className="save-match-button" onClick={saveMatch}>Save snapshot</button><span>{events.length} events</span></div></div>{events.length === 0 ? <div className="empty-state"><span>◷</span><p>Match events will appear here.</p></div> : <div className="event-list">{events.map((event) => <div className="event-row" key={event.id}><span className={`event-icon ${event.tone}`}>{event.tone === 'goal' ? '●' : event.tone === 'save' ? '◇' : event.tone === 'foul' ? '!' : '▮'}</span><div><strong>{event.label}</strong><span>{teamName(event.team)} · {event.memberName} · {event.period}</span></div><time>{event.minute}</time></div>)}</div>}</section></div><footer className="shortcut-bar"><span><kbd>Space</kbd> clock</span><span><kbd>G</kbd> / <kbd>Shift</kbd> + <kbd>G</kbd> goals (quick)</span><span><kbd>F</kbd> fouls</span><span><kbd>Y</kbd> yellow</span><span><kbd>R</kbd> red</span></footer></main>;
}

type StatControlProps = { label: string; value: number; accent?: 'yellow' | 'red'; onAdd: () => void; onRemove: () => void };
function StatControl({ label, value, accent, onAdd, onRemove }: StatControlProps) { return <div className="stat-control"><div><span className={`stat-symbol ${accent ?? ''}`}></span><span>{label}</span></div><strong>{value}</strong><div className="mini-actions"><button onClick={onRemove} aria-label={`Remove ${label}`}>−</button><button onClick={onAdd} aria-label={`Add ${label}`}>+</button></div></div>; }

export default App;
