import {type ReactNode, useMemo, useState} from 'react';
import {ArrowLeft, CheckCircle2, ChevronRight, ClipboardList, Gauge, Plus, ShieldCheck, Trophy} from 'lucide-react';
import './index.css';

type Sport = 'Pickleball' | 'Padel' | 'Tennis' | 'Badminton' | 'Table Tennis';
type EventType = 'Singles' | 'Doubles' | 'Mixed Doubles';
type Format = 'Round Robin' | 'Knockout' | 'League' | 'Swiss' | 'Groups + Knockout';
type Workflow = 'home' | 'create' | 'dashboardSelect' | 'dashboard' | 'refereeSelect' | 'courtSelect' | 'assignedMatch' | 'score' | 'admin';
type MatchStatus = 'waiting' | 'ready' | 'playing' | 'completed';

type ScoringPreset = {mode: 'points' | 'tennis'; matchType: string; target?: number; winBy?: number; cap?: number | null; note: string};
type TournamentDraft = {sport?: Sport; event?: EventType; players?: number; courts?: number; scoring?: ScoringPreset; format?: Format; name: string; location: string; date: string; time: string};
type Match = {id: number; round: number; court?: number; teamA: string; teamB: string; status: MatchStatus; score?: string; dependsOn?: number[]; estimatedMinutes: number};

const sports: Sport[] = ['Pickleball', 'Padel', 'Tennis', 'Badminton', 'Table Tennis'];
const supportedEvents: Record<Sport, EventType[]> = {
  Pickleball: ['Singles', 'Doubles', 'Mixed Doubles'], Padel: ['Doubles', 'Mixed Doubles'], Tennis: ['Singles', 'Doubles', 'Mixed Doubles'], Badminton: ['Singles', 'Doubles', 'Mixed Doubles'], 'Table Tennis': ['Singles', 'Doubles'],
};
const presets: Record<Sport, ScoringPreset> = {
  Pickleball: {mode: 'points', matchType: 'Best of 3', target: 11, winBy: 2, cap: null, note: 'Race to 11, win by 2'},
  Badminton: {mode: 'points', matchType: 'Best of 3', target: 21, winBy: 2, cap: 30, note: 'Race to 21, cap at 30'},
  'Table Tennis': {mode: 'points', matchType: 'Best of 5', target: 11, winBy: 2, cap: null, note: 'Serve changes every 2 points'},
  Padel: {mode: 'tennis', matchType: 'Best of 3 sets', note: '15 · 30 · 40 · Deuce · Advantage'},
  Tennis: {mode: 'tennis', matchType: 'Best of 3 sets', note: 'Traditional tennis scoring with tie-breaks'},
};
const formats: Format[] = ['Round Robin', 'Knockout', 'League', 'Swiss', 'Groups + Knockout'];
const playerCounts = [8, 12, 16, 20, 24, 32];
const samplePlayers = ['David / Sam', 'Kevin / Alan', 'Priya / Noor', 'Maya / Zoe', 'Chris / Lee', 'Nina / Omar', 'Ava / Kai', 'Iris / Ben'];

function buildInitialMatches(courts: number): Match[] {
  return [
    {id: 1, round: 1, court: 1, teamA: samplePlayers[0], teamB: samplePlayers[1], status: 'playing', estimatedMinutes: 12},
    {id: 2, round: 1, court: courts > 1 ? 2 : undefined, teamA: samplePlayers[2], teamB: samplePlayers[3], status: courts > 1 ? 'playing' : 'ready', estimatedMinutes: 12},
    {id: 3, round: 1, teamA: samplePlayers[4], teamB: samplePlayers[5], status: 'waiting', estimatedMinutes: 12},
    {id: 4, round: 1, teamA: samplePlayers[6], teamB: samplePlayers[7], status: 'waiting', estimatedMinutes: 12},
    {id: 5, round: 2, teamA: 'Winner Match 1', teamB: 'Winner Match 2', status: 'waiting', dependsOn: [1, 2], estimatedMinutes: 14},
    {id: 6, round: 2, teamA: 'Winner Match 3', teamB: 'Winner Match 4', status: 'waiting', dependsOn: [3, 4], estimatedMinutes: 14},
  ];
}

