
/* ----------------- DOM Helpers & Toasts ----------------- */
const $ = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => Array.from((r||document).querySelectorAll(s));
const toasts = $("#toasts");

function toast(msg, kind='ok', t=3500){
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = msg;
  toasts.appendChild(el);
  setTimeout(()=> el.remove(), t);
}

/* ----------------- Theme & UI ----------------- */
const body = document.body;
const presetTheme = $("#presetTheme");
presetTheme.addEventListener('change', (e) => {
  const mode = e.target.value;
  applyPreset(mode);
});
function applyPreset(mode){
  if (mode === 'babymonster'){
    document.documentElement.style.setProperty('--accent-pink','#ff0066');
    document.documentElement.style.setProperty('--accent-purple','#2de3ff');
    body.dataset.mode = 'babymonster';
    toast('BABYMONSTER preset applied','ok',2000);
  } else {
    document.documentElement.style.setProperty('--accent-pink','#ff3aa6');
    document.documentElement.style.setProperty('--accent-purple','#9b6bff');
    body.dataset.mode = 'blackpink';
    toast('BLACKPINK preset applied','ok',2000);
  }
}
$("#toggleTheme").addEventListener('click', ()=> body.classList.toggle('theme-light'));

/* ----------------- Tabs ----------------- */
$$('.tab').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    $$('.tab').forEach(b=>b.classList.remove('active'));
    $$('.panel').forEach(p=>p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(btn.dataset.tab).classList.add('active');
    window.scrollTo({top:0, behavior:'smooth'});
  });
});

/* ----------------- Transformers.js Pipelines ----------------- */
const pipelines = {};
const pending = {};
async function getPipeline(task, model, tag){
  const key = `${task}::${model}`;
  if (pipelines[key]) return pipelines[key];
  if (pending[key]) return pending[key];
  toast(`Loading ${task} (${model}) — first time may be slow.`, 'warn', 4000);
  const opts = {
    progress_callback: ev => {
      if (ev && ev.status) {
        toast(`${ev.status}...`, 'warn', 1400);
      }
    },
    quantized: true,
    device: navigator.gpu ? 'webgpu' : 'wasm'
  };
  const p = window.transformers.pipeline(task, model, opts);
  pending[key] = p;
  try {
    const pipe = await p;
    pipelines[key] = pipe;
    delete pending[key];
    toast(`${task} ready`, 'ok', 2400);
    return pipe;
  } catch (err) {
    delete pending[key];
    console.error(err);
    toast(`Failed to load ${task}`, 'err', 5000);
    throw err;
  }
}

/* ----------------- Global Study State ----------------- */
const Study = {
  transcript: '',
  chunks: [],   // {text}
  notes: '',
  embeds: null, // {vectors:[], texts:[]}
  quiz: []      // {q,a}
};

/* ----------------- Utility: chunk text ----------------- */
function splitIntoChunks(text, maxLen=600){
  const sents = text.split(/(?<=[.!?])\s+/);
  const chunks = [];
  let buf='';
  for (const s of sents){
    if ((buf + ' ' + s).trim().length > maxLen){
      if (buf.trim()) chunks.push({text: buf.trim()});
      buf = s;
    } else {
      buf = (buf ? buf + ' ' : '') + s;
    }
  }
  if (buf.trim()) chunks.push({text: buf.trim()});
  return chunks;
}

/* ----------------- Audio Recording & ASR ----------------- */
let mediaRecorder = null;
let recChunks = [];
const recBtn = $('#recToggle');
const recAudio = $('#recAudio');
const audioFile = $('#audioFile');
const fileAudio = $('#fileAudio');

recBtn.addEventListener('click', async ()=>{
  try {
    if (!mediaRecorder){
      const stream = await navigator.mediaDevices.getUserMedia({audio:true});
      mediaRecorder = new MediaRecorder(stream);
      mediaRecorder.ondataavailable = e => recChunks.push(e.data);
      mediaRecorder.onstop = () => {
        const blob = new Blob(recChunks, {type:'audio/webm'});
        recChunks = [];
        recAudio.src = URL.createObjectURL(blob);
        toast('Recording saved locally', 'ok', 2200);
      };
      mediaRecorder.start();
      recBtn.textContent = '🛑 Stop Recording';
      toast('Recording — click stop when finished', 'warn', 2500);
    } else {
      mediaRecorder.stop();
      mediaRecorder = null;
      recBtn.textContent = '🎤 Start Recording';
    }
  } catch (err){
    console.error(err);
    toast('Microphone permission denied', 'err', 3500);
  }
});

