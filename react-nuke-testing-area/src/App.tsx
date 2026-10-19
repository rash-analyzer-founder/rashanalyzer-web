import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Clock3, CornerDownRight, Ellipsis, Flag, Minus, Plus, RotateCcw, Save, Send, ShieldAlert, Sparkles, Swords, Target, Trash2, Volume2, VolumeX, Whistle } from 'lucide-react';
import './App.css';

type TeamKey = 'teamA' | 'teamB';
type EventTone = 'goal' | 'save' | 'foul' | 'yellow' | 'red' | 'corner' | 'goalKick' | 'penalty' | 'freeKick';
type DurationMode = 40 | 60 | 90 | 'custom' | 'extra';
type MatchPhase = 'first-half' | 'half-time' | 'second-half' | 'extra-first-half' | 'extra-half-time' | 'extra-second-half' | 'shootout' | 'finished';
type PenaltyOutcome = 'scored' | 'saved' | 'missed';
type FreeKickType = 'direct' | 'indirect';
type FreeKickOutcome = 'goal' | 'saved' | 'missed' | 'blocked';
type ChatMessage = { role: 'user' | 'assistant'; text: string };
type Member = { id: number; name: string; number: string; team: TeamKey };
type MatchEvent = {
  id: number;
  team: TeamKey;
  label: string;
  minute: string;
  period: string;
  tone: EventTone;
  memberId?: number;
  memberName: string;
  memberTeam?: TeamKey;
  isOwnGoal?: boolean;
  isDisallowedGoal?: boolean;
  correctionReason?: string;
  penaltyOutcome?: PenaltyOutcome;
  freeKickType?: FreeKickType;
  freeKickOutcome?: FreeKickOutcome;
  isOutcome?: boolean;
  relatedEventId?: number;
};
type PendingEvent = { id: number; team: TeamKey; tone: EventTone; label: string; freeKickType?: FreeKickType; penaltyOutcome?: PenaltyOutcome; freeKickOutcome?: FreeKickOutcome; isOutcome?: boolean; hasRecordedOutcome?: boolean; resultMinute?: string };
type MatchSnapshot = {
  id: number;
  savedAt: string;
  teamA: string;
  teamB: string;
  stats: { teamA: typeof initialStats; teamB: typeof initialStats };
  seconds: number;
  durationMode: DurationMode;
  events: MatchEvent[];
  members: Member[];
  extraTime?: boolean;
  extraTimeStartSeconds?: number | null;
  matchLimitSeconds?: number;
  customRegulationMinutes?: number;
  phase?: MatchPhase;
  squadSizes?: Record<TeamKey, number>;
  shootoutAttempts?: { team: TeamKey; scored: boolean; memberName: string; id: number }[];
  shootoutWinner?: TeamKey | null;
};
type TeamNameEditorProps = {
  name: string;
  onChange: (name: string) => void;
  onStartEditing: () => void;
  isEditing: boolean;
  onStopEditing: () => void;
};
type EventMemberDialogProps = {
  pending: PendingEvent;
  teamName: string;
  opposingName: string;
  members: Member[];
  opposingMembers: Member[];
  onAssign: (member: Member | undefined, ownGoal: boolean, penaltyOutcome?: PenaltyOutcome, freeKickType?: FreeKickType, freeKickOutcome?: FreeKickOutcome, recordOutcome?: boolean) => void;
  onCancel: () => void;
};

const initialStats = { goals: 0, saves: 0, fouls: 0, yellow: 0, red: 0, corners: 0, goalKicks: 0, penalties: 0, freeKicks: 0, freeKickGoals: 0 };
const savedMatchesKey = 'football-scoreboard-saved-matches';
const durationOptions: DurationMode[] = [40, 60, 90, 'custom'];
const rosterPresets = [1, 2, 11];
const initialMembers: Member[] = [];

function otherTeam(team: TeamKey): TeamKey {
  return team === 'teamA' ? 'teamB' : 'teamA';
}

type MatchStats = typeof initialStats;

function eventStatDeltas(event: MatchEvent): { team: TeamKey; stat: keyof MatchStats; amount: number }[] {
  const deltas: { team: TeamKey; stat: keyof MatchStats; amount: number }[] = [];
  const add = (team: TeamKey, stat: keyof MatchStats) => deltas.push({ team, stat, amount: 1 });
  if (event.tone === 'goal' && !event.isDisallowedGoal) add(event.team, 'goals');
  if (event.tone === 'save') add(event.team, 'saves');
  if (event.tone === 'foul') add(event.team, 'fouls');
  if (event.tone === 'yellow' || event.tone === 'red') add(event.team, event.tone);
  if (event.tone === 'corner') add(event.team, 'corners');
  if (event.tone === 'goalKick') add(event.team, 'goalKicks');
  if (event.tone === 'freeKick') {
    if (event.isOutcome || event.freeKickOutcome !== undefined) {
      if (event.freeKickOutcome === 'goal' && !event.isDisallowedGoal) {
        add(event.team, 'freeKickGoals');
        add(event.team, 'goals');
      }
      if (event.freeKickOutcome === 'saved') add(otherTeam(event.team), 'saves');
    } else {
      add(event.team, 'freeKicks');
    }
  }
  if (event.tone === 'penalty') {
    if (event.isOutcome || event.penaltyOutcome !== undefined) {
      if (event.penaltyOutcome === 'scored' && !event.isDisallowedGoal) add(event.team, 'goals');
      if (event.penaltyOutcome === 'saved') add(otherTeam(event.team), 'saves');
    } else {
      add(event.team, 'penalties');
    }
  }
  return deltas;
}

function applyEventStats(stats: Record<TeamKey, MatchStats>, event: MatchEvent, direction: 1 | -1): Record<TeamKey, MatchStats> {
  const next = { teamA: { ...stats.teamA }, teamB: { ...stats.teamB } };
  for (const { team, stat, amount } of eventStatDeltas(event)) {
    next[team][stat] = Math.max(0, next[team][stat] + amount * direction);
  }
  return next;
}

function TeamNameEditor({ name, onChange, onStartEditing, isEditing, onStopEditing }: TeamNameEditorProps) {
  const [draftName, setDraftName] = useState(name);
  if (!isEditing) {
    return <button type="button" className="team-name-button" onClick={onStartEditing}>{name}</button>;
  }
  return (
    <input
      autoFocus
      aria-label="Team name"
      className="team-name-input"
      value={draftName}
      onChange={(event) => setDraftName(event.target.value)}
      onBlur={() => { onChange(draftName.trim() || name); onStopEditing(); }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur();
        if (event.key === 'Escape') { setDraftName(name); onStopEditing(); }
      }}
    />
  );
}

