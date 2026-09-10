// ============================================================
//  의학용어 조립 게임 서버 - 학생 개별 풀이 + 교수자 결과 확인
//  한글 용어 제시 → 어근·접두사·접미사 타일을 순서대로 조립
//  결과를 results.json 파일에 저장
// ============================================================
const express = require('express');
const path = require('path');
const fs = require('fs');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const DATA_FILE = path.join(__dirname, 'results.json');
const TEACHER_CODE = process.env.TEACHER_CODE || 'teacher';

function loadResults() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); }
  catch { return []; }
}
function saveResults(list) {
  try { fs.writeFileSync(DATA_FILE, JSON.stringify(list, null, 2)); }
  catch (e) { console.error('저장 실패:', e.message); }
}

// 학생: 결과 제출 (최고점 유지)
app.post('/api/submit', (req, res) => {
  const { name, sid, score, correct, total } = req.body || {};
  if (!name || !sid) return res.status(400).json({ ok: false });
  const list = loadResults();
  const key = String(sid).trim();
  const existing = list.find((r) => String(r.sid).trim() === key);
  const record = {
    name: String(name).trim().slice(0, 20),
    sid: key.slice(0, 20),
    score: Number(score) || 0,
    correct: Number(correct) || 0,
    total: Number(total) || 0,
    attempts: 1,
    at: new Date().toISOString(),
  };
  if (existing) {
    record.attempts = (existing.attempts || 1) + 1;
    if (existing.score >= record.score) { record.score = existing.score; record.correct = existing.correct; }
    Object.assign(existing, record);
  } else { list.push(record); }
  saveResults(list);
  res.json({ ok: true });
});

app.get('/api/results', (req, res) => {
  if (req.query.code !== TEACHER_CODE) return res.status(401).json({ ok: false, error: '비밀번호가 틀렸어요.' });
  const list = loadResults().sort((a, b) => new Date(b.at) - new Date(a.at));
  res.json({ ok: true, results: list });
});

app.post('/api/reset', (req, res) => {
  if ((req.body && req.body.code) !== TEACHER_CODE) return res.status(401).json({ ok: false });
  saveResults([]);
  res.json({ ok: true });
});

app.listen(PORT, () => console.log('  조립 게임 서버 실행 : http://localhost:' + PORT + '/'));
