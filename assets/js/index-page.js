function openModal(m){ AuthUI.openModal(m); }

document.getElementById('nav-login-btn').addEventListener('click', ()=>openModal('login'));
document.getElementById('nav-register-btn').addEventListener('click', ()=>openModal('register'));
document.getElementById('hero-register-btn').addEventListener('click', ()=>openModal('register'));
document.getElementById('hero-quiz-btn').addEventListener('click', ()=>{
  document.getElementById('quiz').scrollIntoView({ behavior: 'smooth', block: 'start' });
});
document.getElementById('cta-register-btn').addEventListener('click', ()=>openModal('register'));
document.querySelectorAll('[data-action="open-register"]').forEach(btn=>{
  btn.addEventListener('click', ()=>openModal('register'));
});
(async function redirectIfLoggedIn(){
  const session = await getCurrentSession();
  if(session){ window.location.href = 'app.html'; }
})();

// Enlaces desde otras páginas: /#registro y /#acceso abren el formulario
if(location.hash === '#registro') openModal('register');
else if(location.hash === '#acceso') openModal('login');

/* ---------------- Contador animado de las estadísticas del hero ---------------- */
function formatEsNumber(n){
  return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}
function animateStatCount(el){
  const target = parseInt(el.dataset.target, 10);
  const suffix = el.dataset.suffix || '';
  const duration = 1200;
  const start = performance.now();
  function tick(now){
    const progress = Math.min((now - start) / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    const current = Math.round(target * eased);
    el.textContent = formatEsNumber(current) + suffix;
    if(progress < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}
// Las cifras del hero ya vienen escritas en el HTML (2.000+, 17, 100%): no arrancan en 0 ni dependen del JS.

/* ---------------- Mini-test anónimo (landing) ----------------
   5 preguntas reales del banco de WEREF, elegidas por el propio usuario para este teaser. */
const TEASER_QUESTIONS = [
  {
    tag: 'Regla 9 · Balón en juego',
    question: 'De las distintas reanudaciones del juego efectuadas por un jugador, ¿en cuántas de ellas el balón no estará en juego después de que se mueva o desplace con claridad?',
    options: ['En ninguna.', 'Una.', 'Dos.', 'En todas.'],
    correct: 1
  },
  {
    tag: 'Regla 1 · El terreno de juego',
    question: 'En un terreno de juego con dimensiones mínimas, ¿cuál es la distancia entre la línea del área de penalti y la línea de banda?',
    options: ['2,34', '2,62', '2,44', '3,32'],
    correct: 0
  },
  {
    tag: 'Regla 12 · Faltas y conducta incorrecta',
    question: '¿Cómo procederá disciplinariamente el árbitro cuando un miembro del cuerpo técnico cometa una infracción relacionada con el lanzamiento de objetos hacia un jugador?',
    options: ['Podrá amonestar, expulsar, o bien no adoptar ninguna medida disciplinaria.', 'Deberá amonestar o expulsar.', 'Deberá expulsar.', 'Amonestará si se lanza el objeto a balón y se expulsará si se lanza a una persona.'],
    correct: 3
  },
  {
    tag: 'Regla 12 · Faltas y conducta incorrecta',
    question: 'Un jugador en la celebración de un gol se levanta la camiseta mostrando una imagen de una "peineta". ¿Deberá tomar el árbitro alguna determinación?',
    options: ['Expulsará al jugador.', 'Amonestará al jugador en caso de que la celebración fuera excesiva.', 'No tomará ninguna medida disciplinaria, pero anotará en el informe arbitral la imagen mostrada.', 'Amonestará al jugador.'],
    correct: 0
  },
  {
    tag: 'Regla 12 · Faltas y conducta incorrecta',
    question: 'Con relación a determinar si existe infracción, ¿dónde se menciona dentro de las Reglas de Juego el texto "el límite superior del brazo coincide con el punto inferior de la axila"?',
    options: ['Regla 11', 'Regla 12.', 'Regla 11 y 12.', 'Regla 5 y 12.'],
    correct: 2
  }
];

let quizIdx = 0;
let quizScore = 0;
let quizAnswered = false;
let quizMode = 'study';
let quizAnswers = [];
const quizLetters = ['a','b','c','d'];

const QUIZ_MODE_DESC = {
  study: 'Ve la respuesta correcta y su explicación tras cada pregunta.',
  exam: 'Responde las 5 preguntas y descubre tu puntuación al final.'
};

function setQuizMode(m){
  quizMode = m;
  document.getElementById('quiz-mode-study').classList.toggle('active', m === 'study');
  document.getElementById('quiz-mode-exam').classList.toggle('active', m === 'exam');
  document.getElementById('quiz-mode-desc').textContent = QUIZ_MODE_DESC[m];
}
document.getElementById('quiz-mode-study').addEventListener('click', ()=>setQuizMode('study'));
document.getElementById('quiz-mode-exam').addEventListener('click', ()=>setQuizMode('exam'));

function renderQuizQuestion(){
  const q = TEASER_QUESTIONS[quizIdx];
  quizAnswered = false;
  document.getElementById('quiz-progress').textContent = 'Pregunta ' + (quizIdx+1) + ' de ' + TEASER_QUESTIONS.length;
  document.getElementById('quiz-live-score').textContent = quizMode === 'study' ? ('Aciertos: ' + quizScore) : (quizMode === 'exam' ? 'Modo examen' : '');
  document.getElementById('quiz-tag').textContent = q.tag || '';
  document.getElementById('quiz-question-text').textContent = q.question;
  document.getElementById('quiz-feedback').innerHTML = '';
  document.getElementById('quiz-next-wrap').style.display = 'none';
  const optsWrap = document.getElementById('quiz-options');
  optsWrap.innerHTML = q.options.map((opt,i)=>
    '<button type="button" class="option" data-i="' + i + '"><span class="letter">' + quizLetters[i] + ')</span>' + opt + '</button>'
  ).join('');
  optsWrap.querySelectorAll('.option').forEach(btn=>btn.addEventListener('click', onQuizAnswer));
}

function onQuizAnswer(e){
  if(quizAnswered) return;
  quizAnswered = true;
  const i = parseInt(e.currentTarget.dataset.i, 10);
  const q = TEASER_QUESTIONS[quizIdx];
  const isCorrect = i === q.correct;
  quizAnswers[quizIdx] = i;
  const buttons = document.querySelectorAll('#quiz-options .option');

  if(quizMode === 'study'){
    buttons.forEach((b, bi)=>{
      b.disabled = true;
      if(bi === q.correct) b.classList.add('correct');
      else if(bi === i) b.classList.add('incorrect');
    });
    if(isCorrect) quizScore++;
    document.getElementById('quiz-live-score').textContent = 'Aciertos: ' + quizScore;
    document.getElementById('quiz-feedback').innerHTML =
      '<div class="card-feedback ' + (isCorrect ? 'ok' : 'bad') + '">' +
        '<div class="ref-card ' + (isCorrect ? 'yellow' : 'red') + '"></div>' +
        '<div class="msg">' + (isCorrect ? '¡Correcto!' : 'Incorrecto.') +
          (isCorrect ? '' : '<small>La respuesta correcta era la ' + quizLetters[q.correct] + ').</small>') +
        '</div>' +
      '</div>';
  } else {
    buttons.forEach((b, bi)=>{
      b.disabled = true;
      if(bi === i) b.classList.add('selected');
    });
  }
  document.getElementById('quiz-next-wrap').style.display = 'block';
}

document.getElementById('quiz-next-btn').addEventListener('click', ()=>{
  quizIdx++;
  if(quizIdx < TEASER_QUESTIONS.length) renderQuizQuestion();
  else showQuizResult();
});

function showQuizResult(){
  if(quizMode === 'exam'){
    quizScore = quizAnswers.reduce((acc, ans, idx) => acc + (ans === TEASER_QUESTIONS[idx].correct ? 1 : 0), 0);
  }
  document.getElementById('quiz-play').style.display = 'none';
  document.getElementById('quiz-result').style.display = 'block';
  const pct = Math.round(quizScore / TEASER_QUESTIONS.length * 100);
  const pctEl = document.getElementById('quiz-score-pct');
  pctEl.textContent = pct + '%';
  pctEl.style.color = pct >= 85 ? '#1E8F5E' : pct >= 60 ? '#5B4300' : '#D62828';
  document.getElementById('quiz-score-label').textContent = quizScore + ' de ' + TEASER_QUESTIONS.length + ' respuestas correctas';
  const msg = quizScore >= 4
    ? '¡Muy bien! Estás muy cerca de dominar el reglamento.'
    : quizScore >= 2
    ? 'Vas por buen camino, pero hay margen de mejora.'
    : 'El examen puede ser más difícil de lo que parece.';
  document.getElementById('quiz-result-msg').textContent = msg;

  document.getElementById('quiz-review').style.display = 'none';
  document.getElementById('quiz-review').innerHTML = '';
  document.getElementById('quiz-review-btn').textContent = 'Revisar preguntas';
}

function renderQuizReview(){
  document.getElementById('quiz-review').innerHTML = TEASER_QUESTIONS.map((q, idx) => {
    const userAns = quizAnswers[idx];
    const optsHtml = q.options.map((opt, i) => {
      let cls = 'option';
      if(i === q.correct) cls += ' correct';
      else if(i === userAns) cls += ' incorrect';
      return '<div class="' + cls + '" style="cursor:default;"><span class="letter">' + quizLetters[i] + ')</span>' + opt + '</div>';
    }).join('');
    return '<div class="quiz-review-item">' +
      '<div class="quiz-review-tag">' + (q.tag || '') + '</div>' +
      '<div class="quiz-review-q">' + (idx + 1) + '. ' + q.question + '</div>' +
      optsHtml +
    '</div>';
  }).join('');
}

document.getElementById('quiz-review-btn').addEventListener('click', ()=>{
  const wrap = document.getElementById('quiz-review');
  const btn = document.getElementById('quiz-review-btn');
  const showing = wrap.style.display === 'block';
  if(showing){
    wrap.style.display = 'none';
    btn.textContent = 'Revisar preguntas';
  } else {
    renderQuizReview();
    wrap.style.display = 'block';
    btn.textContent = 'Ocultar revisión';
  }
});

document.getElementById('quiz-start-btn').addEventListener('click', ()=>{
  document.getElementById('quiz-intro').style.display = 'none';
  document.getElementById('quiz-play').style.display = 'block';
  quizIdx = 0;
  quizScore = 0;
  quizAnswers = [];
  renderQuizQuestion();
});

document.getElementById('quiz-register-btn').addEventListener('click', ()=>openModal('register'));