function EventMemberDialog({ pending, teamName, opposingName, members, opposingMembers, onAssign, onCancel }: EventMemberDialogProps) {
  const [ownGoal, setOwnGoal] = useState(false);
  const [penaltyOutcome, setPenaltyOutcome] = useState<PenaltyOutcome>(pending.penaltyOutcome ?? 'scored');
  const [freeKickType, setFreeKickType] = useState<FreeKickType>(pending.freeKickType ?? 'direct');
  const [freeKickOutcome, setFreeKickOutcome] = useState<FreeKickOutcome>(pending.freeKickOutcome ?? 'missed');
  const [selectedId, setSelectedId] = useState<number | null>(members[0]?.id ?? null);
  const isGoalEvent = pending.tone === 'goal';
  const isDefendingPlayer = (isGoalEvent && ownGoal) || (pending.tone === 'penalty' && penaltyOutcome === 'saved') || (pending.tone === 'freeKick' && freeKickOutcome === 'saved');
  const activeMembers = isDefendingPlayer ? opposingMembers : members;
  const activeTeamName = isDefendingPlayer ? opposingName : teamName;

  const selectOwnGoal = (value: boolean) => {
    setOwnGoal(value);
    setSelectedId((value ? opposingMembers : members)[0]?.id ?? null);
  };

  const title = pending.tone === 'goal' ? 'Who scored?' : pending.tone === 'save' ? 'Who made the save?' : pending.tone === 'goalKick' ? 'Who took the goal kick?' : pending.tone === 'yellow' || pending.tone === 'red' ? 'Who received the card?' : pending.tone === 'penalty' ? penaltyOutcome === 'saved' ? 'Who saved the penalty?' : 'Who took the penalty?' : pending.tone === 'freeKick' ? freeKickOutcome === 'goal' ? 'Who scored from the free kick?' : freeKickOutcome === 'saved' ? 'Who saved the free kick?' : 'Who took the free kick?' : 'Who was involved?';
  const copy = pending.isOutcome
    ? 'This result has its own timestamp. Edit attribution without changing when it happened.'
    : pending.tone === 'penalty' || pending.tone === 'freeKick'
      ? 'The award is already timestamped. Save attribution now or record the later result as a separate event.'
    : 'This event is already timestamped. Assign a player or own-goal status without changing its time.';

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel(); }}>
      <section className="event-dialog" role="dialog" aria-modal="true" aria-labelledby="event-dialog-title">
        <p className="eyebrow">{pending.label.toUpperCase()} FOR {teamName.toUpperCase()}</p>
        <h2 id="event-dialog-title">{title}</h2>
        <p className="dialog-copy">{copy}</p>
        {isGoalEvent && (
          <div className="goal-type-switch" role="group" aria-label="Goal type">
            <button className={!ownGoal ? 'active' : ''} onClick={() => selectOwnGoal(false)}>Goal</button>
            <button className={ownGoal ? 'active' : ''} onClick={() => selectOwnGoal(true)}>Own goal</button>
          </div>
        )}
        {pending.tone === 'penalty' && (!pending.hasRecordedOutcome || pending.isOutcome) && (
          <label className="event-field">Penalty outcome
            <select value={penaltyOutcome} onChange={(event) => { setPenaltyOutcome(event.target.value as PenaltyOutcome); setSelectedId(null); }}>
              <option value="scored">Scored</option>
              <option value="saved">Saved</option>
              <option value="missed">Missed</option>
            </select>
          </label>
        )}
        {pending.tone === 'freeKick' && (!pending.hasRecordedOutcome || pending.isOutcome) && <>
          <label className="event-field">Free-kick type<select value={freeKickType} onChange={(event) => setFreeKickType(event.target.value as FreeKickType)}><option value="direct">Direct free kick</option><option value="indirect">Indirect free kick</option></select></label>
          <label className="event-field">Free-kick result<select value={freeKickOutcome} onChange={(event) => { setFreeKickOutcome(event.target.value as FreeKickOutcome); setSelectedId(null); }}><option value="goal">Goal scored</option><option value="saved">Saved by goalkeeper</option><option value="missed">Missed</option><option value="blocked">Blocked</option></select></label>
        </>}
        {pending.hasRecordedOutcome && !pending.isOutcome && <p className="dialog-copy">Result already logged at {pending.resultMinute}. Select that timeline entry to edit its outcome.</p>}
        <p className="picker-team-label">{isGoalEvent ? (ownGoal ? `Own goal by ${activeTeamName}` : `Scorer for ${activeTeamName}`) : pending.tone === 'freeKick' && freeKickOutcome === 'goal' ? `Scorer · ${activeTeamName}` : pending.tone === 'freeKick' && freeKickOutcome === 'saved' ? `Goalkeeper · ${activeTeamName}` : `Player for ${activeTeamName}`}</p>
        {activeMembers.length === 0 ? (
          <p className="dialog-copy">No members on this team yet. You can leave the event unassigned.</p>
        ) : (
          <div className="member-picker">
            {activeMembers.map((member) => (
              <label className={`member-option ${selectedId === member.id ? 'selected' : ''}`} key={member.id}>
                <input type="radio" name="event-member" checked={selectedId === member.id} onChange={() => setSelectedId(member.id)} />
                <span className="member-number">{member.number}</span><span>{member.name}</span>
              </label>
            ))}
          </div>
        )}
        <div className="dialog-actions">
          <button className="dialog-cancel" onClick={onCancel}>Cancel</button>
          {(pending.tone === 'penalty' || pending.tone === 'freeKick') && <button className="dialog-cancel" onClick={() => onAssign(activeMembers.find((member) => member.id === selectedId), false, pending.isOutcome && pending.tone === 'penalty' ? penaltyOutcome : undefined, pending.tone === 'freeKick' ? freeKickType : undefined, pending.isOutcome && pending.tone === 'freeKick' ? freeKickOutcome : undefined)}>Save details</button>}
          {(pending.tone === 'penalty' || pending.tone === 'freeKick') && !pending.isOutcome && !pending.hasRecordedOutcome && <button className="dialog-confirm" onClick={() => onAssign(activeMembers.find((member) => member.id === selectedId), false, pending.tone === 'penalty' ? penaltyOutcome : undefined, pending.tone === 'freeKick' ? freeKickType : undefined, pending.tone === 'freeKick' ? freeKickOutcome : undefined, true)}>{pending.tone === 'penalty' ? `Record ${penaltyOutcome}` : `Record ${freeKickOutcome === 'goal' ? 'goal' : freeKickOutcome}`}</button>}
          {pending.tone !== 'penalty' && pending.tone !== 'freeKick' && <button className="dialog-confirm" onClick={() => onAssign(activeMembers.find((member) => member.id === selectedId), isGoalEvent && ownGoal)}>Save details</button>}
        </div>
      </section>
    </div>
  );
}

type EditEventDialogProps = {
  event: MatchEvent;
  members: Member[];
  teamName: (team: TeamKey) => string;
  onSave: (event: MatchEvent) => void;
  onCancel: () => void;
};

