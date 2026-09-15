const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const TEACHER_CODE = process.env.TEACHER_CODE || 'teacher';
const DATA_FILE = path.join(__dirname, 'results.json');
const STATE_FILE = path.join(__dirname, 'gamestate.json');

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── 데이터 로드/저장 ──
function loadData() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch {
    return {};
  }
}
function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

// ── 게임 상태 로드/저장 (lobby=대기중, playing=진행중) ──
function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return { status: 'lobby', round: 0, startedAt: null };
  }
}
function saveState(s) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2));
}

// ── 학생 제출: 최고점 유지, 제출 횟수 기록 ──
app.post('/api/submit', (req, res) => {
  const { name, sid, classNo, score, correct, total } = req.body || {};
  if (!name || !sid || score == null) {
    return res.status(400).json({ ok: false, error: 'invalid' });
  }
  const data = loadData();
  const key = sid + '|' + name;           // 학번+이름으로 학생 식별
  const prev = data[key];
  const now = new Date().toISOString();

  if (!prev) {
    data[key] = {
      name, sid, classNo: classNo || '',
      score, correct, total,
      attempts: 1,
      bestAt: now, updatedAt: now
    };
  } else {
    prev.attempts = (prev.attempts || 1) + 1;
    prev.updatedAt = now;
    prev.classNo = classNo || prev.classNo || '';
    if (score > (prev.score || 0)) {       // 최고점만 갱신
      prev.score = score;
      prev.correct = correct;
      prev.total = total;
      prev.bestAt = now;
    }
  }
  saveData(data);
  res.json({ ok: true });
});

// ── 게임 중 실시간 진행 점수 (매 문제마다 호출) ──
app.post('/api/progress', (req, res) => {
  const { name, sid, classNo, score, current, total, playing } = req.body || {};
  if (!name || !sid) return res.status(400).json({ ok: false, error: 'invalid' });
  const data = loadData();
  const key = sid + '|' + name;
  const now = new Date().toISOString();
  const prev = data[key] || {};
  data[key] = {
    name, sid, classNo: classNo || prev.classNo || '',
    // 최종 최고점(score)은 건드리지 않고, 진행 중 값은 별도 필드에 저장
    score: prev.score || 0,
    correct: prev.correct, total: prev.total,
    attempts: prev.attempts || 0,
    bestAt: prev.bestAt, updatedAt: now,
    // 실시간 진행 상태
    live: {
      score: score || 0,
      current: current || 0,
      total: total || 22,
      playing: playing !== false,
      at: now
    }
  };
  saveData(data);
  res.json({ ok: true });
});

// ── 교수자 조회 ──
app.get('/api/results', (req, res) => {
  if (req.query.code !== TEACHER_CODE) {
    return res.status(403).json({ ok: false, error: 'forbidden' });
  }
  const data = loadData();
  const list = Object.values(data).sort((a, b) => {
    // 분반 → 점수 내림차순 → 이름 순
    if ((a.classNo || '') !== (b.classNo || '')) return (a.classNo || '').localeCompare(b.classNo || '');
    if ((b.score || 0) !== (a.score || 0)) return (b.score || 0) - (a.score || 0);
    return (a.name || '').localeCompare(b.name || '');
  });
  res.json({ ok: true, list });
});

// ── 실시간 순위 (누구나 조회, 익명) ──
app.get('/api/leaderboard', (req, res) => {
  const data = loadData();
  const cf = req.query.classNo;
  let list = Object.values(data);
  if (cf) list = list.filter(r => String(r.classNo) === String(cf));

  // 표시 점수: 게임 중이면 실시간 점수(live.score), 끝났으면 최고점(score) 중 큰 값
  const withScore = list.map(r => {
    const liveScore = (r.live && r.live.playing) ? (r.live.score || 0) : 0;
    const bestScore = r.score || 0;
    const showScore = Math.max(liveScore, bestScore);
    const playing = !!(r.live && r.live.playing);
    // 최근 활동 시각 (정렬 tie-break: 먼저 도달한 사람이 위로)
    const at = (r.live && r.live.at) ? r.live.at : (r.bestAt || r.updatedAt || 0);
    return {
      name: r.name, sid: r.sid, classNo: r.classNo || '',
      showScore, playing,
      current: (r.live && r.live.current) || 0,
      total: (r.live && r.live.total) || r.total || 22,
      at
    };
  });

  withScore.sort((a, b) => {
    if (b.showScore !== a.showScore) return b.showScore - a.showScore;
    return new Date(a.at || 0) - new Date(b.at || 0);
  });

  const safe = withScore.map((r, i) => ({
    rank: i + 1,
    classNo: r.classNo,
    sidTail: r.sid ? String(r.sid).slice(-2) : '',
    score: r.showScore,
    current: r.current,
    total: r.total,
    playing: r.playing
  }));
  res.json({ ok: true, list: safe, count: safe.length });
});
app.post('/api/reset', (req, res) => {
  if ((req.body || {}).code !== TEACHER_CODE) {
    return res.status(403).json({ ok: false, error: 'forbidden' });
  }
  saveData({});
  res.json({ ok: true });
});

// ── 게임 상태 조회 (학생·강의화면이 수시로 확인) ──
app.get('/api/state', (req, res) => {
  res.json({ ok: true, state: loadState() });
});

// ── 교수: 게임 시작 (모든 학생 동시 출발) ──
app.post('/api/start', (req, res) => {
  if ((req.body || {}).code !== TEACHER_CODE) {
    return res.status(403).json({ ok: false, error: 'forbidden' });
  }
  const prev = loadState();
  const state = { status: 'playing', round: (prev.round || 0) + 1, startedAt: new Date().toISOString() };
  saveState(state);
  res.json({ ok: true, state });
});

// ── 교수: 대기실로 되돌리기 (새 라운드 준비, 기록도 초기화) ──
app.post('/api/lobby', (req, res) => {
  if ((req.body || {}).code !== TEACHER_CODE) {
    return res.status(403).json({ ok: false, error: 'forbidden' });
  }
  const prev = loadState();
  saveState({ status: 'lobby', round: prev.round || 0, startedAt: null });
  saveData({});   // 새 게임 준비: 이전 기록 비움
  res.json({ ok: true });
});

// ── 대기실 참가자 명단 (게임 시작 전 모인 학생) ──
app.post('/api/waiting', (req, res) => {
  const { name, sid, classNo } = req.body || {};
  if (!name || !sid) return res.status(400).json({ ok: false, error: 'invalid' });
  const data = loadData();
  const key = sid + '|' + name;
  const now = new Date().toISOString();
  const prev = data[key] || {};
  data[key] = {
    name, sid, classNo: classNo || prev.classNo || '',
    score: prev.score || 0, correct: prev.correct, total: prev.total,
    attempts: prev.attempts || 0, bestAt: prev.bestAt, updatedAt: now,
    waiting: true,
    live: prev.live || null
  };
  saveData(data);
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