$('#transcribeRec').addEventListener('click', async ()=>{
  if (!recAudio.src) return toast('Record something first', 'warn');
  const blob = await (await fetch(recAudio.src)).blob();
  await transcribeBlob(blob);
});

$('#transcribeFile').addEventListener('click', async ()=>{
  if (!audioFile.files?.[0]) return toast('Choose an audio file first', 'warn');
  const f = audioFile.files[0];
  fileAudio.src = URL.createObjectURL(f);
  await transcribeBlob(f);
});

$('#playFile').addEventListener('click', ()=>{
  if (fileAudio.src) fileAudio.play();
});

async function transcribeBlob(blob){
  try {
    const asr = await getPipeline('automatic-speech-recognition', 'Xenova/whisper-tiny.en', 'asr');
    const out = await asr(blob);
    const text = out?.text ?? '';
    Study.transcript = text;
    $('#transcript').value = text;
    toast('Transcription finished', 'ok', 3000);
  } catch (err){
    console.error(err);
    toast('Transcription error — try again or use a shorter file', 'err', 4500);
  }
}

/* ----------------- Split & Export SRT ----------------- */
$('#splitChunks').addEventListener('click', ()=>{
  const t = $('#transcript').value.trim();
  if (!t) return toast('No transcript to chunk', 'warn');
  Study.transcript = t;
  Study.chunks = splitIntoChunks(t, 500);
  $('#chunkInfo').textContent = `${Study.chunks.length} chunks created.`;
  Study.notes = (Study.notes + '\n\n' + t).trim();
  $('#notebook').value = Study.notes;
  toast('Transcript chunked & merged to notebook', 'ok', 2400);
});

