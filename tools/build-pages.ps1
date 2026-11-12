# Genera las paginas publicas de las Reglas de Juego, el indice y el sitemap.
#   content\reglas\NN-*.md      guias (una por regla ya escrita)
#   content\reglas\_indice.txt  las 17 reglas: numero|slug|nombre|resumen
#   content\reglas\_hub.md      texto del indice /reglas-de-juego/
#   tools\templates\page.html   plantilla comun
# Salida: reglas-de-juego\..., sitemap.xml y assets\css\landing.css (con el numero de version).
# Uso (desde la carpeta del sitio):  powershell -ExecutionPolicy Bypass -File tools\build-pages.ps1
# IMPORTANTE: este archivo solo contiene ASCII; todo el texto en castellano vive en content\ y tools\templates\.
param([string]$Site = (Split-Path -Parent $PSScriptRoot))
$ErrorActionPreference = 'Stop'
$utf8 = New-Object System.Text.UTF8Encoding($false)
$Base = 'https://we-ref.com'
$TotalReglas = 17

function RU([string]$p){ return [IO.File]::ReadAllText($p, $utf8) }
function WU([string]$p, [string]$t){
  $d = Split-Path -Parent $p
  if(-not (Test-Path $d)){ New-Item -ItemType Directory -Force $d | Out-Null }
  [IO.File]::WriteAllText($p, $t, $utf8)
}
function Esc([string]$s){ return $s.Replace('&', '&amp;').Replace('<', '&lt;').Replace('>', '&gt;') }
function EscA([string]$s){ return (Esc $s).Replace('"', '&quot;') }
function Inline([string]$s){
  $t = [regex]::Replace((Esc $s), '\*\*(.+?)\*\*', '<strong>$1</strong>')
  # enlaces [texto](url): los externos se abren en otra pestana
  $t = [regex]::Replace($t, '\[([^\]]+)\]\((https?://[^)\s]+)\)', '<a href="$2" target="_blank" rel="noopener">$1</a>')
  $t = [regex]::Replace($t, '\[([^\]]+)\]\((/[^)\s]*)\)', '<a href="$2">$1</a>')
  return $t
}
function Slug([string]$s){
  $n = $s.Normalize([Text.NormalizationForm]::FormD); $sb = New-Object Text.StringBuilder
  foreach($c in $n.ToCharArray()){ if([Globalization.CharUnicodeInfo]::GetUnicodeCategory($c) -ne 'NonSpacingMark'){ [void]$sb.Append($c) } }
  return ($sb.ToString().ToLower() -replace '[^a-z0-9]+', '-').Trim('-')
}
function Fill([string]$tpl, $v){ foreach($k in $v.Keys){ $tpl = $tpl.Replace('{{' + $k + '}}', [string]$v[$k]) }; return $tpl }
function GitDate([string]$rel){
  $d = ''
  try{ $d = (& git -C $Site log -1 '--format=%cs' -- $rel 2>$null | Select-Object -First 1) }catch{}
  if(-not $d){ $d = (Get-Date).ToString('yyyy-MM-dd') }
  return $d
}

# Reparte la letra correcta de forma fija y reproducible (en el texto original casi todas eran la B).
# Preguntas de cifras (opciones cortas con numeros): se mantiene el orden, pero se invierte en la mitad.
# El resto: la opcion correcta se coloca en la posicion objetivo y las demas conservan su orden.
$Targets = 2, 0, 3, 1, 3, 1, 2, 0, 1, 3, 0, 2, 0, 2, 1, 3
function Reorder-Q($q, [int]$num, [int]$n){
  $letters = 'A', 'B', 'C', 'D'
  $opts = @(); foreach($l in $letters){ $opts += $q[$l] }
  $ok = [array]::IndexOf($letters, $q['OK'])
  $short = $true
  foreach($o in $opts){ if($o -notmatch '\d' -or $o.Length -gt 45){ $short = $false } }
  $seed = $num * 5 + $n
  if($short){
    if($seed % 2 -eq 1){ [array]::Reverse($opts); $ok = 3 - $ok }
  } else {
    # las opciones tipo "Ninguna..." / "Todas..." se quedan donde estan
    $anch = @(); for($i = 0; $i -lt 4; $i++){ if($opts[$i] -match '^\s*(Ninguna|Ninguno|Todas|Todos)\b'){ $anch += $i } }
    if($anch -notcontains $ok){
      $free = @(); for($i = 0; $i -lt 4; $i++){ if($anch -notcontains $i){ $free += $i } }
      $t = $free[$Targets[$seed % $Targets.Length] % $free.Count]
      $correct = $opts[$ok]; $rest = @()
      foreach($i in $free){ if($i -ne $ok){ $rest += $opts[$i] } }
      $new = @($opts); $ri = 0
      foreach($i in $free){ if($i -eq $t){ $new[$i] = $correct } else { $new[$i] = $rest[$ri]; $ri++ } }
      $opts = $new; $ok = $t
    }
  }
  $r = @{ Q = $q['Q']; EXP = $q['EXP']; OK = $letters[$ok] }
  for($i = 0; $i -lt 4; $i++){ $r[$letters[$i]] = $opts[$i] }
  return $r
}