function canPlay(match: Match, matches: Match[]) {
  return !match.dependsOn?.some((id) => matches.find((m) => m.id === id)?.status !== 'completed');
}

function autoAssign(matches: Match[], courts: number) {
  const busy = new Set(matches.filter((m) => m.status === 'playing').map((m) => m.court));
  const freeCourts = Array.from({length: courts}, (_, i) => i + 1).filter((court) => !busy.has(court));
  const next = matches.map((m) => ({...m}));
  for (const court of freeCourts) {
    const eligible = next.find((m) => (m.status === 'waiting' || m.status === 'ready') && !m.court && canPlay(m, next));
    if (eligible) Object.assign(eligible, {court, status: 'ready' as MatchStatus});
  }
  return next;
}

const defaultDraft: TournamentDraft = {name: 'Friday Club Championship', location: '', date: new Date().toISOString().slice(0, 10), time: '18:00'};

export default function App() {
  const [workflow, setWorkflow] = useState<Workflow>('home');
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<TournamentDraft>(defaultDraft);
  const [matches, setMatches] = useState<Match[]>(() => autoAssign(buildInitialMatches(2), 2));
  const courts = draft.courts ?? 2;
  const stats = useMemo(() => {
    const completed = matches.filter((m) => m.status === 'completed').length;
    const playing = matches.filter((m) => m.status === 'playing').length;
    const ready = matches.filter((m) => m.status === 'ready');
    const remaining = matches.length - completed;
    return {completed, playing, ready, remaining, progress: Math.round((completed / matches.length) * 100), eta: remaining * 12};
  }, [matches]);

  const publish = () => { setMatches(autoAssign(buildInitialMatches(courts), courts)); setWorkflow('dashboard'); };
  const completeMatch = (id: number) => setMatches((items) => autoAssign(items.map((m) => m.id === id ? {...m, status: 'completed', score: '11-8, 11-7', court: undefined} : m), courts));
  const startReady = (id: number) => setMatches((items) => items.map((m) => m.id === id ? {...m, status: 'playing'} : m));

  if (workflow === 'home') return <Shell><Home onCreate={() => {setStep(0); setWorkflow('create');}} onDashboard={() => setWorkflow('dashboardSelect')} onReferee={() => setWorkflow('refereeSelect')} onAdmin={() => setWorkflow('admin')} /></Shell>;
  if (workflow === 'create') return <Shell title="Create Tournament" onBack={() => setWorkflow('home')}><Builder step={step} draft={draft} setDraft={setDraft} next={() => setStep((s) => Math.min(7, s + 1))} back={() => step ? setStep(step - 1) : setWorkflow('home')} publish={publish} /></Shell>;
  if (workflow === 'dashboardSelect') return <Shell title="Tournament Dashboard" onBack={() => setWorkflow('home')}><TournamentSelect action="Open live dashboard" onSelect={() => setWorkflow('dashboard')} /></Shell>;
  if (workflow === 'refereeSelect') return <Shell title="Score Tournament" onBack={() => setWorkflow('home')}><TournamentSelect action="Choose court" onSelect={() => setWorkflow('courtSelect')} /></Shell>;
  if (workflow === 'courtSelect') return <Shell title="Court Selection" onBack={() => setWorkflow('refereeSelect')}><ChoiceGrid values={[1,2,3,4].slice(0,courts)} render={(c) => `Court ${c}`} onPick={() => setWorkflow('assignedMatch')} /></Shell>;
  if (workflow === 'assignedMatch') return <Shell title="Assigned Match" onBack={() => setWorkflow('courtSelect')}><Assigned match={matches.find(m => m.status === 'playing') ?? matches.find(m => m.status === 'ready')} onScore={() => setWorkflow('score')} /></Shell>;
  if (workflow === 'score') return <Shell title="Scoring Screen" onBack={() => setWorkflow('assignedMatch')}><Score match={matches.find(m => m.status === 'playing') ?? matches[0]} onComplete={(id) => {completeMatch(id); setWorkflow('assignedMatch');}} /></Shell>;
  if (workflow === 'admin') return <Shell title="Admin Dashboard" onBack={() => setWorkflow('home')}><Admin /></Shell>;
  return <Shell><Dashboard matches={matches} courts={courts} stats={stats} startReady={startReady} completeMatch={completeMatch} /></Shell>;
}

