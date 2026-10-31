/* ---------------- CTA BAGES · Biblioteca de exámenes · Mesa de trabajo «Pasar a la app» ----------------
   El PDF a un lado y el formulario de nueva pregunta de la Base de datos al otro: se escribe la pregunta
   mirando el examen, sin cambiar de pantalla. Guarda con la misma lógica que «Añadir pregunta»
   (persistNewQuestion, en app.js). Depende de exams.js, committee.js y app.js. */

/* ---------- limpieza del texto copiado de un PDF ----------
   Al copiar de un PDF suelen llegar: acentos como signo suelto ("´o" en lugar de "ó"), letras con el acento
   «descompuesto», ligaduras ("ﬁ"), guiones de fin de línea, saltos de línea a mitad de frase y espacios raros.
   Todo eso se arregla al pegar. Lo que el PDF no codifica bien (símbolos raros) no se puede adivinar: se avisa. */
/* signo suelto → [signo combinado, letras con las que puede formar una letra real en español y catalán] */
const EX_ACC = { '´': ['́', 'aeiouAEIOU'], '`': ['̀', 'aeiouAEIOU'], '¨': ['̈', 'aeiouAEIOU'], '˜': ['̃', 'nN'], '¸': ['̧', 'cC'] };
function examJoinAccent(l, a){ return EX_ACC[a][1].indexOf(l) >= 0 ? (l + EX_ACC[a][0]).normalize('NFC') : null; }
function examCleanText(raw, opts){
  opts = opts || {};
  let s = String(raw == null ? '' : raw);
  // texto UTF-8 leído como Latin-1 ("Ã³" en lugar de "ó")
  if(/[ÃÂ][\u0080-¿]/.test(s) && !/[^\u0000-ÿ]/.test(s)){
    try{ s = new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(s, c => c.charCodeAt(0))); }catch(e){}
  }
  s = s.replace(/\r\n?/g, '\n')
    .replace(/ﬀ/g, 'ff').replace(/ﬁ/g, 'fi').replace(/ﬂ/g, 'fl').replace(/ﬃ/g, 'ffi').replace(/ﬄ/g, 'ffl').replace(/[ﬅﬆ]/g, 'st')
    .replace(/[­​-‍⁠﻿]/g, '')
    .replace(/[  -   　\t]/g, ' ');
  // acento suelto + letra ("´o", "˜n") o letra + acento suelto ("o´")
  s = s.replace(/ı/g, 'i');                                  // la "i" sin punto de los PDF hechos con LaTeX
  s = s.replace(/([uU])¨/g, (m, l) => examJoinAccent(l, '¨'));  // "pingu¨ino": la diéresis es de la "u" anterior
  s = s.replace(/([´`¨˜¸])\s?([A-Za-z])/g, (m, a, l) => examJoinAccent(l, a) || m);
  s = s.replace(/([A-Za-z])([´`¨˜¸])/g, (m, l, a) => examJoinAccent(l, a) || m);
  s = s.normalize('NFC');
  // guion de fin de línea ("exposi-\nción") y saltos de línea a mitad de frase
  s = s.replace(/([a-záéíóúüñ])-\s*\n\s*([a-záéíóúüñ])/g, '$1$2');
  s = opts.multi ? s.replace(/\n{2,}/g, '\u0000').replace(/\s*\n\s*/g, ' ').replace(/\u0000/g, '\n\n') : s.replace(/\s*\n\s*/g, ' ');
  return s.replace(/ {2,}/g, ' ').replace(/[ \t]+\n/g, '\n').trim();
}
/* Cuántos caracteres "raros" trae el texto (símbolos que el PDF no ha codificado bien). */
function examBadChars(s){ return (String(s).match(/[�-\u0000-\u0008\u000B\u000C\u000E-\u001F]/g) || []).length; }