function Render-Q($q, [int]$n){
  $opts = ''
  foreach($l in 'A', 'B', 'C', 'D'){ $opts += '<li>' + (Inline $q[$l]) + '</li>' }
  return '<section class="pg-q"><p class="pg-q-n">Pregunta ' + $n + '</p><p class="pg-q-t">' + (Inline $q['Q']) + '</p><ol class="pg-q-o" type="A">' + $opts + '</ol><details class="pg-q-a"><summary>Ver la respuesta</summary><p><strong>Respuesta correcta: ' + $q['OK'] + '.</strong> ' + (Inline $q['EXP']) + '</p></details></section>'
}

function Parse-Md([string]$text){
  $text = $text.Replace("`r`n", "`n")
  $meta = @{}; $body = $text
  if($text.StartsWith("---`n")){
    $end = $text.IndexOf("`n---", 3)
    foreach($l in ($text.Substring(4, $end - 4) -split "`n")){ if($l -match '^([a-z0-9_]+):\s*(.*)$'){ $meta[$Matches[1]] = $Matches[2].Trim() } }
    $body = $text.Substring($end + 4).TrimStart("`n")
  }
  $num = 0; if($meta.ContainsKey('num')){ $num = [int]$meta['num'] }
  $html = New-Object System.Text.StringBuilder
  $para = New-Object System.Collections.Generic.List[string]
  $items = New-Object System.Collections.Generic.List[string]
  $q = $null; $qn = 0; $words = 0
  $faq = $null; $faqAll = New-Object System.Collections.Generic.List[object]
  $flushP = { if($para.Count){ [void]$html.AppendLine('<p>' + (Inline ($para -join ' ')) + '</p>'); $para.Clear() } }
  $flushL = { if($items.Count){ [void]$html.AppendLine('<ul>'); foreach($i in $items){ [void]$html.AppendLine('<li>' + (Inline $i) + '</li>') }; [void]$html.AppendLine('</ul>'); $items.Clear() } }
  foreach($line in ($body -split "`n")){
    if($null -ne $q){
      if($line -eq '@fin'){ [void]$html.AppendLine((Render-Q (Reorder-Q $q $num $qn) $qn)); $q = $null; continue }
      if($line -match '^(Q|A|B|C|D|OK|EXP):\s*(.*)$'){ $q[$Matches[1]] = $Matches[2].Trim() }
      continue
    }
    if($null -ne $faq){
      if($line -eq '@fin'){
        [void]$html.AppendLine('<div class="faq-list">')
        foreach($f in $faq){ [void]$html.AppendLine('<details class="faq-item"><summary>' + (Inline $f.P) + '</summary><p>' + (Inline $f.R) + '</p></details>'); $faqAll.Add($f) }
        [void]$html.AppendLine('</div>'); $faq = $null; continue
      }
      if($line -match '^P:\s*(.*)$'){ $faq.Add(@{ P = $Matches[1].Trim(); R = '' }); continue }
      if($line -match '^R:\s*(.*)$' -and $faq.Count){ $faq[$faq.Count - 1].R = $Matches[1].Trim(); continue }
      continue
    }
    if($line -eq '@faq'){ & $flushP; & $flushL; $faq = New-Object System.Collections.Generic.List[object]; continue }
    if($line -eq '@pregunta'){ & $flushP; & $flushL; $q = @{}; $qn++; continue }
    if($line -match '^## (.+)$'){ & $flushP; & $flushL; [void]$html.AppendLine('<h2 id="' + (Slug $Matches[1]) + '">' + (Inline $Matches[1]) + '</h2>'); continue }
    if($line -match '^### (.+)$'){ & $flushP; & $flushL; [void]$html.AppendLine('<h3>' + (Inline $Matches[1]) + '</h3>'); continue }
    if($line -match '^- (.+)$'){ & $flushP; $items.Add($Matches[1]); $words += ($Matches[1] -split '\s+').Count; continue }
    if($line.Trim() -eq ''){ & $flushP; & $flushL; continue }
    & $flushL; $para.Add($line.Trim()); $words += ($line -split '\s+').Count
  }
  & $flushP; & $flushL
  return @{ meta = $meta; html = $html.ToString(); words = $words; faq = $faqAll }
}

