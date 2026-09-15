const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const TEACHER_CODE = process.env.TEACHER_CODE || 'teacher';
const DATA_FILE = path.join(__dirname, 'results.json');

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

// ── 실시간 순위 (누구나 조회, 개인정보는 최소화) ──
app.get('/api/leaderboard', (req, res) => {
  const data = loadData();
  const cf = req.query.classNo;  // 선택: 특정 분반만
  let list = Object.values(data);
  if (cf) list = list.filter(r => String(r.classNo) === String(cf));
  // 점수 내림차순 → 최근 갱신 빠른 순
  list.sort((a, b) => {
    if ((b.score || 0) !== (a.score || 0)) return (b.score || 0) - (a.score || 0);
    return new Date(a.bestAt || 0) - new Date(b.bestAt || 0);
  });
  // 학번은 뒷자리 일부만 마스킹해서 공개 (동명이인 구분용)
  const safe = list.map((r, i) => ({
    rank: i + 1,
    name: r.name,
    classNo: r.classNo || '',
    sidTail: r.sid ? String(r.sid).slice(-2) : '',
    score: r.score,
    total: r.total
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

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