function examBenchNew(id){
  return { id, scope: exm().benchScope || '', question: '', a: '', b: '', c: '', d: '', correct: 'a', explanation: '', hard: false, saved: 0, msg: '', msgKind: '', saving: false };
}
function examBenchOpen(id){
  const X = exm();
  if(!examById(id)) return;
  X.bench = examBenchNew(id); X.active = id;
  STATE.view = 'committeeExamBench';
  render(); window.scrollTo(0, 0);
  const q = document.getElementById('bench-question'); if(q) q.focus();
}
function examBenchClose(){
  const X = exm();
  X.bench = null; COMMITTEE.tab = 'exams'; STATE.view = 'committeeTraining';
  render(); window.scrollTo(0, 0);
}
function examBenchScopeLabel(scope){
  if(scope === 'glossary') return 'el Glosario IFAB';
  if(scope === 'fcf') return 'el Reglament General FCF';
  return /^\d+$/.test(scope) ? 'la Regla ' + scope : '';
}
function examBenchStateHtml(e){
  const ic = (n) => shellIcon(n);
  return `<span class="ex-toggle ${e.in_app ? 'on' : ''}" style="cursor:default;">${ic(e.in_app ? 'check' : 'clock')}<span>${e.in_app ? 'En la app' : 'Pendiente'}</span></span>
    ${e.in_app
      ? `<button type="button" class="btn btn-ghost" data-exb="undo">Volver a pendiente</button>`
      : `<button type="button" class="btn btn-primary" data-exb="done">${ic('check')} Ya está en la app</button>`}
    <button type="button" class="btn btn-ghost" data-exb="next">Siguiente pendiente ${ic('chevron')}</button>`;
}
function examBenchView(){
  const ic = (n) => shellIcon(n);
  const X = exm(), B = X.bench, e = B ? examById(B.id) : null;
  if(!e) return `<button class="backbtn" data-action="committee-exam-bench-close">&larr; Volver a la biblioteca</button><div class="ac-empty">${ic('file')}<strong>No se encuentra este examen</strong><span>Puede que lo haya eliminado otra cuenta.</span></div>`;
  const cat = cmCatById(e.category_id);
  const scopeOpts = `<option value="">Elige dónde va la pregunta…</option>` + Array.from({ length: 17 }, (_, i) => i + 1).map(i => `<option value="${i}" ${B.scope === String(i) ? 'selected' : ''}>Regla ${i} — ${esc(LAW_NAMES[i])}</option>`).join('')
    + `<option value="glossary" ${B.scope === 'glossary' ? 'selected' : ''}>Glosario IFAB</option>`
    + (sharedActive() ? `<option value="fcf" ${B.scope === 'fcf' ? 'selected' : ''}>Reglament General FCF (solo Base de datos y tests)</option>` : '');
  const answers = ['a', 'b', 'c', 'd'].map(l => `
    <label class="fq-ans">
      <input type="radio" name="bench-correct" value="${l}" data-cm-field="exams.bench.correct" ${B.correct === l ? 'checked' : ''}>
      <span class="fq-letter">${l.toUpperCase()}</span>
      <input type="text" id="bench-${l}" data-cm-field="exams.bench.${l}" maxlength="300" value="${esc(B[l])}" placeholder="${l === 'd' ? 'p. ej. Ninguna respuesta es correcta.' : 'Respuesta ' + l.toUpperCase()}" aria-label="Respuesta ${l.toUpperCase()}" autocomplete="off">
      <span class="fq-ok">${ic('check')} Correcta</span>
    </label>`).join('');
  return `
  <div id="ex-bench" class="bench">
    <button class="backbtn" data-action="committee-exam-bench-close">&larr; Volver a la biblioteca</button>
    <div class="bench-head">
      <div class="bench-title"><small>Pasar a la app</small><strong>${esc(examUpper(e.title))}</strong>
        <span>${cat ? esc(cat.name) + ' · ' : ''}${esc(examSeasonName(e.season_id))} · ${esc(examFmtDate(e.exam_date))}</span></div>
      <div class="bench-state" id="bench-state">${examBenchStateHtml(e)}</div>
    </div>
    <div class="bench-grid">
      <section class="bench-pdf" id="bench-pdf"><div class="ex-prev-msg">${ic('clock')}<strong>Cargando el PDF...</strong></div></section>
      <section class="bench-side">
        <div class="tc-card bench-form">
          <div class="tc-card-head"><span class="tc-step">${ic('plus')}</span><div><h3>Nueva pregunta</h3><small id="bench-count">${B.saved ? B.saved + (B.saved === 1 ? ' guardada' : ' guardadas') + ' en esta sesión' : 'Se publica en la Base de datos al guardarla'}</small></div></div>
          <label for="bench-scope" style="margin-top:0;">Ámbito</label>
          <select id="bench-scope" data-cm-field="exams.bench.scope">${scopeOpts}</select>
          <label for="bench-question">Pregunta</label>
          <textarea id="bench-question" data-cm-field="exams.bench.question" rows="3" maxlength="1000" placeholder="Escribe el enunciado...">${esc(B.question)}</textarea>
          <label>Respuestas <small class="cm-opt">marca la correcta</small></label>
          <div class="fq-answers">${answers}</div>
          <label for="bench-explanation">Explicación <small class="cm-opt">opcional</small></label>
          <textarea id="bench-explanation" data-cm-field="exams.bench.explanation" rows="2" maxlength="2000" placeholder="Por qué es correcta, artículo del reglamento...">${esc(B.explanation)}</textarea>
          <label class="fq-hard"><input type="checkbox" id="bench-hard" data-cm-field="exams.bench.hard" ${B.hard ? 'checked' : ''}><span><strong>Es una pregunta difícil</strong><small>Aparecerá también en la Sala VAR</small></span></label>
          <div class="bench-msg ${B.msgKind}" id="bench-msg" role="status">${esc(B.msg)}</div>
          <div class="bench-actions">
            <button type="button" class="btn btn-primary" id="bench-save" data-action="committee-exam-bench-save" ${B.saving ? 'disabled' : ''}>${ic('check')} Guardar y añadir otra</button>
            <small>Ctrl + Intro para guardar</small>
          </div>
        </div>
      </section>
    </div>
  </div>`;
}
async function examBenchPdf(){
  const X = exm(), B = X.bench; if(!B) return;
  const e = examById(B.id), box = document.getElementById('bench-pdf'); if(!e || !box) return;
  const ic = (n) => shellIcon(n);
  if(!examCanEmbed()){
    box.innerHTML = `<div class="ex-prev-msg">${ic('file')}<strong>El PDF no se puede ver aquí</strong><span>Descárgalo para consultarlo mientras escribes.</span><button type="button" class="btn btn-primary" data-action="committee-exam-download" data-id="${e.id}">${ic('download')} Descargar PDF</button></div>`;
    return;
  }
  try{
    const url = await examBlobUrl(e);
    const b = document.getElementById('bench-pdf');
    if(!X.bench || X.bench.id !== e.id || !b) return;
    b.innerHTML = `<iframe class="ex-frame" src="${url}#navpanes=0&view=FitH" title="PDF de ${esc(examUpper(e.title))}"></iframe>`;
  }catch(err){
    const b = document.getElementById('bench-pdf');
    if(b) b.innerHTML = `<div class="ex-prev-msg">${ic('flag')}<strong>No se pudo cargar el PDF</strong><span>${esc(examErr(err))}</span></div>`;
  }
}
function examBenchMsg(text, kind){
  const B = exm().bench; if(!B) return;
  B.msg = text; B.msgKind = kind;
  const m = document.getElementById('bench-msg'); if(m){ m.textContent = text; m.className = 'bench-msg ' + kind; }
}
async function examBenchSave(){
  const B = exm().bench; if(!B || B.saving) return;
  if(!B.scope){ examBenchMsg('Elige primero dónde va la pregunta (una regla, el Glosario...).', 'bad'); const s = document.getElementById('bench-scope'); if(s) s.focus(); return; }
  const question = examCleanText(B.question), a = examCleanText(B.a), b = examCleanText(B.b), c = examCleanText(B.c), d = examCleanText(B.d) || 'Ninguna respuesta es correcta.';
  if(!question || !a || !b || !c){ examBenchMsg('Rellena al menos la pregunta y las respuestas A, B y C.', 'bad'); return; }
  const domain = B.scope === 'glossary' ? 'glossary' : B.scope === 'fcf' ? 'fcf' : 'law';
  const r = persistNewQuestion({ domain, rule: domain === 'law' ? parseInt(B.scope, 10) : null, question, options: [a, b, c, d], correct: B.correct, explanation: examCleanText(B.explanation, { multi: true }), difficulty: B.hard ? 'hard' : 'normal' });
  if(!r.ok){ examBenchMsg(r.msg, 'bad'); return; }
  B.saving = true;
  const btn = document.getElementById('bench-save'); if(btn) btn.disabled = true;
  const ok = await r.saving;
  B.saving = false;
  if(ok === false) return;          // la escritura falló: la app ya ha avisado y recargado el formulario
  B.saved++;
  exm().benchScope = B.scope;
  Object.assign(B, { question: '', a: '', b: '', c: '', d: '', correct: 'a', explanation: '', hard: false });
  // se vacían los campos sin repintar la pantalla (así el PDF no se recarga ni pierde la página)
  const set = (id, v) => { const el = document.getElementById(id); if(el) el.value = v; };
  set('bench-question', ''); ['a', 'b', 'c', 'd'].forEach(l => set('bench-' + l, '')); set('bench-explanation', '');
  const h = document.getElementById('bench-hard'); if(h) h.checked = false;
  const ra = document.querySelector('input[name="bench-correct"][value="a"]'); if(ra) ra.checked = true;
  const b2 = document.getElementById('bench-save'); if(b2) b2.disabled = false;
  const cnt = document.getElementById('bench-count'); if(cnt) cnt.textContent = B.saved + (B.saved === 1 ? ' guardada' : ' guardadas') + ' en esta sesión';
  examBenchMsg('Guardada en ' + examBenchScopeLabel(B.scope) + '.', 'ok');
  const q = document.getElementById('bench-question'); if(q) q.focus();
}
function examBenchStateRefresh(){
  const B = exm().bench, e = B && examById(B.id);
  const s = document.getElementById('bench-state'); if(s && e) s.innerHTML = examBenchStateHtml(e);
}
function examBenchNextPending(){
  const X = exm(), B = X.bench; if(!B) return;
  const list = examVisible();
  const i = list.findIndex(x => x.id === B.id);
  const next = list.slice(i + 1).find(x => !x.in_app) || (i < 0 ? list.find(x => !x.in_app) : null);
  if(!next){ cmToast('No quedan más exámenes pendientes en esta lista.'); return; }
  examBenchOpen(next.id);
}
function examBenchAfter(){
  const root = document.getElementById('ex-bench'); if(!root) return;
  // al pegar en cualquier campo del formulario, el texto se limpia (acentos, ligaduras, saltos de línea...)
  ['bench-question', 'bench-a', 'bench-b', 'bench-c', 'bench-d', 'bench-explanation'].forEach(id => {
    const el = document.getElementById(id); if(!el) return;
    el.addEventListener('paste', (ev) => {
      const cd = ev.clipboardData || window.clipboardData; const raw = cd ? cd.getData('text') : '';
      if(!raw) return;
      ev.preventDefault();
      const clean = examCleanText(raw, { multi: id === 'bench-explanation' });
      if(!(document.execCommand && document.execCommand('insertText', false, clean))){
        el.setRangeText(clean, el.selectionStart, el.selectionEnd, 'end');
        el.dispatchEvent(new Event('input', { bubbles: true }));
      }
      const bad = examBadChars(clean);
      if(bad) examBenchMsg('El PDF no codifica bien ' + bad + (bad === 1 ? ' carácter' : ' caracteres') + ' de lo que has pegado (salen como símbolos raros). Revísalo y corrígelo a mano.', 'bad');
    });
  });
  root.addEventListener('keydown', (ev) => {
    if((ev.ctrlKey || ev.metaKey) && ev.key === 'Enter'){ ev.preventDefault(); examBenchSave(); }
  });
  // los botones de la cabecera se repintan al cambiar el estado, por eso se atienden desde aquí
  root.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-exb]');
    if(b && root.contains(b)){ ev.preventDefault(); examOnAction('committee-exam-bench-' + b.dataset.exb, b); }
  });
  examBenchPdf();
}