function Json-Script($obj){
  $j = ConvertTo-Json -InputObject $obj -Depth 8 -Compress
  return '<script type="application/ld+json">' + $j + '</script>'
}
function Crumb-List($crumbs){
  $list = @(); $i = 1
  foreach($c in $crumbs){ $list += [ordered]@{ '@type' = 'ListItem'; position = $i; name = $c.name; item = $c.url }; $i++ }
  return [ordered]@{ '@context' = 'https://schema.org'; '@type' = 'BreadcrumbList'; itemListElement = $list }
}
function Crumb-Html($crumbs){
  $parts = @(); $n = $crumbs.Count
  for($i = 0; $i -lt $n; $i++){
    if($i -eq $n - 1){ $parts += '<span aria-current="page">' + (Esc $crumbs[$i].name) + '</span>' }
    else { $parts += '<a href="' + $crumbs[$i].url.Replace($Base, '') + '">' + (Esc $crumbs[$i].name) + '</a>' }
  }
  return ($parts -join ' <span aria-hidden="true">&rsaquo;</span> ')
}

$footer = RU (Join-Path $Site 'tools\templates\footer.html')
$tpl = (RU (Join-Path $Site 'tools\templates\page.html')).Replace('{{FOOTER}}', $footer.Trim())
$idx = @()
foreach($l in ((RU (Join-Path $Site 'content\reglas\_indice.txt')) -split "`n")){
  $l = $l.Trim(); if(-not $l){ continue }
  $p = $l -split '\|'
  $idx += [pscustomobject]@{ num = [int]$p[0]; slug = $p[1]; nombre = $p[2]; resumen = $p[3] }
}
$pub = @{}
foreach($f in (Get-ChildItem (Join-Path $Site 'content\reglas') -Filter '*.md' | Where-Object { $_.Name -notlike '_*' })){
  $m = Parse-Md (RU $f.FullName)
  $pub[[int]$m.meta['num']] = @{ meta = $m.meta; html = $m.html; words = $m.words; rel = 'content/reglas/' + $f.Name }
}

$cssTag = '/assets/css/landing.css?v=0'
$outRel = @()   # paginas generadas (ruta relativa) para el CSS y el sitemap
$sitemap = New-Object System.Collections.Generic.List[object]
$sitemap.Add(@{ loc = $Base + '/'; lastmod = (GitDate 'index.html') })
$sitemap.Add(@{ loc = $Base + '/contacto.html'; lastmod = (GitDate 'contacto.html') })

function Cta-Html([string]$titulo, [string]$texto){
  return '<section class="pg-cta"><h2>' + (Esc $titulo) + '</h2><p>' + (Esc $texto) + '</p><div class="pg-cta-btns"><a class="btn btn-yellow" href="/#registro">Crear cuenta gratis</a><a class="btn btn-secondary" href="/#quiz">Probar un test de 5 preguntas</a></div></section>'
}