function EditEventDialog({ event, members, teamName, onSave, onCancel }: EditEventDialogProps) {
  const [team, setTeam] = useState(event.team);
  const [tone, setTone] = useState(event.tone);
  const [label, setLabel] = useState(event.label);
  const [memberId, setMemberId] = useState(event.memberId ?? '');
  const [ownGoal, setOwnGoal] = useState(Boolean(event.isOwnGoal));
  const [penaltyOutcome, setPenaltyOutcome] = useState<PenaltyOutcome>(event.penaltyOutcome ?? 'scored');
  const [freeKickType, setFreeKickType] = useState<FreeKickType>(event.freeKickType ?? 'direct');
  const [freeKickOutcome, setFreeKickOutcome] = useState<FreeKickOutcome>(event.freeKickOutcome ?? 'missed');
  const playerTeam = ownGoal || (tone === 'penalty' && penaltyOutcome === 'saved') || (tone === 'freeKick' && freeKickOutcome === 'saved') ? otherTeam(team) : team;
  const players = members.filter((member) => member.team === playerTeam);

  const save = () => {
    const member = members.find((item) => item.id === Number(memberId) && item.team === playerTeam);
    onSave({
      ...event,
      team,
      tone,
      label: tone === 'goal' && ownGoal ? 'Own goal' : tone === 'penalty' ? `Penalty · ${penaltyOutcome}` : tone === 'freeKick' ? `${freeKickType === 'direct' ? 'Direct' : 'Indirect'} free kick · ${freeKickOutcome === 'goal' ? 'Goal scored' : freeKickOutcome}` : label.trim() || tone,
      memberId: member?.id,
      memberName: member?.name ?? 'Unassigned',
      memberTeam: member?.team,
      isOwnGoal: tone === 'goal' && ownGoal,
      isDisallowedGoal: ['goal', 'penalty', 'freeKick'].includes(tone) && Boolean(event.isDisallowedGoal),
      penaltyOutcome: tone === 'penalty' ? penaltyOutcome : undefined,
      freeKickType: tone === 'freeKick' ? freeKickType : undefined,
      freeKickOutcome: tone === 'freeKick' ? freeKickOutcome : undefined,
    });
  };

  return (
    <div className="dialog-backdrop" role="presentation">
      <section className="event-dialog edit-event-dialog" role="dialog" aria-modal="true" aria-labelledby="edit-event-title">
        <p className="eyebrow">EDIT EVENT · {event.minute}</p>
        <h2 id="edit-event-title">Correct timeline entry</h2>
        <p className="dialog-copy">The original match time stays unchanged.</p>
        <label className="event-field">Event type
          <select value={tone} onChange={(change) => { setTone(change.target.value as EventTone); setMemberId(''); }}>
            {(['goal', 'save', 'foul', 'yellow', 'red', 'corner', 'goalKick', 'penalty', 'freeKick'] as EventTone[]).map((option) => <option key={option} value={option}>{option === 'freeKick' ? 'Free kick' : option === 'goalKick' ? 'Goal kick' : option[0].toUpperCase() + option.slice(1)}</option>)}
          </select>
        </label>
        <label className="event-field">Credited team
          <select value={team} onChange={(change) => { setTeam(change.target.value as TeamKey); setMemberId(''); }}>
            {(['teamA', 'teamB'] as TeamKey[]).map((option) => <option key={option} value={option}>{teamName(option)}</option>)}
          </select>
        </label>
        {tone === 'goal' && <label className="event-check"><input type="checkbox" checked={ownGoal} onChange={(change) => { setOwnGoal(change.target.checked); setMemberId(''); }} /> Own goal</label>}
        {tone === 'penalty' && <label className="event-field">Penalty outcome<select value={penaltyOutcome} onChange={(change) => { setPenaltyOutcome(change.target.value as PenaltyOutcome); setMemberId(''); }}><option value="scored">Scored</option><option value="saved">Saved</option><option value="missed">Missed</option></select></label>}
        {tone === 'freeKick' && <>
          <label className="event-field">Free-kick type<select value={freeKickType} onChange={(change) => { setFreeKickType(change.target.value as FreeKickType); setMemberId(''); }}><option value="direct">Direct</option><option value="indirect">Indirect</option></select></label>
          <label className="event-field">Free-kick result<select value={freeKickOutcome} onChange={(change) => { setFreeKickOutcome(change.target.value as FreeKickOutcome); setMemberId(''); }}><option value="goal">Goal scored</option><option value="saved">Saved</option><option value="missed">Missed</option><option value="blocked">Blocked</option></select></label>
        </>}
        <label className="event-field">Player
          <select value={memberId} onChange={(change) => setMemberId(change.target.value)}>
            <option value="">Unassigned</option>
            {players.map((member) => <option key={member.id} value={member.id}>{member.number ? `#${member.number} ` : ''}{member.name}</option>)}
          </select>
        </label>
        {tone !== 'goal' && tone !== 'penalty' && <label className="event-field">Timeline label<input value={label} onChange={(change) => setLabel(change.target.value)} /></label>}
        <div className="dialog-actions"><button className="dialog-cancel" onClick={onCancel}>Cancel</button><button className="dialog-confirm" onClick={save}>Save correction</button></div>
      </section>
    </div>
  );
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
  const [customRegulationMinutes, setCustomRegulationMinutes] = useState(90);
  const [extraTime, setExtraTime] = useState(false);
  const [extraTimeStartSeconds, setExtraTimeStartSeconds] = useState<number | null>(null);
  const [phase, setPhase] = useState<MatchPhase>('first-half');
  const [matchLimitSeconds, setMatchLimitSeconds] = useState(45 * 60);
  const [inStoppage, setInStoppage] = useState(false);
  const [stoppageStartedAt, setStoppageStartedAt] = useState<number | null>(null);
  const [showStoppagePrompt, setShowStoppagePrompt] = useState(false);
  const [stoppageMinutes, setStoppageMinutes] = useState(3);
  const [members, setMembers] = useState(initialMembers);
  const [squadSizes, setSquadSizes] = useState<Record<TeamKey, number>>({ teamA: 2, teamB: 2 });
  const [pendingEvent, setPendingEvent] = useState<PendingEvent | null>(null);
  const [editingEvent, setEditingEvent] = useState<MatchEvent | null>(null);
  const [contextMenu, setContextMenu] = useState<{ eventId: number; x: number; y: number } | null>(null);
  const [goalCorrectionTeam, setGoalCorrectionTeam] = useState<TeamKey | null>(null);
  const [goalCorrectionId, setGoalCorrectionId] = useState<number | null>(null);
  const [goalCorrectionReason, setGoalCorrectionReason] = useState('mistake');
  const [shootoutAttempts, setShootoutAttempts] = useState<{ team: TeamKey; scored: boolean; memberName: string; id: number }[]>([]);
  const [shootoutWinner, setShootoutWinner] = useState<TeamKey | null>(null);
  const [shootoutMemberId, setShootoutMemberId] = useState<number | ''>('');
  const [showMemberForm, setShowMemberForm] = useState<TeamKey | null>(null);
  const [newMemberName, setNewMemberName] = useState('');
  const [newMemberNumber, setNewMemberNumber] = useState('');
  const [savedMatches, setSavedMatches] = useState<MatchSnapshot[]>(() => {
    try {
      const stored = localStorage.getItem(savedMatchesKey);
      return stored ? JSON.parse(stored) as MatchSnapshot[] : [];
    } catch {
      return [];
    }
  });
  const [showSavedMatches, setShowSavedMatches] = useState(false);
  const [compactMode, setCompactMode] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [goalCelebration, setGoalCelebration] = useState<{ id: number; team: TeamKey } | null>(null);
  const [aiSummary, setAiSummary] = useState('');
  const [aiSummaryModel, setAiSummaryModel] = useState('gemini-3.5-flash-lite');
  const [aiSummaryStatus, setAiSummaryStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [aiSummaryError, setAiSummaryError] = useState('');
  const [aiSummaryRequest, setAiSummaryRequest] = useState(0);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatDraft, setChatDraft] = useState('');
  const [chatSending, setChatSending] = useState(false);
  const [chatError, setChatError] = useState('');
  const chatThreadRef = useRef<HTMLDivElement | null>(null);
  const chatControllerRef = useRef<AbortController | null>(null);

  const regulationMinutes = durationMode === 'custom' ? customRegulationMinutes : durationMode === 'extra' ? 120 : durationMode;
  const regulationSeconds = regulationMinutes * 60;
  const firstHalfSeconds = Math.floor(regulationSeconds / 2);
  const phaseLabels: Record<MatchPhase, string> = {
    'first-half': '1ST HALF',
    'half-time': 'HALF-TIME',
    'second-half': '2ND HALF',
    'extra-first-half': 'EXTRA TIME · FIRST HALF',
    'extra-half-time': 'EXTRA-TIME BREAK',
    'extra-second-half': 'EXTRA TIME · SECOND HALF',
    shootout: 'PENALTY SHOOTOUT',
    finished: extraTime ? 'AFTER EXTRA TIME' : 'FULL TIME',
  };
  const period = phaseLabels[phase];
  const formatTime = (totalSeconds: number) => `${Math.floor(totalSeconds / 60).toString().padStart(2, '0')}:${(totalSeconds % 60).toString().padStart(2, '0')}`;
  const stoppageElapsedSeconds = Math.max(0, seconds - (matchLimitSeconds - stoppageMinutes * 60));
  const teamName = (team: TeamKey) => team === 'teamA' ? teamA : teamB;

  const playGoalSound = useCallback(() => {
    if (!soundEnabled || !('AudioContext' in window)) return;
    const audio = new AudioContext();
    void audio.resume().then(() => {
      const start = audio.currentTime;
      [523.25, 659.25, 783.99].forEach((frequency, index) => {
        const oscillator = audio.createOscillator();
        const gain = audio.createGain();
        const noteStart = start + index * 0.12;
        oscillator.type = 'triangle';
        oscillator.frequency.value = frequency;
        gain.gain.setValueAtTime(0.0001, noteStart);
        gain.gain.exponentialRampToValueAtTime(0.09, noteStart + 0.025);
        gain.gain.exponentialRampToValueAtTime(0.0001, noteStart + 0.3);
        oscillator.connect(gain);
        gain.connect(audio.destination);
        oscillator.start(noteStart);
        oscillator.stop(noteStart + 0.32);
        if (index === 2) oscillator.onended = () => { void audio.close(); };
      });
    }).catch(() => { void audio.close(); });
  }, [soundEnabled]);

  const celebrateGoal = useCallback((team: TeamKey) => {
    const id = Date.now() + Math.floor(Math.random() * 1000);
    setGoalCelebration({ id, team });
    window.setTimeout(() => setGoalCelebration((current) => current?.id === id ? null : current), 1450);
    playGoalSound();
  }, [playGoalSound]);

  const completePeriod = useCallback((atSeconds: number) => {
    setShowStoppagePrompt(false);
    setStoppageStartedAt(null);
    setInStoppage(false);
    setSeconds(atSeconds);
    if (phase === 'first-half') {
      setPhase('half-time');
      setIsRunning(false);
    } else if (phase === 'second-half') {
      if (stats.teamA.goals === stats.teamB.goals) {
        setExtraTime(true);
        setExtraTimeStartSeconds(atSeconds);
        setPhase('extra-first-half');
        setMatchLimitSeconds(atSeconds + 15 * 60);
        setIsRunning(true);
      } else {
        setPhase('finished');
        setIsRunning(false);
      }
    } else if (phase === 'extra-first-half') {
      setPhase('extra-half-time');
      setIsRunning(false);
    } else if (phase === 'extra-second-half') {
      if (stats.teamA.goals === stats.teamB.goals) {
        setPhase('shootout');
        setShootoutAttempts([]);
        setShootoutWinner(null);
        setIsRunning(false);
      } else {
        setPhase('finished');
        setIsRunning(false);
      }
    }
  }, [phase, stats.teamA.goals, stats.teamB.goals]);

  const startNextPeriod = useCallback(() => {
    if (phase === 'half-time') {
      setPhase('second-half');
      setMatchLimitSeconds(seconds + (regulationSeconds - firstHalfSeconds));
    } else if (phase === 'extra-half-time') {
      setPhase('extra-second-half');
      setMatchLimitSeconds(seconds + 15 * 60);
    }
    setInStoppage(false);
    setIsRunning(true);
  }, [firstHalfSeconds, phase, regulationSeconds, seconds]);

  useEffect(() => {
    if (!isRunning) return undefined;
    const interval = window.setInterval(() => {
      const nextSecond = seconds + 1;
      if (nextSecond < matchLimitSeconds) {
        setSeconds(nextSecond);
        return;
      }
      setSeconds(matchLimitSeconds);
      setIsRunning(false);
      if (inStoppage) {
        completePeriod(matchLimitSeconds);
      } else {
        setStoppageStartedAt(Date.now());
        setShowStoppagePrompt(true);
      }
    }, 1000);
    return () => window.clearInterval(interval);
  }, [completePeriod, inStoppage, isRunning, matchLimitSeconds, seconds]);

  const changeStat = useCallback((team: TeamKey, stat: keyof MatchStats, amount: number) => {
    setStats((current) => ({ ...current, [team]: { ...current[team], [stat]: Math.max(0, current[team][stat] + amount) } }));
  }, []);

  const addEvent = useCallback((team: TeamKey, tone: EventTone, label: string) => {
    if (!['first-half', 'second-half', 'extra-first-half', 'extra-second-half'].includes(phase)) return undefined;
    const eventId = Date.now() + Math.floor(Math.random() * 1000);
    const newEvent: MatchEvent = { id: eventId, team, label, minute: formatTime(seconds), period, tone, memberName: 'Unassigned' };
    setStats((current) => applyEventStats(current, newEvent, 1));
    setEvents((current) => [newEvent, ...current]);
    if (tone === 'goal') celebrateGoal(team);
    return eventId;
  }, [celebrateGoal, period, phase, seconds]);

  const requestEvent = useCallback((team: TeamKey, tone: EventTone, label: string) => {
    addEvent(team, tone, label);
  }, [addEvent]);

  const assignEventMember = (member: Member | undefined, ownGoal: boolean, penaltyOutcome?: PenaltyOutcome, freeKickType?: FreeKickType, freeKickOutcome?: FreeKickOutcome, recordOutcome = false) => {
    const previous = events.find((event) => event.id === pendingEvent?.id);
    if (!pendingEvent || !previous) return;
    const updated: MatchEvent = {
      ...previous,
      label: pendingEvent.tone === 'goal' && ownGoal ? 'Own goal' : pendingEvent.tone === 'penalty' ? pendingEvent.isOutcome ? `Penalty ${penaltyOutcome}` : 'Penalty awarded' : pendingEvent.tone === 'freeKick' ? pendingEvent.isOutcome ? `${freeKickType === 'direct' ? 'Direct' : 'Indirect'} free kick · ${freeKickOutcome === 'goal' ? 'Goal scored' : freeKickOutcome}` : `${freeKickType === 'direct' ? 'Direct' : 'Indirect'} free kick awarded` : pendingEvent.label,
      memberId: member?.id,
      memberName: member?.name ?? 'Unassigned',
      memberTeam: member?.team,
      isOwnGoal: pendingEvent.tone === 'goal' ? ownGoal : false,
      penaltyOutcome: pendingEvent.isOutcome ? penaltyOutcome : undefined,
      freeKickType,
      freeKickOutcome: pendingEvent.isOutcome ? freeKickOutcome : undefined,
      isOutcome: previous.isOutcome,
    };
    const resultEvent: MatchEvent | undefined = recordOutcome && !pendingEvent.isOutcome && pendingEvent.tone === 'penalty' && penaltyOutcome
      ? { id: Date.now() + Math.floor(Math.random() * 1000), team: previous.team, label: `Penalty ${penaltyOutcome}`, minute: formatTime(seconds), period, tone: 'penalty', memberId: member?.id, memberName: member?.name ?? 'Unassigned', memberTeam: member?.team, penaltyOutcome, isOutcome: true, relatedEventId: previous.id }
      : recordOutcome && !pendingEvent.isOutcome && pendingEvent.tone === 'freeKick' && freeKickOutcome && freeKickType
        ? { id: Date.now() + Math.floor(Math.random() * 1000), team: previous.team, label: `${freeKickType === 'direct' ? 'Direct' : 'Indirect'} free kick · ${freeKickOutcome === 'goal' ? 'Goal scored' : freeKickOutcome}`, minute: formatTime(seconds), period, tone: 'freeKick', memberId: member?.id, memberName: member?.name ?? 'Unassigned', memberTeam: member?.team, freeKickType, freeKickOutcome, isOutcome: true, relatedEventId: previous.id }
        : undefined;
    setStats((current) => {
      const withUpdatedAward = applyEventStats(applyEventStats(current, previous, -1), updated, 1);
      return resultEvent ? applyEventStats(withUpdatedAward, resultEvent, 1) : withUpdatedAward;
    });
    setEvents((current) => [
      ...(resultEvent ? [resultEvent] : []),
      ...current.map((event) => event.id === pendingEvent.id ? updated : event),
    ]);
    if (resultEvent && ((resultEvent.tone === 'penalty' && resultEvent.penaltyOutcome === 'scored') || (resultEvent.tone === 'freeKick' && resultEvent.freeKickOutcome === 'goal'))) celebrateGoal(resultEvent.team);
    setPendingEvent(null);
  };

  const deleteEvent = (event: MatchEvent) => {
    const linkedResults = events.filter((item) => item.relatedEventId === event.id);
    setStats((current) => linkedResults.reduce((next, result) => applyEventStats(next, result, -1), applyEventStats(current, event, -1)));
    setEvents((current) => current.filter((item) => item.id !== event.id && item.relatedEventId !== event.id));
    setContextMenu(null);
    setEditingEvent(null);
  };

  const removeLatestStatEvent = (team: TeamKey, stat: keyof MatchStats) => {
    const event = events.find((item) => eventStatDeltas(item).some((delta) => delta.team === team && delta.stat === stat));
    if (event) deleteEvent(event);
    else changeStat(team, stat, -1);
  };

  const saveEditedEvent = (updated: MatchEvent) => {
    const previous = events.find((event) => event.id === updated.id);
    if (!previous) return;
    const nextEvent = { ...updated, minute: previous.minute, period: previous.period };
    setStats((current) => applyEventStats(applyEventStats(current, previous, -1), nextEvent, 1));
    setEvents((current) => current.map((event) => event.id === nextEvent.id ? nextEvent : event));
    setEditingEvent(null);
    setContextMenu(null);
  };

  const beginGoalCorrection = (team: TeamKey) => {
    const lastGoal = events.find((event) => event.team === team && (event.tone === 'goal' || ((event.isOutcome || event.penaltyOutcome !== undefined) && event.tone === 'penalty' && event.penaltyOutcome === 'scored') || ((event.isOutcome || event.freeKickOutcome !== undefined) && event.tone === 'freeKick' && event.freeKickOutcome === 'goal')) && !event.isDisallowedGoal);
    if (!lastGoal) return;
    setGoalCorrectionTeam(team);
    setGoalCorrectionId(lastGoal.id);
    setGoalCorrectionReason('mistake');
  };

  const correctGoal = () => {
    const target = events.find((event) => event.id === goalCorrectionId);
    if (!target) return;
    if (goalCorrectionReason === 'mistake') {
      deleteEvent(target);
    } else {
      const goalLabel = target.tone === 'penalty' ? 'Penalty goal' : target.tone === 'freeKick' ? 'Free-kick goal' : target.isOwnGoal ? 'Own goal' : 'Goal';
      const corrected = { ...target, isDisallowedGoal: true, correctionReason: goalCorrectionReason, label: `${goalLabel} disallowed · ${goalCorrectionReason}` };
      setStats((current) => applyEventStats(applyEventStats(current, target, -1), corrected, 1));
      setEvents((current) => current.map((event) => event.id === target.id ? corrected : event));
    }
    setGoalCorrectionTeam(null);
    setGoalCorrectionId(null);
  };

  const setRosterSize = (team: TeamKey, size: number) => setSquadSizes((current) => ({ ...current, [team]: Math.max(1, Math.min(30, size)) }));

  const recordShootoutAttempt = (scored: boolean) => {
    const attemptsA = shootoutAttempts.filter((attempt) => attempt.team === 'teamA').length;
    const attemptsB = shootoutAttempts.filter((attempt) => attempt.team === 'teamB').length;
    const team: TeamKey = attemptsA <= attemptsB ? 'teamA' : 'teamB';
    const member = members.find((item) => item.id === shootoutMemberId);
    const attempts = [...shootoutAttempts, { team, scored, memberName: member?.name ?? 'Unassigned', id: Date.now() }];
    const kicksA = attempts.filter((attempt) => attempt.team === 'teamA').length;
    const kicksB = attempts.filter((attempt) => attempt.team === 'teamB').length;
    const goalsA = attempts.filter((attempt) => attempt.team === 'teamA' && attempt.scored).length;
    const goalsB = attempts.filter((attempt) => attempt.team === 'teamB' && attempt.scored).length;
    const suddenDeathDecision = kicksA === kicksB && kicksA >= 5 && goalsA !== goalsB;
    const clinched = kicksA < 5 || kicksB < 5
      ? goalsA > goalsB + Math.max(0, 5 - kicksB) || goalsB > goalsA + Math.max(0, 5 - kicksA)
      : false;
    setShootoutAttempts(attempts);
    setShootoutMemberId('');
    if (suddenDeathDecision || clinched) {
      const winner = goalsA > goalsB ? 'teamA' : 'teamB';
      setShootoutWinner(winner);
      setPhase('finished');
    }
  };

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      const target = event.target;
      const isInteractiveTarget = target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'A'].includes(target.tagName));
      if (event.repeat || isInteractiveTarget || pendingEvent || showStoppagePrompt || editingEvent || contextMenu) return;
      const team: TeamKey = event.shiftKey ? 'teamB' : 'teamA';
      if (event.code === 'Space') {
        event.preventDefault();
        if (phase === 'half-time' || phase === 'extra-half-time') startNextPeriod();
        else if (['first-half', 'second-half', 'extra-first-half', 'extra-second-half'].includes(phase)) setIsRunning((running) => !running);
      }
      if (event.key.toLowerCase() === 'g') requestEvent(team, 'goal', 'Goal');
      if (event.key.toLowerCase() === 'f') requestEvent(team, 'foul', 'Foul');
      if (event.key.toLowerCase() === 'y') requestEvent(team, 'yellow', 'Yellow card');
      if (event.key.toLowerCase() === 'r') requestEvent(team, 'red', 'Red card');
    };
    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  }, [contextMenu, editingEvent, pendingEvent, phase, requestEvent, showStoppagePrompt, startNextPeriod]);

  const addStoppageTime = () => {
    if (stoppageStartedAt === null) return;

    const elapsedWhileChoosing = Math.floor((Date.now() - stoppageStartedAt) / 1000);
    const addedSeconds = stoppageMinutes * 60;
    const nextLimit = matchLimitSeconds + addedSeconds;
    const currentSeconds = matchLimitSeconds + elapsedWhileChoosing;

    setMatchLimitSeconds(nextLimit);
    setSeconds(Math.min(currentSeconds, nextLimit));
    setInStoppage(true);
    setStoppageStartedAt(null);
    setShowStoppagePrompt(false);

    if (currentSeconds >= nextLimit) {
      completePeriod(nextLimit);
      return;
    }

    setIsRunning(true);
  };

  const resetMatch = () => {
    setStats({ teamA: { ...initialStats }, teamB: { ...initialStats } });
    setSeconds(0); setIsRunning(false); setEvents([]); setExtraTime(false); setExtraTimeStartSeconds(null);
    setDurationMode(90); setCustomRegulationMinutes(90); setMatchLimitSeconds(45 * 60); setPhase('first-half'); setInStoppage(false);
    setShowStoppagePrompt(false); setStoppageStartedAt(null);
    setShootoutAttempts([]); setShootoutWinner(null); setMembers([]); setSquadSizes({ teamA: 2, teamB: 2 });
    setShootoutMemberId(''); setPendingEvent(null); setEditingEvent(null); setContextMenu(null);
    setGoalCorrectionTeam(null); setGoalCorrectionId(null); setShowMemberForm(null);
    setGoalCelebration(null);
    setAiSummary(''); setAiSummaryError(''); setAiSummaryStatus('idle');
    chatControllerRef.current?.abort(); chatControllerRef.current = null;
    setChatMessages([]); setChatDraft(''); setChatError(''); setChatSending(false);
  };

  const saveMatch = () => {
    const snapshot: MatchSnapshot = { id: Date.now(), savedAt: new Date().toLocaleString(), teamA, teamB, stats, seconds, durationMode, customRegulationMinutes, events, members, extraTime, extraTimeStartSeconds, matchLimitSeconds, phase, squadSizes, shootoutAttempts, shootoutWinner };
    const nextMatches = [snapshot, ...savedMatches].slice(0, 20);
    setSavedMatches(nextMatches);
    localStorage.setItem(savedMatchesKey, JSON.stringify(nextMatches));
  };

  const loadMatch = (snapshot: MatchSnapshot) => {
    const isExtra = snapshot.extraTime ?? snapshot.durationMode === 'extra';
    const loadedMinutes = snapshot.customRegulationMinutes ?? (snapshot.durationMode === 'custom' ? 90 : snapshot.durationMode === 'extra' ? 120 : snapshot.durationMode);
    const loadedExtraStart = snapshot.extraTimeStartSeconds ?? (isExtra ? 90 * 60 : null);
    const inferredPhase: MatchPhase = isExtra
      ? snapshot.seconds < (loadedExtraStart ?? 90 * 60) + 15 * 60 ? 'extra-first-half' : 'extra-second-half'
      : snapshot.seconds >= loadedMinutes * 30 ? 'second-half' : 'first-half';
    const loadedPhase = snapshot.phase ?? inferredPhase;
    setTeamA(snapshot.teamA); setTeamB(snapshot.teamB); setStats(snapshot.stats); setSeconds(snapshot.seconds);
    setDurationMode(snapshot.durationMode === 'extra' ? 90 : snapshot.durationMode); setCustomRegulationMinutes(loadedMinutes); setExtraTime(isExtra); setPhase(loadedPhase);
    setExtraTimeStartSeconds(loadedExtraStart);
    const phaseLimit = isExtra
      ? (loadedExtraStart ?? 90 * 60) + (loadedPhase === 'extra-first-half' ? 15 * 60 : 30 * 60)
      : loadedPhase === 'first-half' ? Math.floor(loadedMinutes * 30) : loadedMinutes * 60;
    setMatchLimitSeconds(snapshot.phase || !isExtra ? snapshot.matchLimitSeconds ?? phaseLimit : phaseLimit);
    setInStoppage(false); setShowStoppagePrompt(false); setIsRunning(false);
    setStats({ teamA: { ...initialStats, ...snapshot.stats.teamA }, teamB: { ...initialStats, ...snapshot.stats.teamB } });
    setEvents(snapshot.events.map((event) => ({ ...event, memberName: event.memberName ?? 'Unassigned' })));
    setMembers(snapshot.members ?? []); setSquadSizes(snapshot.squadSizes ?? { teamA: 2, teamB: 2 });
    setShootoutAttempts(snapshot.shootoutAttempts ?? []); setShootoutWinner(snapshot.shootoutWinner ?? null); setShootoutMemberId(''); setShowSavedMatches(false);
    setGoalCelebration(null);
    setAiSummary(''); setAiSummaryError(''); setAiSummaryStatus('idle');
    chatControllerRef.current?.abort(); chatControllerRef.current = null;
    setChatMessages([]); setChatDraft(''); setChatError(''); setChatSending(false);
  };

  const deleteSavedMatch = (id: number) => {
    const nextMatches = savedMatches.filter((match) => match.id !== id);
    setSavedMatches(nextMatches);
    localStorage.setItem(savedMatchesKey, JSON.stringify(nextMatches));
  };

  const updateMember = (id: number, field: 'name' | 'number', value: string) => setMembers((current) => current.map((member) => member.id === id ? { ...member, [field]: value } : member));
  const addMember = (team: TeamKey) => {
    const name = newMemberName.trim();
    if (!name) return;
    if (members.filter((member) => member.team === team).length >= squadSizes[team]) return;
    setMembers((current) => [...current, { id: Date.now(), name, number: newMemberNumber.trim(), team }]);
    setNewMemberName(''); setNewMemberNumber(''); setShowMemberForm(null);
  };

  const selectDuration = (option: DurationMode) => {
    const minutes = option === 'custom' ? customRegulationMinutes : option === 'extra' ? 120 : option;
    setDurationMode(option); setExtraTime(false); setMatchLimitSeconds(Math.floor(minutes * 30));
    setExtraTimeStartSeconds(null); setSeconds(0); setIsRunning(false); setPhase('first-half'); setInStoppage(false); setShowStoppagePrompt(false);
  };

  const renderTeamCard = (team: TeamKey, color: 'coral' | 'mint') => {
    const name = teamName(team);
    const teamStats = stats[team];
    const setName = team === 'teamA' ? setTeamA : setTeamB;
    return (
      <section className={`team-card ${color}`} aria-label={`${name} match controls`} key={team}>
        <div className="team-card-header">
          <TeamNameEditor name={name} onChange={setName} onStartEditing={() => setEditingTeam(team)} isEditing={editingTeam === team} onStopEditing={() => setEditingTeam(null)} />
          <span className="team-tag">{team === 'teamA' ? 'HOME' : 'AWAY'}</span>
        </div>
        <div className="score-row">
          <strong>{teamStats.goals}</strong>
          <div className="score-actions">
            <button className="icon-button primary" onClick={() => requestEvent(team, 'goal', 'Goal')} aria-label={`Add goal for ${name}`}><Plus size={18} /></button>
            <button className="icon-button" onClick={() => beginGoalCorrection(team)} aria-label={`Correct or remove a goal for ${name}`}><Minus size={18} /></button>
          </div>
        </div>
        <div className="stat-grid">
          <StatControl icon={<ShieldAlert size={15} />} label="Saves" value={teamStats.saves} onAdd={() => requestEvent(team, 'save', 'Save')} onRemove={() => removeLatestStatEvent(team, 'saves')} />
          <StatControl icon={<Whistle size={15} />} label="Fouls" value={teamStats.fouls} onAdd={() => requestEvent(team, 'foul', 'Foul')} onRemove={() => removeLatestStatEvent(team, 'fouls')} />
          <StatControl icon={<Flag size={15} />} label="Yellow" value={teamStats.yellow} accent="yellow" onAdd={() => requestEvent(team, 'yellow', 'Yellow card')} onRemove={() => removeLatestStatEvent(team, 'yellow')} />
          <StatControl icon={<ShieldAlert size={15} />} label="Red" value={teamStats.red} accent="red" onAdd={() => requestEvent(team, 'red', 'Red card')} onRemove={() => removeLatestStatEvent(team, 'red')} />
          <StatControl icon={<CornerDownRight size={15} />} label="Corners" value={teamStats.corners} onAdd={() => requestEvent(team, 'corner', 'Corner')} onRemove={() => removeLatestStatEvent(team, 'corners')} />
          <StatControl icon={<Target size={15} />} label="Goal kicks" value={teamStats.goalKicks} onAdd={() => requestEvent(team, 'goalKick', 'Goal kick')} onRemove={() => removeLatestStatEvent(team, 'goalKicks')} />
          <StatControl icon={<Swords size={15} />} label="Penalties" value={teamStats.penalties} onAdd={() => requestEvent(team, 'penalty', 'Penalty awarded')} onRemove={() => removeLatestStatEvent(team, 'penalties')} />
          <StatControl icon={<Whistle size={15} />} label="Free kicks" value={teamStats.freeKicks} onAdd={() => requestEvent(team, 'freeKick', 'Free kick awarded')} onRemove={() => removeLatestStatEvent(team, 'freeKicks')} />
          <StatControl icon={<Target size={15} />} label="FK goals" value={teamStats.freeKickGoals} readOnly />
        </div>
      </section>
    );
  };

  const matchLocked = seconds > 0 || events.length > 0 || phase !== 'first-half';
  const currentShootoutTeam: TeamKey = shootoutAttempts.filter((attempt) => attempt.team === 'teamA').length <= shootoutAttempts.filter((attempt) => attempt.team === 'teamB').length ? 'teamA' : 'teamB';
  const clockButtonLabel = phase === 'half-time' ? 'Start second half' : phase === 'extra-half-time' ? 'Start ET second half' : isRunning ? 'Pause clock' : 'Start clock';
  const openEventMenu = (eventId: number, x: number, y: number) => setContextMenu({ eventId, x, y });
  const openEventDetails = (item: MatchEvent) => {
    const result = events.find((event) => event.relatedEventId === item.id);
    setPendingEvent({ id: item.id, team: item.team, tone: item.tone, label: item.label, freeKickType: item.freeKickType, penaltyOutcome: item.penaltyOutcome, freeKickOutcome: item.freeKickOutcome, isOutcome: item.isOutcome, hasRecordedOutcome: Boolean(result), resultMinute: result?.minute });
  };
  const iconForEvent = (tone: EventTone) => tone === 'goal' ? <Swords size={15} /> : tone === 'corner' ? <CornerDownRight size={15} /> : tone === 'goalKick' ? <Target size={15} /> : tone === 'penalty' ? <Flag size={15} /> : tone === 'freeKick' || tone === 'foul' ? <Whistle size={15} /> : <ShieldAlert size={15} />;
  const chronologicalEvents = [...events].reverse();
  const scoredEvents = chronologicalEvents.filter((item) => !item.isDisallowedGoal && (item.tone === 'goal' || (item.tone === 'penalty' && item.penaltyOutcome === 'scored') || (item.tone === 'freeKick' && item.freeKickOutcome === 'goal')));
  const shootoutGoalsA = shootoutAttempts.filter((attempt) => attempt.team === 'teamA' && attempt.scored).length;
  const shootoutGoalsB = shootoutAttempts.filter((attempt) => attempt.team === 'teamB' && attempt.scored).length;
  const completedResult = shootoutWinner
    ? `${teamName(shootoutWinner)} won the penalty shootout ${shootoutGoalsA}–${shootoutGoalsB} after the match finished ${stats.teamA.goals}–${stats.teamB.goals}.`
    : stats.teamA.goals === stats.teamB.goals
      ? `The match finished level at ${stats.teamA.goals}–${stats.teamB.goals}.`
      : `${stats.teamA.goals > stats.teamB.goals ? teamA : teamB} won ${stats.teamA.goals}–${stats.teamB.goals}.`;
  const goalSummary = scoredEvents.length > 0
    ? `Goals: ${scoredEvents.map((item) => `${item.memberName === 'Unassigned' ? teamName(item.team) : item.memberName} (${item.minute})`).join(', ')}.`
    : 'There were no valid goals in the timeline.';
  const matchHighlights = chronologicalEvents.filter((item) => item.tone === 'goal' || item.isOutcome || item.tone === 'yellow' || item.tone === 'red' || item.tone === 'corner' || item.tone === 'goalKick').slice(-5).reverse();
  const isAiSummaryLoading = aiSummaryStatus === 'loading' || (phase === 'finished' && aiSummaryStatus === 'idle');
  const aiSummaryPayload = JSON.stringify({
    teams: { home: teamA, away: teamB },
    finalScore: { home: stats.teamA.goals, away: stats.teamB.goals },
    result: completedResult,
    duration: `${regulationMinutes} minutes${extraTime ? ' plus extra time' : ''}`,
    shootout: shootoutAttempts.map((attempt) => ({ team: teamName(attempt.team), result: attempt.scored ? 'scored' : 'missed', player: attempt.memberName })),
    events: chronologicalEvents.slice(-160).map((item) => ({
      timestamp: item.minute,
      clockSeconds: (() => {
        const [minutes, remainingSeconds] = item.minute.split(':').map(Number);
        return Number.isFinite(minutes) && Number.isFinite(remainingSeconds) ? minutes * 60 + remainingSeconds : 0;
      })(),
      period: item.period,
      team: teamName(item.team),
      eventType: item.tone,
      role: item.isOutcome ? 'set-piece outcome' : item.tone === 'penalty' || item.tone === 'freeKick' ? 'set-piece award' : 'match event',
      label: `${item.label}${item.isDisallowedGoal ? ' (disallowed)' : ''}${item.correctionReason ? `: ${item.correctionReason}` : ''}`,
      player: item.memberName,
      relatedEventId: item.relatedEventId ?? null,
    })),
  });

  useEffect(() => {
    if (phase !== 'finished') return undefined;

    const controller = new AbortController();
    void fetch('/api/ai-summary', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: aiSummaryPayload,
      signal: controller.signal,
    }).then(async (response) => {
      const data = await response.json() as { summary?: string; model?: string; error?: string };
      if (!response.ok || !data.summary) throw new Error(data.error || 'Could not generate the AI summary.');
      setAiSummary(data.summary);
      setAiSummaryModel(data.model ?? 'gemini-3.5-flash-lite');
      setAiSummaryStatus('ready');
    }).catch((error: unknown) => {
      if (controller.signal.aborted) return;
      setAiSummaryError(error instanceof Error ? error.message : 'Could not generate the AI summary.');
      setAiSummaryStatus('error');
    });

    return () => controller.abort();
  }, [aiSummaryPayload, phase, aiSummaryRequest]);

  useEffect(() => {
    if (chatThreadRef.current) chatThreadRef.current.scrollTop = chatThreadRef.current.scrollHeight;
  }, [chatMessages, chatSending, chatError]);

  const sendChatMessage = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const question = chatDraft.trim();
    if (!question || chatSending) return;

    const nextMessages: ChatMessage[] = [...chatMessages, { role: 'user', text: question }];
    setChatMessages(nextMessages);
    setChatDraft('');
    setChatError('');
    setChatSending(true);
    const controller = new AbortController();
    chatControllerRef.current = controller;

    try {
      const response = await fetch('/api/ai-chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          messages: nextMessages.slice(-10),
          match: {
            teams: { home: teamA, away: teamB },
            score: { home: stats.teamA.goals, away: stats.teamB.goals },
            phase: period,
            events: events.slice(0, 120).reverse().map((item) => ({
              timestamp: item.minute,
              period: item.period,
              team: teamName(item.team),
              player: item.memberName,
              eventType: item.tone,
              label: item.label,
              isOutcome: Boolean(item.isOutcome),
              relatedEventId: item.relatedEventId ?? null,
              disallowed: Boolean(item.isDisallowedGoal),
            })),
            shootout: shootoutAttempts.map((attempt) => ({ team: teamName(attempt.team), scored: attempt.scored, player: attempt.memberName })),
          },
        }),
        signal: controller.signal,
      });
      const data = await response.json() as { answer?: string; error?: string };
      if (!response.ok || !data.answer) throw new Error(data.error || 'Could not get an answer.');
      setChatMessages([...nextMessages, { role: 'assistant', text: data.answer }]);
    } catch (error) {
      if (!controller.signal.aborted) setChatError(error instanceof Error ? error.message : 'Could not get an answer.');
    } finally {
      if (chatControllerRef.current === controller) {
        chatControllerRef.current = null;
        setChatSending(false);
      }
    }
  };

  return (
    <main className={`app-shell ${compactMode ? 'compact-mode' : ''}`} onClick={() => { if (contextMenu) setContextMenu(null); }}>
      {pendingEvent && <EventMemberDialog pending={pendingEvent} teamName={teamName(pendingEvent.team)} opposingName={teamName(otherTeam(pendingEvent.team))} members={members.filter((member) => member.team === pendingEvent.team)} opposingMembers={members.filter((member) => member.team === otherTeam(pendingEvent.team))} onAssign={assignEventMember} onCancel={() => { setPendingEvent(null); }} />}
      {editingEvent && <EditEventDialog event={editingEvent} members={members} teamName={teamName} onSave={saveEditedEvent} onCancel={() => setEditingEvent(null)} />}
      {goalCorrectionTeam && (
        <div className="dialog-backdrop" role="presentation">
          <section className="event-dialog" role="dialog" aria-modal="true" aria-labelledby="goal-correction-title">
            <p className="eyebrow">{teamName(goalCorrectionTeam).toUpperCase()} · SCORE CORRECTION</p>
            <h2 id="goal-correction-title">Remove a goal?</h2>
            <p className="dialog-copy">Choose the goal and why it is being removed. Mistaken taps are deleted; other reasons stay in the timeline.</p>
            <label className="event-field">Goal
              <select value={goalCorrectionId ?? ''} onChange={(event) => setGoalCorrectionId(Number(event.target.value))}>
                {events.filter((item) => item.team === goalCorrectionTeam && (item.tone === 'goal' || ((item.isOutcome || item.penaltyOutcome !== undefined) && item.tone === 'penalty' && item.penaltyOutcome === 'scored') || ((item.isOutcome || item.freeKickOutcome !== undefined) && item.tone === 'freeKick' && item.freeKickOutcome === 'goal')) && !item.isDisallowedGoal).map((item) => <option value={item.id} key={item.id}>{item.minute} · {item.memberName}</option>)}
              </select>
            </label>
            <label className="event-field">Reason
              <select value={goalCorrectionReason} onChange={(event) => setGoalCorrectionReason(event.target.value)}>
                <option value="mistake">Clicked by mistake · do not log</option>
                <option value="Offside">Offside</option>
                <option value="Foul in attack">Foul in attack</option>
                <option value="Ball did not cross the line">Ball did not cross the line</option>
                <option value="Other referee decision">Other referee decision</option>
              </select>
            </label>
            <div className="dialog-actions"><button className="dialog-cancel" onClick={() => setGoalCorrectionTeam(null)}>Cancel</button><button className="dialog-confirm" onClick={correctGoal}>Apply</button></div>
          </section>
        </div>
      )}
      {showStoppagePrompt && (
        <div className="dialog-backdrop" role="presentation">
          <section className="event-dialog stoppage-dialog" role="dialog" aria-modal="true" aria-labelledby="stoppage-title">
            <p className="eyebrow">{period} COMPLETE</p>
            <h2 id="stoppage-title">Set stoppage time</h2>
            <p className="dialog-copy">Selection time counts against the added time. The clock resumes with the remaining time.</p>
            <label className="stoppage-select-label" htmlFor="stoppage-minutes">Added minutes</label>
            <select id="stoppage-minutes" value={stoppageMinutes} onChange={(event) => setStoppageMinutes(Number(event.target.value))}>
              {Array.from({ length: 11 }, (_, minute) => <option key={minute} value={minute}>{minute} {minute === 1 ? 'minute' : 'minutes'}</option>)}
            </select>
            <div className="dialog-actions"><button className="dialog-confirm" onClick={addStoppageTime}>Confirm stoppage</button></div>
          </section>
        </div>
      )}
      <header className="topbar">
        <div><p className="eyebrow">MATCH CENTRE / {period}</p><h1>Football scoreboard</h1></div>
        <div className="top-actions">
          <label className="toggle-control"><input type="checkbox" checked={compactMode} onChange={(event) => setCompactMode(event.target.checked)} /><span className="toggle-track"></span><span>Compact</span></label>
          <label className="sound-control"><input type="checkbox" checked={soundEnabled} onChange={(event) => setSoundEnabled(event.target.checked)} /><span>{soundEnabled ? <Volume2 size={15} /> : <VolumeX size={15} />}</span><span>Sound</span></label>
          <button className="saved-button" onClick={() => setShowSavedMatches((visible) => !visible)}>Saved ({savedMatches.length})</button>
          <button className="reset-button" onClick={resetMatch}><RotateCcw size={14} /> Reset match</button>
        </div>
      </header>
      {showSavedMatches && <section className="saved-panel"><div className="panel-heading"><div><p className="eyebrow">LOCAL STORAGE</p><h2>Saved matches</h2></div><button className="close-saved" onClick={() => setShowSavedMatches(false)} aria-label="Close saved matches">×</button></div>{savedMatches.length === 0 ? <div className="empty-state"><p>No saved matches yet.</p></div> : <div className="saved-list">{savedMatches.map((match) => <div className="saved-row" key={match.id}><div><strong>{match.teamA} {match.stats.teamA.goals} — {match.stats.teamB.goals} {match.teamB}</strong><span>{match.savedAt} · {match.events.length} events</span></div><button onClick={() => loadMatch(match)}>Load</button><button onClick={() => deleteSavedMatch(match.id)} aria-label={`Delete saved match from ${match.savedAt}`}><Trash2 size={15} /></button></div>)}</div>}</section>}
      <section className="scoreboard-hero">
        {goalCelebration && <div key={goalCelebration.id} className={`goal-burst ${goalCelebration.team}`} aria-live="polite"><Sparkles size={18} /><strong>GOAL</strong><span>{teamName(goalCelebration.team)}</span></div>}
        <div className="match-meta"><span>{extraTime ? 'EXTRA TIME' : `${regulationMinutes} MIN MATCH`}</span><span className={isRunning ? 'live-dot' : ''}>{isRunning ? 'LIVE' : showStoppagePrompt ? 'SET STOPPAGE' : phase === 'half-time' || phase === 'extra-half-time' ? 'WAITING FOR REFEREE' : phase === 'shootout' ? 'SHOOTOUT' : phase === 'finished' ? 'COMPLETE' : 'READY'}</span></div>
        <div className="hero-score">
          <div className="hero-team"><span className="team-mark coral-mark">A</span><span>{teamA}</span></div>
          <div className="hero-score-number"><strong>{stats.teamA.goals}</strong><span>:</span><strong>{stats.teamB.goals}</strong></div>
          <div className="hero-team away"><span>{teamB}</span><span className="team-mark mint-mark">B</span></div>
        </div>
        <div className="timer-block"><div className="timer-readouts"><span className="match-clock">{formatTime(seconds)}</span>{isRunning && inStoppage && <span className="stoppage-clock" aria-label={`Stoppage time plus ${formatTime(stoppageElapsedSeconds)}`}><strong>+{formatTime(stoppageElapsedSeconds)}</strong><small>STOPPAGE</small></span>}</div><div>
          <button className="timer-button" onClick={() => { if (phase === 'half-time' || phase === 'extra-half-time') startNextPeriod(); else setIsRunning((running) => !running); }} disabled={showStoppagePrompt || phase === 'shootout' || phase === 'finished'}>{clockButtonLabel}</button>
        </div></div>
        <div className="duration-picker" role="group" aria-label="Match duration"><span>FORMAT</span>{durationOptions.map((option) => <button className={durationMode === option ? 'selected' : ''} key={option} disabled={matchLocked} onClick={() => selectDuration(option)}>{option === 'custom' ? 'Custom' : `${option}'`}</button>)}
          {durationMode === 'custom' && <label className="custom-duration">Minutes<input type="number" min="2" max="240" value={customRegulationMinutes} disabled={matchLocked} onChange={(event) => { const value = Math.max(2, Math.min(240, Number(event.target.value))); setCustomRegulationMinutes(value); setMatchLimitSeconds(Math.floor(value * 30)); }} /></label>}
        </div>
        {phase === 'half-time' && <div className="referee-state"><Clock3 size={16} /><span>Half-time · waiting for the referee to restart play</span><button onClick={startNextPeriod}>Start second half</button></div>}
        {phase === 'extra-half-time' && <div className="referee-state"><Clock3 size={16} /><span>Extra-time break · waiting for the referee</span><button onClick={startNextPeriod}>Start ET second half</button></div>}
        {phase === 'finished' && <p className="automatic-extra-time">{shootoutWinner ? `${teamName(shootoutWinner)} win the shootout` : 'Match complete'}</p>}
      </section>
      {phase === 'finished' && <section className="match-report" aria-labelledby="match-report-title">
        <div className="match-report-header"><div><p className="eyebrow">FINAL WHISTLE · GEMINI AI</p><h2 id="match-report-title">AI match summary</h2></div><span>{aiSummaryStatus === 'ready' ? aiSummaryModel : formatTime(seconds)}</span></div>
        <p className="match-report-result">{completedResult}</p>
        <div className={`ai-summary-copy ${aiSummaryStatus}`} aria-live="polite">
          {isAiSummaryLoading && <p><Sparkles size={16} /> Generating a recap from the match timeline…</p>}
          {aiSummaryStatus === 'ready' && <p>{aiSummary}</p>}
          {aiSummaryStatus === 'error' && <div><p className="ai-summary-error">AI summary unavailable: {aiSummaryError}</p><p className="ai-summary-fallback">Local recap: {completedResult} {goalSummary}</p><button className="ai-summary-retry" onClick={() => { setAiSummary(''); setAiSummaryError(''); setAiSummaryStatus('loading'); setAiSummaryRequest((current) => current + 1); }}>Retry AI summary</button></div>}
        </div>
        <p className="match-report-story">{goalSummary} The match log contains {events.length} recorded {events.length === 1 ? 'event' : 'events'}, including {stats.teamA.yellow + stats.teamB.yellow} yellow cards, {stats.teamA.red + stats.teamB.red} red cards, {stats.teamA.corners + stats.teamB.corners} corners, and {stats.teamA.freeKicks + stats.teamB.freeKicks} free kicks.</p>
        <div className="report-metrics"><span><strong>{stats.teamA.penalties + stats.teamB.penalties}</strong> penalties awarded</span><span><strong>{stats.teamA.goalKicks + stats.teamB.goalKicks}</strong> goal kicks</span><span><strong>{stats.teamA.freeKickGoals + stats.teamB.freeKickGoals}</strong> free-kick goals</span><span><strong>{stats.teamA.saves + stats.teamB.saves}</strong> saves</span></div>
        {matchHighlights.length > 0 && <div className="report-highlights"><h3>Key moments</h3><ol>{matchHighlights.map((item) => <li key={item.id}><time>{item.minute}</time><span>{item.label}{item.isOwnGoal ? ` · credited to ${teamName(item.team)}` : ''}</span></li>)}</ol></div>}
      </section>}
      {phase === 'shootout' && (
        <section className="shootout-panel">
          <div className="panel-heading"><div><p className="eyebrow">AET DRAW</p><h2>Penalty shootout</h2></div><span>Next: {teamName(currentShootoutTeam)}</span></div>
          <div className="shootout-score"><strong>{shootoutAttempts.filter((attempt) => attempt.team === 'teamA' && attempt.scored).length}</strong><span>:</span><strong>{shootoutAttempts.filter((attempt) => attempt.team === 'teamB' && attempt.scored).length}</strong></div>
          <label className="event-field">{teamName(currentShootoutTeam)} shooter<select value={shootoutMemberId} onChange={(event) => setShootoutMemberId(event.target.value ? Number(event.target.value) : '')}><option value="">Unassigned</option>{members.filter((member) => member.team === currentShootoutTeam).map((member) => <option key={member.id} value={member.id}>{member.number ? `#${member.number} ` : ''}{member.name}</option>)}</select></label>
          <div className="shootout-actions"><button onClick={() => recordShootoutAttempt(true)}>Scored</button><button onClick={() => recordShootoutAttempt(false)}>Missed / saved</button></div>
          <ol className="shootout-list">{shootoutAttempts.map((attempt) => <li key={attempt.id}><span>{teamName(attempt.team)}</span><strong>{attempt.scored ? 'Scored' : 'Missed'}</strong><span>{attempt.memberName}</span></li>)}</ol>
        </section>
      )}
      <div className="dashboard-grid">
        {renderTeamCard('teamA', 'coral')}{renderTeamCard('teamB', 'mint')}
        <section className="members-panel">
          <div className="panel-heading"><div><p className="eyebrow">SQUAD LIST</p><h2>Members</h2></div><span>{members.length} / {squadSizes.teamA + squadSizes.teamB} players</span></div>
          <div className="member-columns">{(['teamA', 'teamB'] as TeamKey[]).map((team) => {
            const teamMembers = members.filter((member) => member.team === team);
            const sizeChoice = rosterPresets.includes(squadSizes[team]) ? String(squadSizes[team]) : 'custom';
            return <div className="member-column" key={team}>
              <p className="member-team-name"><span className={`member-dot ${team === 'teamA' ? 'coral-dot' : 'mint-dot'}`}></span>{teamName(team)}<span className="roster-count">{teamMembers.length}/{squadSizes[team]}</span></p>
              <label className="event-field roster-size">Roster size<select value={sizeChoice} onChange={(event) => setRosterSize(team, event.target.value === 'custom' ? 3 : Number(event.target.value))}><option value="1">1v1 · 1 player</option><option value="2">2v2 · 2 players</option><option value="11">11v11 · 11 players</option><option value="custom">Custom</option></select></label>
              {sizeChoice === 'custom' && <label className="event-field roster-size">Custom players<input type="number" min="1" max="30" value={squadSizes[team]} onChange={(event) => setRosterSize(team, Number(event.target.value))} /></label>}
              {showMemberForm === team && <div className="member-entry"><input autoFocus placeholder="Member name" value={newMemberName} onChange={(event) => setNewMemberName(event.target.value)} /><input className="number-input" aria-label="Optional player number" placeholder="# optional" value={newMemberNumber} onChange={(event) => setNewMemberNumber(event.target.value)} /><button disabled={!newMemberName.trim() || teamMembers.length >= squadSizes[team]} onClick={() => addMember(team)}>Add</button></div>}
              {teamMembers.map((member) => <div className="member-row" key={member.id}><input className="number-entry" aria-label="Player number" placeholder="#" value={member.number} onChange={(event) => updateMember(member.id, 'number', event.target.value)} /><input aria-label="Player name" placeholder="Player name" value={member.name} onChange={(event) => updateMember(member.id, 'name', event.target.value)} /><button className="member-remove" onClick={() => setMembers((current) => current.filter((item) => item.id !== member.id))} aria-label={`Remove ${member.name}`}><Trash2 size={14} /></button></div>)}
              <button className="add-member-button" disabled={teamMembers.length >= squadSizes[team]} onClick={() => setShowMemberForm(showMemberForm === team ? null : team)}><Plus size={14} /> Add member</button>
            </div>;
          })}</div>
        </section>
        <section className="events-panel">
          <div className="panel-heading"><div><p className="eyebrow">MATCH LOG / {period}</p><h2>Timeline</h2></div><div className="timeline-actions"><button className="save-match-button" onClick={saveMatch}><Save size={14} /> Save match</button><span>{events.length} events</span></div></div>
          {events.length === 0 ? <div className="empty-state"><Clock3 size={23} /><p>Match events will appear here.</p></div> : <div className="event-list">{events.map((item) => <div className={`event-row ${item.isDisallowedGoal ? 'disallowed-event' : ''}`} key={item.id} role="listitem" tabIndex={0} onClick={() => openEventDetails(item)} onContextMenu={(event) => { event.preventDefault(); openEventMenu(item.id, event.clientX, event.clientY); }} onKeyDown={(event) => { if (event.target !== event.currentTarget) return; if (event.key === 'Enter') { event.preventDefault(); openEventDetails(item); } else if ((event.shiftKey && event.key === 'F10') || event.key === 'ContextMenu') { event.preventDefault(); const rect = event.currentTarget.getBoundingClientRect(); openEventMenu(item.id, rect.right, rect.top); } }}>
            <span className={`event-icon ${item.tone}`}>{iconForEvent(item.tone)}</span><div><strong>{item.label}{item.isOwnGoal && !item.isDisallowedGoal ? ` · Goal for ${teamName(item.team)}` : ''}</strong><span>{teamName(item.memberTeam ?? item.team)} · {item.memberName}{item.memberTeam && item.memberTeam !== item.team ? ` · credited to ${teamName(item.team)}` : ''} · {item.period}</span></div><time>{item.minute}</time>
            <button className="event-menu-trigger" aria-label={`More actions for ${item.label}`} aria-haspopup="menu" onClick={(event) => { event.stopPropagation(); const rect = event.currentTarget.getBoundingClientRect(); openEventMenu(item.id, rect.right, rect.bottom); }}><Ellipsis size={17} /></button>
          </div>)}</div>}
          <section className="match-chat" aria-labelledby="match-chat-title">
            <div className="chat-heading"><h3 id="match-chat-title">Ask about this match</h3><span>Timeline only</span></div>
            <div className="chat-thread" ref={chatThreadRef} role="log" aria-live="polite" aria-label="Match questions and answers">
              {chatMessages.length === 0 && !chatSending && <p className="chat-empty">Ask about goals, cards, players, or set pieces.</p>}
              {chatMessages.map((message, index) => <p className={`chat-message ${message.role}`} key={`${index}-${message.role}`}>{message.text}</p>)}
              {chatSending && <p className="chat-message assistant chat-pending">Checking the timeline…</p>}
              {chatError && <p className="chat-error" role="alert">{chatError}</p>}
            </div>
            <form className="chat-form" onSubmit={sendChatMessage}>
              <input aria-label="Ask about match events" maxLength={600} placeholder="Ask about match events…" value={chatDraft} onChange={(event) => setChatDraft(event.target.value)} disabled={chatSending} />
              <button type="submit" aria-label="Send question" disabled={!chatDraft.trim() || chatSending}><Send size={15} /></button>
            </form>
          </section>
        </section>
      </div>
      {contextMenu && <div className="event-context-menu" role="menu" style={{ left: Math.min(contextMenu.x, window.innerWidth - 190), top: Math.min(contextMenu.y, window.innerHeight - 110) }} onClick={(event) => event.stopPropagation()}>
        <button role="menuitem" onClick={() => { setEditingEvent(events.find((item) => item.id === contextMenu.eventId) ?? null); setContextMenu(null); }}><Ellipsis size={14} /> Edit event</button>
        <button role="menuitem" onClick={() => { const event = events.find((item) => item.id === contextMenu.eventId); if (event) deleteEvent(event); }}><Trash2 size={14} /> Delete event</button>
      </div>}
      <footer className="shortcut-bar"><span><kbd>Space</kbd> clock / restart half</span><span><kbd>G</kbd> / <kbd>Shift</kbd> + <kbd>G</kbd> goal + player</span><span><kbd>F</kbd> foul</span><span><kbd>Y</kbd> yellow</span><span><kbd>R</kbd> red</span><span>Right-click or <Ellipsis size={12} /> timeline event for actions</span></footer>
    </main>
  );
}

type StatControlProps = { icon: ReactNode; label: string; value: number; accent?: 'yellow' | 'red'; onAdd?: () => void; onRemove?: () => void; readOnly?: boolean };
function StatControl({ icon, label, value, accent, onAdd, onRemove, readOnly = false }: StatControlProps) {
  return <div className={`stat-control ${accent ?? ''}`}><div><span className="stat-icon">{icon}</span><span>{label}</span></div><strong>{value}</strong>{!readOnly && <div className="mini-actions"><button onClick={onRemove} aria-label={`Remove ${label}`}><Minus size={13} /></button><button onClick={onAdd} aria-label={`Add ${label}`}><Plus size={13} /></button></div>}</div>;
}

export default App;