$('#exportSRT').addEventListener('click', ()=>{
  if (!Study.chunks.length) return toast('Create chunks first', 'warn');
  const lines = [];
  Study.chunks.forEach((c,i)=>{
    const start = i * 4; // rough
    const end = start + 4;
    const fmt = (s) => {
      const mm = String(Math.floor(s/60)).padStart(2,'0');
      const ss = String(s%60).padStart(2,'0');
      return `00:${mm}:${ss},000`;
    };
    lines.push(`${i+1}\n${fmt(start)} --> ${fmt(end)}\n${c.text}\n`);
  });
  const blob = new Blob([lines.join('\n')], {type:'text/plain'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'transcript.srt';
  a.click();
});

/* ----------------- PDF parsing (pdf.js) ----------------- */
const pdfInput = $('#pdfFiles');
const pdfList = $('#pdfList');

pdfInput.addEventListener('change', async ()=>{
  if (!pdfInput.files?.length) return;
  const pdfjsLib = window['pdfjs-dist/build/pdf'];
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
  for (const file of pdfInput.files){
    try {
      const data = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({data}).promise;
      let text = '';
      for (let i=1;i<=pdf.numPages;i++){
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        const pageText = content.items.map(it=>it.str).join(' ');
        text += `\n\n# Page ${i}\n` + pageText;
      }
      Study.notes = (Study.notes + '\n\n' + `# ${file.name}\n` + text).trim();
      const item = document.createElement('div');
      item.className = 'card';
      item.textContent = `Parsed: ${file.name} — ${text.length.toLocaleString()} chars`;
      pdfList.prepend(item);
      $('#notebook').value = Study.notes;
      toast(`Parsed ${file.name}`, 'ok', 2000);
    } catch (err){
      console.error(err);
      toast(`Failed to parse ${file.name}`, 'err', 3000);
    }
  }
});

/* ----------------- Summarization (distilbart) ----------------- */
$('#sumRun').addEventListener('click', async ()=>{
  const text = $('#sumInput').value.trim();
  if (!text) return toast('Paste text to summarize', 'warn');
  try {
    const sum = await getPipeline('summarization', 'Xenova/distilbart-cnn-6-6', 'sum');
    const out = await sum(text, { min_length: Number($('#sumMin').value||40), max_length: Number($('#sumMax').value||160) });
    $('#sumOut').textContent = out[0]?.summary_text ?? '(no output)';
  } catch (err){
    console.error(err);
    toast('Summarization failed', 'err', 3500);
  }
});

/* ----------------- Notebook Summarize & Embed ----------------- */
$('#summarizeNotes').addEventListener('click', async ()=>{
  const t = $('#notebook').value.trim();
  if (!t) return toast('Notebook empty', 'warn');
  try {
    const sum = await getPipeline('summarization', 'Xenova/distilbart-cnn-6-6', 'sumNotes');
    const out = await sum(t.slice(0, 20000), {min_length: 60, max_length: 220});
    $('#summaryOut').textContent = out[0]?.summary_text ?? '';
    toast('Notes summarized', 'ok', 2500);
  } catch (err){
    console.error(err);
    toast('Notes summarization failed', 'err', 3500);
  }
});

let embedder = null;
$('#embedNotes').addEventListener('click', async ()=>{
  try {
    embedder = await getPipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', 'emb');
    const raw = $('#notebook').value.trim();
    if (!raw) return toast('No notes to embed', 'warn');
    const chunks = splitIntoChunks(raw, 400);
    Study.embeds = { vectors: [], texts: chunks.map(c=>c.text) };
    $('#embedStatus').textContent = `Embedding ${chunks.length} chunks...`;
    for (let i=0;i<chunks.length;i++){
      const out = await embedder(chunks[i].text, { pooling:'mean', normalize:true });
      const vec = out.data ? out.data : out[0];
      Study.embeds.vectors.push(Array.from(vec));
      $('#embedStatus').textContent = `Embedding ${i+1}/${chunks.length}...`;
    }
    $('#embedStatus').textContent = `Embedded ${chunks.length} chunks.`;
    toast('Embeddings ready', 'ok', 2200);
  } catch (err){
    console.error(err);
    toast('Embedding failed', 'err', 3500);
  }
});

/* ----------------- Semantic Search ----------------- */
function cosine(a,b){
  let s=0;
  for (let i=0;i<a.length;i++) s += a[i]*b[i];
  return s;
}
$('#runSearch').addEventListener('click', async ()=>{
  const q = $('#searchQuery').value.trim();
  const outList = $('#searchResults');
  outList.innerHTML = '';
  if (!q) return toast('Enter a query', 'warn');
  if (!Study.embeds) return toast('Build embeddings first', 'warn');
  try {
    const qvecRaw = await embedder(q, { pooling:'mean', normalize:true });
    const qvec = qvecRaw.data ? qvecRaw.data : qvecRaw[0];
    const scores = Study.embeds.vectors.map((v,i)=>({i, s: cosine(qvec, v)}));
    scores.sort((a,b)=>b.s-a.s);
    for (const {i,s} of scores.slice(0,10)){
      const li = document.createElement('li');
      li.innerHTML = `<strong>Score:</strong> ${s.toFixed(3)}<div>${Study.embeds.texts[i]}</div>`;
      outList.appendChild(li);
    }
  } catch (err){
    console.error(err);
    toast('Search failed', 'err', 3000);
  }
});

/* ----------------- Topic Graph (d3) ----------------- */
$('#buildGraph').addEventListener('click', ()=>{
  const text = $('#notebook').value.trim() || $('#transcript').value.trim();
  if (!text) return toast('Add notes/transcript first', 'warn');
  const topN = Number($('#kwCount').value) || 30;
  const keywords = extractKeywords(text, topN);
  buildD3Graph(text, keywords);
});

function extractKeywords(text, topN=30){
  const stop = new Set("a,an,the,and,or,but,if,then,else,when,while,of,to,in,on,for,with,as,by,at,from,into,that,this,these,those,is,are,was,were,be,been,has,have,had,do,does,did,not,no,so,than,too,very,can,will,just,about,over,under,more,most,less".split(","));
  const words = text.toLowerCase().replace(/[^a-z0-9\s-]/g,' ').split(/\s+/).filter(Boolean).filter(w=>!stop.has(w) && w.length>2);
  const windowSize = 4;
  const idx = new Map(), nodes=[];
  function idOf(w){ if(!idx.has(w)){ idx.set(w, idx.size); nodes.push({w, score:1}); } return idx.get(w); }
  const edges = new Map();
  for (let i=0;i<words.length;i++){
    const wi = words[i]; const iId = idOf(wi);
    for (let j=i+1;j<Math.min(i+windowSize, words.length); j++){
      const wj = words[j]; const jId = idOf(wj);
      const key = iId<jId ? `${iId}-${jId}` : `${jId}-${iId}`;
      edges.set(key, (edges.get(key)||0)+1);
    }
  }
  const deg = new Array(nodes.length).fill(0);
  edges.forEach((w,k)=>{ const [i,j]=k.split('-').map(Number); deg[i]+=w; deg[j]+=w; });
  for (let it=0; it<30; it++){
    const newScore = new Array(nodes.length).fill(0.15);
    edges.forEach((w,k)=>{ const [i,j]=k.split('-').map(Number); if (deg[i]>0) newScore[j]+=0.85*(nodes[i].score*w/deg[i]); if (deg[j]>0) newScore[i]+=0.85*(nodes[j].score*w/deg[j]); });
    nodes.forEach((n,idx)=> n.score=newScore[idx]);
  }
  nodes.sort((a,b)=>b.score-a.score);
  return nodes.slice(0, topN).map(n=>n.w);
}

function buildD3Graph(text, keywords){
  // Build co-occurrence links for chosen keywords
  const words = text.toLowerCase().replace(/[^a-z0-9\s-]/g,' ').split(/\s+/).filter(Boolean);
  const index = new Map(keywords.map((k,i)=>[k,i]));
  const linkMap = new Map();
  const windowSize = 6;
  for (let i=0;i<words.length;i++){
    const wi = words[i];
    if (!index.has(wi)) continue;
    for (let j=i+1;j<Math.min(i+windowSize, words.length); j++){
      const wj = words[j];
      if (!index.has(wj) || wi===wj) continue;
      const a = index.get(wi), b = index.get(wj);
      const key = a<b?`${a}-${b}`:`${b}-${a}`;
      linkMap.set(key, (linkMap.get(key)||0)+1);
    }
  }
  const nodes = keywords.map((w,i)=>({id:i, label:w}));
  const links = Array.from(linkMap.entries()).map(([k,v])=>{ const [s,t]=k.split('-').map(Number); return {source:s, target:t, weight:v}; });

  const svg = d3.select('#graphSvg');
  svg.selectAll('*').remove();
  const width = svg.node().clientWidth, height = svg.node().clientHeight;

  const sim = d3.forceSimulation(nodes)
    .force('link', d3.forceLink(links).id(d=>d.id).distance(d=> 120/(1+Math.log1p(d.weight))))
    .force('charge', d3.forceManyBody().strength(-260))
    .force('center', d3.forceCenter(width/2, height/2));

  const link = svg.append('g').attr('stroke','rgba(255,255,255,0.12)').selectAll('line').data(links).enter().append('line').attr('stroke-width', d=>Math.log2(1+d.weight)+0.5);
  const node = svg.append('g').selectAll('g').data(nodes).enter().append('g').call(d3.drag()
    .on('start', (e,d)=>{ if(!e.active) sim.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; })
    .on('drag', (e,d)=>{ d.fx = e.x; d.fy = e.y; })
    .on('end', (e,d)=>{ if(!e.active) sim.alphaTarget(0); d.fx = null; d.fy = null; }));

  node.append('circle').attr('r', 10).attr('fill', 'url(#grad)').attr('stroke', 'rgba(255,255,255,0.1)').attr('stroke-width',1.2);
  node.append('text').text(d=>d.label).attr('x',14).attr('y',4).style('fill','#f1f5fb').style('font-size','12px');

  sim.on('tick', ()=>{
    link.attr('x1', d=>d.source.x).attr('y1', d=>d.source.y).attr('x2', d=>d.target.x).attr('y2', d=>d.target.y);
    node.attr('transform', d=>`translate(${d.x},${d.y})`);
  });
}

/* ----------------- Quiz Generation (T5) ----------------- */
$('#genQuiz').addEventListener('click', async ()=>{
  const t = $('#notebook').value.trim() || $('#transcript').value.trim();
  if (!t) return toast('Add notes or transcript first', 'warn');
  const n = Number($('#qCount').value) || 10;
  try {
    const t5 = await getPipeline('text2text-generation', 'Xenova/LaMini-Flan-T5-248M', 't5');
    const prompt = `Create ${n} concise flashcard pairs as "Q: ... A: ..." from notes:\n\n${t.slice(0,4000)}\n\nNumber them.`;
    const res = await t5(prompt, { max_new_tokens: Math.min(32*n, 1024), temperature:0.6 });
    const text = res[0]?.generated_text || '';
    const pairs = [];
    text.split(/\n+/).forEach(line=>{
      const m = line.match(/Q:\s*(.+?)\s*A:\s*(.+)/i);
      if (m) pairs.push({q:m[1].trim(), a:m[2].trim()});
    });
    if (!pairs.length){
      const chunks = splitIntoChunks(t,200).slice(0,n);
      chunks.forEach((c,i)=> pairs.push({q:`What is the key point ${i+1}?`, a:c.text}));
    }
    Study.quiz = pairs.slice(0,n);
    renderQuiz();
    toast('Quiz generated', 'ok', 2400);
  } catch (err){
    console.error(err);
    toast('Quiz generation failed', 'err', 3500);
  }
});

function renderQuiz(){
  const list = $('#quizList');
  list.innerHTML = '';
  Study.quiz.forEach((p,i)=>{
    const el = document.createElement('div');
    el.className = 'card';
    el.innerHTML = `<strong>${i+1}. ${escapeHtml(p.q)}</strong><details><summary>Show answer</summary><div style="margin-top:8px">${escapeHtml(p.a)}</div></details>`;
    list.appendChild(el);
  });
}
$('#exportCSV').addEventListener('click', ()=>{
  if (!Study.quiz.length) return toast('No quiz to export', 'warn');
  const csv = ['Question,Answer', ...Study.quiz.map(({q,a})=>`"${q.replace(/"/g,'""')}","${a.replace(/"/g,'""')}"`)].join('\n');
  const blob = new Blob([csv], {type:'text/csv'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'flashcards.csv';
  a.click();
});

/* ----------------- Export All ----------------- */
$('#exportAll').addEventListener('click', ()=>{
  const data = {
    transcript: Study.transcript,
    notes: $('#notebook').value,
    summary: $('#summaryOut').textContent,
    quiz: Study.quiz
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], {type:'application/json'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'ai-forge-export.json';
  a.click();
});

/* ----------------- Utilities ----------------- */
function escapeHtml(s){ return s.replace(/[&<>"']/g, (m)=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));}

/* ----------------- Graph export ----------------- */
$('#downloadGraph').addEventListener('click', ()=>{
  const svg = $('#graphSvg');
  const xml = new XMLSerializer().serializeToString(svg);
  const svgBlob = new Blob([xml], {type:'image/svg+xml;charset=utf-8'});
  const url = URL.createObjectURL(svgBlob);
  const img = new Image();
  img.onload = ()=>{
    const canvas = document.createElement('canvas');
    canvas.width = svg.clientWidth; canvas.height = svg.clientHeight;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = getComputedStyle(document.body).getPropertyValue('--bg') || '#000';
    ctx.fillRect(0,0,canvas.width,canvas.height);
    ctx.drawImage(img,0,0);
    canvas.toBlob(png=>{
      const a = document.createElement('a');
      a.href = URL.createObjectURL(png);
      a.download = 'topic-graph.png';
      a.click();
    });
  };
  img.src = url;
});

/* ----------------- Clear Cache ----------------- */
$('#clearCache').addEventListener('click', async ()=>{
  try {
    if (window.caches) {
      for (const k of await caches.keys()) await caches.delete(k);
    }
    if (indexedDB && indexedDB.databases){
      const dbs = await indexedDB.databases();
      for (const d of dbs) if (d.name) indexedDB.deleteDatabase(d.name);
    }
    toast('Cache cleared. Reload recommended.', 'ok', 3000);
  } catch (err){
    console.warn(err);
    toast('Could not fully clear cache', 'warn', 3000);
  }
});

/* ----------------- Small init and hints ----------------- */
applyPreset('blackpink'); // default
toast('Tip: First model loads may be slow — weigh patience. Use desktop for best results.', 'warn', 7000);