# --- una pagina por regla escrita ---
foreach($r in ($idx | Where-Object { $pub.ContainsKey($_.num) })){
  $pg = $pub[$r.num]; $meta = $pg.meta
  $url = $Base + '/reglas-de-juego/' + $meta['slug'] + '/'
  $h1 = 'Regla ' + $r.num + ': ' + $r.nombre
  $crumbs = @(@{ name = 'Inicio'; url = $Base + '/' }, @{ name = 'Reglas de Juego'; url = $Base + '/reglas-de-juego/' }, @{ name = 'Regla ' + $r.num; url = $url })
  $article = [ordered]@{
    '@context' = 'https://schema.org'; '@type' = 'Article'; headline = $h1; description = $meta['description']; inLanguage = 'es'
    datePublished = $meta['fecha']; dateModified = $meta['fecha']; mainEntityOfPage = $url; image = $Base + '/assets/og-image.png'
    author = [ordered]@{ '@type' = 'Organization'; name = 'WEREF'; url = $Base + '/' }
    publisher = [ordered]@{ '@type' = 'Organization'; name = 'WEREF'; logo = [ordered]@{ '@type' = 'ImageObject'; url = $Base + '/assets/icon-512.png' } }
  }
  $prev = $idx | Where-Object { $_.num -eq $r.num - 1 -and $pub.ContainsKey($_.num) } | Select-Object -First 1
  $next = $idx | Where-Object { $_.num -eq $r.num + 1 -and $pub.ContainsKey($_.num) } | Select-Object -First 1
  $pager = '<nav class="pg-pager" aria-label="Navegaci&oacute;n entre reglas">'
  if($prev){ $pager += '<a class="pg-prev" href="/reglas-de-juego/' + $prev.slug + '/">&larr; Regla ' + $prev.num + ': ' + (Esc $prev.nombre) + '</a>' } else { $pager += '<span></span>' }
  $pager += '<a class="pg-hub" href="/reglas-de-juego/">Todas las reglas</a>'
  if($next){ $pager += '<a class="pg-next" href="/reglas-de-juego/' + $next.slug + '/">Regla ' + $next.num + ': ' + (Esc $next.nombre) + ' &rarr;</a>' } else { $pager += '<span></span>' }
  $pager += '</nav>'
  $html = Fill $tpl @{
    TITLE = (Esc $meta['title']); DESCRIPTION = (EscA $meta['description']); ROBOTS = 'index, follow'; CANONICAL = $url
    JSONLD = ((Json-Script (Crumb-List $crumbs)) + "`n" + (Json-Script $article))
    BREADCRUMBS = (Crumb-Html $crumbs); KICKER = ('Reglas de Juego &middot; Regla ' + $r.num + ' de ' + $TotalReglas); H1 = (Esc $h1)
    CONTENT = $pg.html; CTA = (Cta-Html ('Practica la Regla ' + $r.num + ' en la app') ('Haz el test completo de la Regla ' + $r.num + ' en WEREF: gratis, sin tarjeta y con tu progreso guardado.')); PAGER = $pager
  }
  $rel = 'reglas-de-juego\' + $meta['slug'] + '\index.html'
  WU (Join-Path $Site $rel) $html
  $outRel += $rel
  $sitemap.Add(@{ loc = $url; lastmod = $meta['fecha'] })
  Write-Host ("Regla {0}: {1} palabras (sin preguntas) -> {2}" -f $r.num, $pg.words, $rel)
}

# --- indice /reglas-de-juego/ ---
$hub = Parse-Md (RU (Join-Path $Site 'content\reglas\_hub.md'))
$hubUrl = $Base + '/reglas-de-juego/'
$list = '<ol class="pg-rules">'
foreach($r in $idx){
  if($pub.ContainsKey($r.num)){
    $list += '<li><a href="/reglas-de-juego/' + $r.slug + '/"><span class="pg-rule-n">' + $r.num + '</span><span class="pg-rule-b"><strong>' + (Esc $r.nombre) + '</strong><small>' + (Esc $r.resumen) + '</small></span></a></li>'
  } else {
    $list += '<li class="pg-soon"><span class="pg-rule-n">' + $r.num + '</span><span class="pg-rule-b"><strong>' + (Esc $r.nombre) + '</strong><small>' + (Esc $r.resumen) + ' &middot; Pr&oacute;ximamente</small></span></li>'
  }
}
$list += '</ol>'
$complete = ($pub.Count -ge $TotalReglas)
$hubCrumbs = @(@{ name = 'Inicio'; url = $Base + '/' }, @{ name = 'Reglas de Juego'; url = $hubUrl })
$hubHtml = Fill $tpl @{
  TITLE = (Esc $hub.meta['title']); DESCRIPTION = (EscA $hub.meta['description']); CANONICAL = $hubUrl
  ROBOTS = $(if($complete){ 'index, follow' } else { 'noindex, follow' })
  JSONLD = (Json-Script (Crumb-List $hubCrumbs)); BREADCRUMBS = (Crumb-Html $hubCrumbs); KICKER = 'Gu&iacute;a para &aacute;rbitros'
  H1 = 'Las 17 Reglas de Juego del f&uacute;tbol, explicadas para &aacute;rbitros'
  CONTENT = ($hub.html + "`n" + $list); CTA = (Cta-Html 'Practica las 17 reglas en la app' 'Entrena con el test de cada regla en WEREF: gratis, sin tarjeta y con tu progreso guardado.'); PAGER = ''
}
WU (Join-Path $Site 'reglas-de-juego\index.html') $hubHtml
$outRel += 'reglas-de-juego\index.html'
if($complete){ $sitemap.Add(@{ loc = $hubUrl; lastmod = $hub.meta['fecha'] }) }
Write-Host ("Indice: {0} de {1} reglas publicadas ({2})" -f $pub.Count, $TotalReglas, $(if($complete){ 'indexable' } else { 'noindex hasta completarlas' }))

