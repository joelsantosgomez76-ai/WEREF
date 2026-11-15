/* WEREF · guías: barra de progreso, índice activo, preguntas interactivas y filtros de /guias/.
   Todo es mejora progresiva: sin JavaScript la página se lee igual (índice, respuestas desplegables y todas las tarjetas). */
(function(){
  'use strict';

  // 1 · barra de progreso de lectura + sección activa del índice
  var article = document.getElementById('gd-article');
  var bar = document.querySelector('.rp i');
  if(article && bar){
    var heads = [].slice.call(article.querySelectorAll('h2[id]')).filter(function(h){ return h.id !== 'gd-sum-t'; });
    var links = [].slice.call(document.querySelectorAll('.gd-toc a'));
    var ticking = false;
    var update = function(){
      ticking = false;
      var r = article.getBoundingClientRect();
      var total = r.height - window.innerHeight * 0.6;
      var done = Math.min(1, Math.max(0, (-r.top + 80) / Math.max(total, 1)));
      bar.style.transform = 'scaleX(' + done.toFixed(4) + ')';
      var cur = null;
      for(var i = 0; i < heads.length; i++){ if(heads[i].getBoundingClientRect().top <= 140) cur = heads[i].id; else break; }
      links.forEach(function(a){
        var on = cur && a.getAttribute('href') === '#' + cur;
        a.classList.toggle('is-on', !!on);
        if(on) a.setAttribute('aria-current', 'true'); else a.removeAttribute('aria-current');
      });
    };
    var onScroll = function(){ if(!ticking){ ticking = true; window.requestAnimationFrame(update); } };
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    update();
    // en móvil, al elegir una sección se pliega el índice
    [].forEach.call(document.querySelectorAll('.gd-toc-m a'), function(a){
      a.addEventListener('click', function(){ var d = a.closest('details'); if(d) d.removeAttribute('open'); });
    });
  }

  // 2 · preguntas interactivas (marcadas con data-ok): el HTML ya trae la respuesta en un <details>
  var allQ = [].slice.call(document.querySelectorAll('.qi[data-ok]')), done = 0, hits = 0;
  var showScore = function(){
    var art = document.getElementById('gd-article');
    if(!art || !art.getAttribute('data-rule') || done < allQ.length || art.querySelector('.qz-score')) return;
    var n = art.getAttribute('data-rule'), cta = art.getAttribute('data-cta') || '/#registro';
    var msg = hits === allQ.length ? '¡Perfecto! Te sabes esta regla.' : (hits >= Math.ceil(allQ.length * 0.6) ? 'Vas bien, pero repasa lo que has fallado.' : 'Repasa la regla y vuelve a intentarlo.');
    var box = document.createElement('div'); box.className = 'qz-score'; box.setAttribute('role', 'status');
    box.innerHTML = '<p class="qz-n">' + hits + '<small>/' + allQ.length + '</small></p><div><p class="qz-t">Tu resultado</p><p class="qz-d">' + msg + '</p><a class="btn btn-yellow" href="' + cta + '">Haz el test completo de la Regla ' + n + '</a></div>';
    var last = allQ[allQ.length - 1]; last.parentNode.insertBefore(box, last.nextSibling);
  };
  [].forEach.call(document.querySelectorAll('.qi[data-ok]'), function(q){
    var ok = q.getAttribute('data-ok');
    var list = q.querySelector('.pg-q-o');
    if(!list) return;
    var items = [].slice.call(list.children);
    var letters = ['A', 'B', 'C', 'D'];
    var btns = [];
    items.forEach(function(li, i){
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'qi-opt';
      var l = document.createElement('span'); l.className = 'qi-l'; l.textContent = letters[i];
      var t = document.createElement('span'); t.innerHTML = li.innerHTML;
      b.appendChild(l); b.appendChild(t);
      li.innerHTML = ''; li.appendChild(b); btns.push(b);
      b.addEventListener('click', function(){
        btns.forEach(function(x, k){
          x.disabled = true;
          if(letters[k] === ok) x.classList.add('is-ok');
        });
        var good = letters[i] === ok;
        done++; if(good) hits++;
        if(!good) b.classList.add('is-ko');
        var res = document.createElement('p');
        res.className = 'qi-res ' + (good ? 'is-ok' : 'is-ko');
        res.setAttribute('role', 'status');
        res.textContent = good ? '¡Correcto!' : 'No es esa. La respuesta correcta es la ' + ok + '.';
        list.parentNode.insertBefore(res, list.nextSibling);
        var d = q.querySelector('details'); if(d) d.setAttribute('open', '');
        showScore();
      });
    });
    q.classList.add('is-live');
  });

  // 3 · filtros de /guias/
  var filters = document.querySelector('.gl-filters');
  if(filters){
    filters.hidden = false;
    var cards = [].slice.call(document.querySelectorAll('.gl-card'));
    var feat = document.querySelector('.gl-feat');
    var empty = document.querySelector('.gl-empty');
    var apply = function(f){
      var n = 0;
      cards.forEach(function(c){ var show = f === 'todas' || c.getAttribute('data-cat') === f; c.hidden = !show; if(show) n++; });
      if(feat){ var fs = f === 'todas' || feat.getAttribute('data-cat') === f; feat.hidden = !fs; if(fs) n++; }
      if(empty) empty.hidden = n > 0;
      [].forEach.call(filters.querySelectorAll('.gl-f'), function(b){
        var on = b.getAttribute('data-f') === f;
        b.classList.toggle('is-on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
    };
    filters.addEventListener('click', function(e){
      var b = e.target.closest ? e.target.closest('.gl-f') : null;
      if(b) apply(b.getAttribute('data-f'));
    });
    var h = (location.hash || '').replace('#', '');
    if(h && filters.querySelector('[data-f="' + h + '"]')) apply(h);
  }
})();