function Shell({children, title, onBack}: {children: ReactNode; title?: string; onBack?: () => void}) { return <main className="app-shell">{title && <header className="topbar"><button className="icon-button" onClick={onBack} aria-label="Back"><ArrowLeft /></button><div><p>Social Circle</p><h1>{title}</h1></div></header>}<div className="phone-frame">{children}</div></main>; }
function Home(p: {onCreate:()=>void; onDashboard:()=>void; onReferee:()=>void; onAdmin:()=>void}) { const buttons = [['Create Tournament', Plus, p.onCreate], ['Tournament Dashboard', Gauge, p.onDashboard], ['Score / Referee Tournament', ClipboardList, p.onReferee], ['Admin Access', ShieldCheck, p.onAdmin]] as const; return <section className="home"><div className="home-stack" aria-label="Choose a workflow">{buttons.map(([label, Icon, onClick]) => <button className="workflow-button" key={label} onClick={onClick}><Icon /><strong>{label}</strong><ChevronRight /></button>)}</div><footer>Built by @av1dandsouza aka defiouza</footer></section>; }
function Builder({step,draft,setDraft,next,back,publish}: any) { const set = (patch: Partial<TournamentDraft>) => setDraft({...draft, ...patch}); const screens = [<Question title="What sport are you playing?" eyebrow="Step 1"><ChoiceGrid values={sports} onPick={(sport) => {set({sport, scoring: presets[sport as Sport]}); next();}} /></Question>, <Question title="What event is this?" eyebrow="Step 2"><ChoiceGrid values={supportedEvents[draft.sport as Sport] ?? []} onPick={(event) => {set({event}); next();}} /></Question>, <Question title="How many players?" eyebrow="Step 3"><ChoiceGrid values={playerCounts} onPick={(players) => {set({players}); next();}} extra="Custom can be enabled by an organizer from Admin." /></Question>, <Question title="How many courts?" eyebrow="Step 4"><ChoiceGrid values={[1,2,3,4]} render={(v) => '①②③④'[Number(v)-1]} onPick={(courts) => {set({courts}); next();}} /></Question>, <ScoringQuestion draft={draft} set={set} next={next} />, <Question title="Choose tournament format" eyebrow="Step 6"><ChoiceGrid values={formats} onPick={(format) => {set({format}); next();}} /></Question>, <Details draft={draft} set={set} next={next} />, <Review draft={draft} publish={publish} />]; return <><Progress step={step}/>{screens[step]}<button className="secondary sticky" onClick={back}>Back</button></>; }
function Question({title,eyebrow,children,extra}: any){return <section className="card"><p className="eyebrow">{eyebrow}</p><h2>{title}</h2>{children}{extra && <p className="muted">{extra}</p>}</section>}
function ChoiceGrid({values,onPick,render}: any){return <div className="choice-grid">{values.map((v:any)=><button className="choice" key={v} onClick={()=>onPick(v)}>{render?render(v):v}</button>)}</div>}
function Progress({step}: {step:number}){return <div className="progress"><span style={{width:`${((step+1)/8)*100}%`}} /></div>}
function ScoringQuestion({draft,set,next}: any){const preset = draft.scoring ?? presets[draft.sport as Sport]; return <Question title="How will matches be scored?" eyebrow="Step 5"><button className="option-card" onClick={()=>{set({scoring:preset}); next();}}><CheckCircle2/><strong>{preset?.mode === 'tennis' ? 'Traditional Tennis Scoring' : 'First to X Points'}</strong><span>{preset?.matchType} · {preset?.note}</span></button><button className="option-card" onClick={()=>{set({scoring:{mode:'points', matchType:'Single Game', target:15, winBy:1, cap:null, note:'Fast custom race'}}); next();}}>Single Game · 15 · Win by 1</button></Question>}
function Details({draft,set,next}: any){return <Question title="Tournament details" eyebrow="Step 7"><label>Name<input value={draft.name} onChange={e=>set({name:e.target.value})}/></label><label>Date<input type="date" value={draft.date} onChange={e=>set({date:e.target.value})}/></label><label>Start time<input type="time" value={draft.time} onChange={e=>set({time:e.target.value})}/></label><label>Location<input placeholder="Optional" value={draft.location} onChange={e=>set({location:e.target.value})}/></label><button className="primary sticky" onClick={next}>Review tournament</button></Question>}
function Review({draft,publish}: any){return <Question title="Review and publish" eyebrow="Step 8"><div className="review-list">{Object.entries(draft).filter(([,v])=>v).map(([k,v])=><p key={k}><span>{k}</span><strong>{typeof v === 'object' && v && 'note' in v ? String(v.note) : String(v)}</strong></p>)}</div><button className="primary sticky" onClick={publish}>Publish Tournament</button></Question>}
function TournamentSelect({action,onSelect}: {action:string; onSelect:()=>void}){return <section className="card"><p className="eyebrow">Tournament Selection</p><h2>Select an active tournament</h2><button className="option-card" onClick={onSelect}><Trophy/><strong>Friday Club Championship</strong><span>Pickleball · 16 players · 2 courts</span><em>{action}</em></button></section>}
function Dashboard({matches,courts,stats,startReady,completeMatch}: any){const ready = stats.ready[0]; return <section className="dashboard"><div className="hero-card"><p>Court {ready?.court ?? '—'} Available</p><h2>NEXT MATCH READY</h2><strong>{ready ? `${ready.teamA} vs ${ready.teamB}` : 'No eligible matches'}</strong><span>Waiting to be announced</span>{ready && <button className="primary" onClick={()=>startReady(ready.id)}>Send to court {ready.court}</button>}</div><div className="metrics"><Metric label="Progress" value={`${stats.progress}%`}/><Metric label="Remaining" value={stats.remaining}/><Metric label="ETA" value={`${stats.eta}m`}/><Metric label="Utilization" value={`${Math.round((stats.playing/courts)*100)}%`}/></div><h3>Live court status</h3>{[...Array(courts)].map((_,i)=>{const court=i+1; const m=matches.find((x:Match)=>x.court===court && x.status !== 'completed'); return <article className={`court-row ${m?'busy':'free'}`} key={court}><b>Court {court}</b><span>{m ? `${m.status}: ${m.teamA} vs ${m.teamB}` : 'Available'}</span>{m?.status==='playing' && <button onClick={()=>completeMatch(m.id)}>Complete</button>}</article>})}<MatchList matches={matches}/><Standings /></section>}
function Metric({label,value}: any){return <div><strong>{value}</strong><span>{label}</span></div>}
function MatchList({matches}: {matches: Match[]}){return <div className="list"><h3>Fixtures</h3>{matches.map(m=><article key={m.id}><span>R{m.round} · Match {m.id}</span><b>{m.teamA} vs {m.teamB}</b><em>{m.status}{m.court ? ` · Court ${m.court}`:''}</em></article>)}</div>}
function Standings(){return <div className="list"><h3>Standings</h3>{['David / Sam','Priya / Noor','Kevin / Alan'].map((p,i)=><article key={p}><span>#{i+1}</span><b>{p}</b><em>{6-i} pts</em></article>)}</div>}
function Assigned({match,onScore}: any){return <section className="card"><p className="eyebrow">Assigned Match</p><h2>{match?.teamA} vs {match?.teamB}</h2><p className="muted">Large-score workflow optimized for referees on court.</p><button className="primary sticky" onClick={onScore}>Open scoring screen</button></section>}
function Score({match,onComplete}: any){const [a,setA]=useState(0),[b,setB]=useState(0); return <section className="score"><div><h2>{match.teamA}</h2><button onClick={()=>setA(a+1)}>{a}</button></div><div><h2>{match.teamB}</h2><button onClick={()=>setB(b+1)}>{b}</button></div><button className="primary sticky" onClick={()=>onComplete(match.id)}>Submit completed match</button></section>}
function Admin(){return <section className="card"><p className="eyebrow">Admin</p><h2>Full access dashboard</h2><div className="role-grid">{['Tournament Dashboard','Players','Fixtures','Standings','Publish','Audit Log'].map(x=><button className="choice" key={x}>{x}</button>)}</div></section>}