# --- paginas pilar (content\paginas\*.md) ---
$pillars = @()
$pillarDir = Join-Path $Site 'content\paginas'
if(Test-Path $pillarDir){
  foreach($f in (Get-ChildItem $pillarDir -Filter '*.md' | Sort-Object Name)){
    $m = Parse-Md (RU $f.FullName); $meta = $m.meta
    $slug = $meta['slug']; $url = $Base + '/' + $slug + '/'
    $crumbs = @(@{ name = 'Inicio'; url = $Base + '/' }, @{ name = $meta['crumb']; url = $url })
    $article = [ordered]@{
      '@context' = 'https://schema.org'; '@type' = 'Article'; headline = $meta['h1']; description = $meta['description']; inLanguage = 'es'
      datePublished = $meta['fecha']; dateModified = $meta['fecha']; mainEntityOfPage = $url; image = $Base + '/assets/og-image.png'
      author = [ordered]@{ '@type' = 'Organization'; name = 'WEREF'; url = $Base + '/' }
      publisher = [ordered]@{ '@type' = 'Organization'; name = 'WEREF'; logo = [ordered]@{ '@type' = 'ImageObject'; url = $Base + '/assets/icon-512.png' } }
    }
    $ld = (Json-Script (Crumb-List $crumbs)) + "`n" + (Json-Script $article)
    if($m.faq.Count){
      $ents = @()
      foreach($q in $m.faq){ $ents += [ordered]@{ '@type' = 'Question'; name = ($q.P -replace '\*\*', ''); acceptedAnswer = [ordered]@{ '@type' = 'Answer'; text = ($q.R -replace '\*\*', '') } } }
      $ld += "`n" + (Json-Script ([ordered]@{ '@context' = 'https://schema.org'; '@type' = 'FAQPage'; mainEntity = $ents }))
    }
    $html = Fill $tpl @{
      TITLE = (Esc $meta['title']); DESCRIPTION = (EscA $meta['description']); ROBOTS = 'index, follow'; CANONICAL = $url
      JSONLD = $ld; BREADCRUMBS = (Crumb-Html $crumbs); KICKER = (Esc $meta['kicker']); H1 = (Esc $meta['h1'])
      CONTENT = $m.html; CTA = (Cta-Html $meta['cta_title'] $meta['cta_text']); PAGER = ''
    }
    $rel = $slug + '\index.html'
    WU (Join-Path $Site $rel) $html
    $outRel += $rel
    $sitemap.Add(@{ loc = $url; lastmod = $meta['fecha'] })
    $mins = [math]::Max(2, [math]::Ceiling($m.words / 170))
    $pillars += [pscustomobject]@{ slug = $slug; nombre = $meta['crumb']; resumen = $meta['resumen']; cat = $meta['categoria']; mins = $mins; orden = $f.Name }
    Write-Host ("Pilar: {0} palabras -> {1}" -f $m.words, $rel)
  }
}

# --- pagina 404 ---
$nfList = '<li><a href="/">Inicio de WEREF</a></li><li><a href="/reglas-de-juego/">Las 17 Reglas de Juego explicadas</a></li>'
foreach($p in $pillars){ $nfList += '<li><a href="/' + $p.slug + '/">' + (Esc $p.nombre) + '</a></li>' }
$nfList += '<li><a href="/contacto.html">Contacto</a></li>'
$nf = Fill $tpl @{
  TITLE = 'P&aacute;gina no encontrada | WEREF'; DESCRIPTION = 'La p&aacute;gina que buscas no existe o ha cambiado de direcci&oacute;n.'; ROBOTS = 'noindex, follow'; CANONICAL = ($Base + '/')
  JSONLD = ''; BREADCRUMBS = '<a href="/">Inicio</a>'; KICKER = 'Error 404'; H1 = 'No encontramos esa p&aacute;gina'
  CONTENT = ('<p>La direcci&oacute;n que buscas no existe o ha cambiado. Estas p&aacute;ginas te pueden ayudar:</p><ul>' + $nfList + '</ul>'); CTA = ''; PAGER = ''
}
WU (Join-Path $Site '404.html') $nf
$outRel += '404.html'

# lista de paginas generadas (la usa build-landing-css.ps1 para estampar la version del CSS)
WU (Join-Path $Site 'tools\generated-pages.txt') (($outRel | ForEach-Object { $_.Replace('/', '\') }) -join "`n")

# --- bloque "Las 17 reglas" de la portada (entre los marcadores REGLAS:START y REGLAS:END de index.html) ---
$lt = RU (Join-Path $Site 'tools\templates\reglas-landing.html')
$items = ''
foreach($r in $idx){
  if($pub.ContainsKey($r.num)){ $items += '<li><a href="/reglas-de-juego/' + $r.slug + '/"><span class="j-n">' + ('{0:00}' -f $r.num) + '</span><span class="j-t">' + (Esc $r.nombre) + '</span></a></li>' }
}
$mStart = '<!-- REGLAS:START -->'; $mEnd = '<!-- REGLAS:END -->'
$block = $mStart + "`n" + $lt.Replace('{{ITEMS}}', $items).Trim() + "`n" + $mEnd
$ixPath = Join-Path $Site 'index.html'
$ix = RU $ixPath
$s = $ix.IndexOf($mStart); $e = $ix.IndexOf($mEnd)
if($s -ge 0 -and $e -gt $s -and $pub.Count -ge 1){
  $new = $ix.Substring(0, $s) + $block + $ix.Substring($e + $mEnd.Length)
  if($new -ne $ix){ WU $ixPath $new }
}

# --- bloque "Guias para arbitros" de la portada (marcadores PILARES:START / PILARES:END) ---
if($pillars.Count){
  $gt = RU (Join-Path $Site 'tools\templates\pilares-landing.html')
  $gi = ''
  $arrow = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>'
  foreach($p in $pillars){ $gi += '<li><a href="/' + $p.slug + '/"><span class="g-cat">' + (Esc $p.cat) + '</span><strong class="g-t">' + (Esc $p.nombre) + '</strong><span class="g-d">' + (Esc $p.resumen) + '</span><span class="g-m">' + $p.mins + ' min ' + $arrow + '</span></a></li>' }
  $gStart = '<!-- PILARES:START -->'; $gEnd = '<!-- PILARES:END -->'
  $gBlock = $gStart + "`n" + $gt.Replace('{{ITEMS}}', $gi).Trim() + "`n" + $gEnd
  $ix2 = RU $ixPath
  $s2 = $ix2.IndexOf($gStart); $e2 = $ix2.IndexOf($gEnd)
  if($s2 -ge 0 -and $e2 -gt $s2){
    $new2 = $ix2.Substring(0, $s2) + $gBlock + $ix2.Substring($e2 + $gEnd.Length)
    if($new2 -ne $ix2){ WU $ixPath $new2 }
  }
}

# --- pie de pagina de la portada (marcadores FOOTER:START / FOOTER:END) ---
$fStart = '<!-- FOOTER:START -->'; $fEnd = '<!-- FOOTER:END -->'
$ix3 = RU $ixPath
$s3 = $ix3.IndexOf($fStart); $e3 = $ix3.IndexOf($fEnd)
if($s3 -ge 0 -and $e3 -gt $s3){
  $new3 = $ix3.Substring(0, $s3) + $fStart + "`n" + $footer.Trim() + "`n" + $fEnd + $ix3.Substring($e3 + $fEnd.Length)
  if($new3 -ne $ix3){ WU $ixPath $new3 }
}

# --- sitemap.xml ---
$sm = '<?xml version="1.0" encoding="UTF-8"?>' + "`n" + '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' + "`n"
foreach($e in $sitemap){ $sm += '  <url>' + "`n" + '    <loc>' + $e.loc + '</loc>' + "`n" + '    <lastmod>' + $e.lastmod + '</lastmod>' + "`n" + '  </url>' + "`n" }
$sm += '</urlset>' + "`n"
WU (Join-Path $Site 'sitemap.xml') $sm
Write-Host ("sitemap.xml: {0} URL" -f $sitemap.Count)

# --- CSS ligero para la portada y estas paginas (y su version en cada pagina) ---
& (Join-Path $Site 'tools\build-landing-css.ps1') -Site $Site
