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
  # marcadores [VERIFICAR: ...]: no se ven en la pagina, quedan como comentario HTML y en la lista del generador
  $t = [regex]::Replace($t, '\[VERIFICAR:([^\]]*)\]', { param($m) $script:verifList.Add($m.Groups[1].Value.Trim()); '<!-- VERIFICAR:' + $m.Groups[1].Value.Replace('--', '-') + ' -->' })
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

$script:verifList = New-Object System.Collections.Generic.List[string]

function Render-Q2($q, [int]$n){
  $opts = ''
  foreach($l in 'A', 'B', 'C', 'D'){ $opts += '<li>' + (Inline $q[$l]) + '</li>' }
  return '<section class="pg-q qi" data-ok="' + $q['OK'] + '"><p class="pg-q-n">Pregunta ' + $n + '</p><p class="pg-q-t">' + (Inline $q['Q']) + '</p><ol class="pg-q-o" type="A">' + $opts + '</ol><details class="pg-q-a"><summary>Ver la respuesta</summary><p><strong>Respuesta correcta: ' + $q['OK'] + '.</strong> ' + (Inline $q['EXP']) + '</p></details></section>'
}

function Render-QI($q, [int]$num, [string]$slug){
  $opts = ''
  foreach($l in 'A', 'B', 'C', 'D'){ $opts += '<li>' + (Inline $q[$l]) + '</li>' }
  return '<section class="pg-q qi" data-ok="' + $q['OK'] + '"><p class="pg-q-n">Pregunta de examen &middot; Regla ' + $num + '</p><p class="pg-q-t">' + (Inline $q['Q']) + '</p><ol class="pg-q-o" type="A">' + $opts + '</ol><details class="pg-q-a"><summary>Ver la respuesta</summary><p><strong>Respuesta correcta: ' + $q['OK'] + '.</strong> ' + (Inline $q['EXP']) + '</p></details><p class="qi-src">Del banco de WEREF &middot; <a href="/reglas-de-juego/' + $slug + '/">Gu&iacute;a de la Regla ' + $num + '</a></p></section>'
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
  $olItems = New-Object System.Collections.Generic.List[string]
  $q = $null; $qn = 0; $words = 0
  $qAll = New-Object System.Collections.Generic.List[object]
  $faq = $null; $faqAll = New-Object System.Collections.Generic.List[object]
  $toc = New-Object System.Collections.Generic.List[object]
  $sum = New-Object System.Collections.Generic.List[string]; $inSum = $false
  $tab = $null; $steps = $null; $caso = $null; $cifras = $null; $v2 = ($meta['plantilla'] -eq 'v2')
  $flushP = { if($para.Count){ [void]$html.AppendLine('<p>' + (Inline ($para -join ' ')) + '</p>'); $para.Clear() } }
  $flushL = { if($items.Count){ [void]$html.AppendLine('<ul>'); foreach($i in $items){ [void]$html.AppendLine('<li>' + (Inline $i) + '</li>') }; [void]$html.AppendLine('</ul>'); $items.Clear() } }
  $flushO = { if($olItems.Count){ [void]$html.AppendLine('<ol>'); foreach($i in $olItems){ [void]$html.AppendLine('<li>' + (Inline $i) + '</li>') }; [void]$html.AppendLine('</ol>'); $olItems.Clear() } }
  foreach($line in ($body -split "`n")){
    if($null -ne $q){
      if($line -eq '@fin'){ $ro = Reorder-Q $q $num $qn; $qAll.Add($ro); if($v2){ [void]$html.AppendLine((Render-Q2 $ro $qn)) } else { [void]$html.AppendLine((Render-Q $ro $qn)) }; $q = $null; continue }
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
    if($inSum){
      if($line -eq '@fin'){ $inSum = $false; continue }
      if($line -match '^- (.+)$'){ $sum.Add($Matches[1]) }
      continue
    }
    if($null -ne $caso){
      if($line -eq '@fin'){
        [void]$html.AppendLine('<aside class="cx-caso"><p class="cx-t">Caso pr&aacute;ctico</p><ol><li><b>Situaci&oacute;n</b><span>' + (Inline $caso['SIT']) + '</span></li><li><b>Decisi&oacute;n</b><span>' + (Inline $caso['DEC']) + '</span></li><li><b>Por qu&eacute;</b><span>' + (Inline $caso['POR']) + '</span></li></ol></aside>')
        $words += 60; $caso = $null; continue
      }
      if($line -match '^(SIT|DEC|POR):\s*(.*)$'){ $caso[$Matches[1]] = $Matches[2].Trim() }
      continue
    }
    if($null -ne $tab){
      if($line -eq '@fin'){
        $t = '<figure class="cx-table"><figcaption>' + (Inline $tab.title) + '</figcaption><div class="cx-scroll"><table>'
        for($ri = 0; $ri -lt $tab.rows.Count; $ri++){
          $cells = $tab.rows[$ri] -split '\s*\|\s*'
          if($ri -eq 0){ $t += '<thead><tr>'; foreach($c in $cells){ $t += '<th scope="col">' + (Inline $c) + '</th>' }; $t += '</tr></thead><tbody>' }
          else { $t += '<tr>'; $ci = 0; foreach($c in $cells){ if($ci -eq 0){ $t += '<th scope="row">' + (Inline $c) + '</th>' } else { $t += '<td>' + (Inline $c) + '</td>' }; $ci++ }; $t += '</tr>' }
        }
        $t += '</tbody></table></div></figure>'
        if(-not $cifras){ $cifras = @($tab.rows) }; [void]$html.AppendLine($t); $tab = $null; continue
      }
      if($line.Trim() -ne ''){ $tab.rows.Add($line.Trim()); $words += ($line -split '\s+').Count }
      continue
    }
    if($null -ne $steps){
      if($line -eq '@fin'){
        [void]$html.AppendLine('<ol class="cx-steps">')
        foreach($s in $steps){
          if($s -match '^\*\*(.+?)\*\*\s*(.*)$'){ [void]$html.AppendLine('<li><b class="cx-st">' + (Inline $Matches[1]) + '</b><span>' + (Inline $Matches[2]) + '</span></li>') }
          else { [void]$html.AppendLine('<li><span>' + (Inline $s) + '</span></li>') }
        }
        [void]$html.AppendLine('</ol>'); $steps = $null; continue
      }
      if($line -match '^\d+\.\s+(.+)$'){ $steps.Add($Matches[1]); $words += ($Matches[1] -split '\s+').Count }
      continue
    }
    if($line -eq '@faq'){ & $flushP; & $flushL; & $flushO; $faq = New-Object System.Collections.Generic.List[object]; continue }
    if($line -eq '@pregunta'){ & $flushP; & $flushL; & $flushO; $q = @{}; $qn++; continue }
    if($line -eq '@resumen'){ & $flushP; & $flushL; & $flushO; $inSum = $true; continue }
    if($line -match '^@cifras\s+(.+)$'){ & $flushP; & $flushL; & $flushO; $tab = @{ title = $Matches[1].Trim(); rows = (New-Object System.Collections.Generic.List[string]) }; continue }
    if($line -eq '@caso'){ & $flushP; & $flushL; & $flushO; $caso = @{}; continue }
    if($line -eq '@pasos'){ & $flushP; & $flushL; & $flushO; $steps = New-Object System.Collections.Generic.List[string]; continue }
    if($line -match '^@consejo\s+(.+)$'){ & $flushP; & $flushL; & $flushO; [void]$html.AppendLine('<aside class="cx cx-tip"><p class="cx-t">Consejo de &aacute;rbitro</p><p>' + (Inline $Matches[1]) + '</p></aside>'); $words += ($Matches[1] -split '\s+').Count; continue }
    if($line -match '^@error\s+(.+)$'){ & $flushP; & $flushL; & $flushO; [void]$html.AppendLine('<aside class="cx cx-err"><p class="cx-t">Error t&iacute;pico</p><p>' + (Inline $Matches[1]) + '</p></aside>'); $words += ($Matches[1] -split '\s+').Count; continue }
    if($line -match '^@test\s+(\d+)\s+(\d+)\s*$'){
      & $flushP; & $flushL; & $flushO
      $rn = [int]$Matches[1]; $rk = [int]$Matches[2]
      if(-not $pub.ContainsKey($rn) -or $rk -lt 1 -or $rk -gt $pub[$rn].qs.Count){ throw ('@test: no existe la pregunta ' + $rn + ':' + $rk) }
      $slugR = ($idx | Where-Object { $_.num -eq $rn } | Select-Object -First 1).slug
      [void]$html.AppendLine((Render-QI $pub[$rn].qs[$rk - 1] $rn $slugR)); $words += 60; continue
    }
    if($line -match '^@figura\s+(\S+)\s*$'){ & $flushP; & $flushL; & $flushO; [void]$html.AppendLine((RU (Join-Path $Site ('tools\templates\fig-' + $Matches[1] + '.html'))).Trim()); continue }
    if($line -match '^## (.+)$'){
      & $flushP; & $flushL; & $flushO
      $hid = Slug $Matches[1]
      [void]$html.AppendLine('<h2 id="' + $hid + '">' + (Inline $Matches[1]) + '</h2>')
      $toc.Add(@{ id = $hid; t = ($Matches[1] -replace '\*\*', '') }); continue
    }
    if($line -match '^### (.+)$'){ & $flushP; & $flushL; & $flushO; [void]$html.AppendLine('<h3>' + (Inline $Matches[1]) + '</h3>'); continue }
    if($line -match '^\s*- (.+)$'){ & $flushP; & $flushO; $items.Add($Matches[1]); $words += ($Matches[1] -split '\s+').Count; continue }
    if($line -match '^\d+\.\s+(.+)$'){ & $flushP; & $flushL; $olItems.Add($Matches[1]); $words += ($Matches[1] -split '\s+').Count; continue }
    if($line.Trim() -eq ''){ & $flushP; & $flushL; & $flushO; continue }
    & $flushL; & $flushO; $para.Add($line.Trim()); $words += ($line -split '\s+').Count
  }
  & $flushP; & $flushL; & $flushO
  $sumHtml = ''
  if($sum.Count){ $sumHtml = '<ul>'; foreach($s in $sum){ $sumHtml += '<li>' + (Inline $s) + '</li>' }; $sumHtml += '</ul>' }
  return @{ meta = $meta; html = $html.ToString(); words = $words; faq = $faqAll; qs = $qAll; toc = $toc; summary = $sumHtml; cifras = $cifras; v2 = $v2 }
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
$nav = RU (Join-Path $Site 'tools\templates\nav.html')
$tpl = (RU (Join-Path $Site 'tools\templates\page.html')).Replace('{{NAV}}', $nav.Replace('{{PROGRESS}}', '')).Replace('{{FOOTER}}', $footer.Trim())
$idx = @()
foreach($l in ((RU (Join-Path $Site 'content\reglas\_indice.txt')) -split "`n")){
  $l = $l.Trim(); if(-not $l){ continue }
  $p = $l -split '\|'
  $idx += [pscustomobject]@{ num = [int]$p[0]; slug = $p[1]; nombre = $p[2]; resumen = $p[3] }
}
$pub = @{}
foreach($f in (Get-ChildItem (Join-Path $Site 'content\reglas') -Filter '*.md' | Where-Object { $_.Name -notlike '_*' })){
  $m = Parse-Md (RU $f.FullName)
  $pub[[int]$m.meta['num']] = @{ meta = $m.meta; html = $m.html; words = $m.words; qs = $m.qs; m = $m; rel = 'content/reglas/' + $f.Name }
}

$cssTag = '/assets/css/landing.css?v=0'
$outRel = @()   # paginas generadas (ruta relativa) para el CSS y el sitemap
$sitemap = New-Object System.Collections.Generic.List[object]
$sitemap.Add(@{ loc = $Base + '/'; lastmod = (GitDate 'index.html') })
$sitemap.Add(@{ loc = $Base + '/contacto.html'; lastmod = (GitDate 'contacto.html') })

function Cta-Html([string]$titulo, [string]$texto){
  return '<section class="pg-cta"><h2>' + (Esc $titulo) + '</h2><p>' + (Esc $texto) + '</p><div class="pg-cta-btns"><a class="btn btn-yellow" href="/#registro">Crear cuenta gratis</a><a class="btn btn-secondary" href="/#quiz">Probar un test de 5 preguntas</a></div></section>'
}

$Months = 'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'
function Fecha-Es([string]$iso, [bool]$short){
  $d = [datetime]::ParseExact($iso, 'yyyy-MM-dd', [Globalization.CultureInfo]::InvariantCulture)
  if($short){ return ('{0} {1} {2}' -f $d.Day, $Months[$d.Month - 1].Substring(0, 3), $d.Year) }
  return ('{0} de {1} de {2}' -f $d.Day, $Months[$d.Month - 1], $d.Year)
}
$GrupoNombre = [ordered]@{ empezar = 'Empezar como &aacute;rbitro'; examen = 'Examen'; reglas = 'Reglas'; partido = 'Partido'; novedades = 'Novedades' }
$QCount = @{}
foreach($l in ((RU (Join-Path $Site 'content\reglas\_preguntas.txt')) -split "`n")){ $l = $l.Trim(); if($l){ $pp = $l -split '\|'; $QCount[[int]$pp[0]] = [int]$pp[1] } }
$reglaTpl = (RU (Join-Path $Site 'tools\templates\regla.html')).Replace('{{NAV}}', $nav.Replace('{{PROGRESS}}', '<div class="rp" aria-hidden="true"><i></i></div>')).Replace('{{FOOTER}}', $footer.Trim())
# --- una pagina por regla escrita ---
foreach($r in ($idx | Where-Object { $pub.ContainsKey($_.num) })){
  $pg = $pub[$r.num]; $meta = $pg.meta
  $url = $Base + '/reglas-de-juego/' + $meta['slug'] + '/'
  $h1 = 'Regla ' + $r.num + ': ' + $r.nombre
  $crumbs = @(@{ name = 'Inicio'; url = $Base + '/' }, @{ name = 'Reglas de Juego'; url = $Base + '/reglas-de-juego/' }, @{ name = 'Regla ' + $r.num; url = $url })
  $article = [ordered]@{
    '@context' = 'https://schema.org'; '@type' = 'Article'; headline = $h1; description = $meta['description']; inLanguage = 'es'
    datePublished = $(if($meta['publicada']){ $meta['publicada'] } else { $meta['fecha'] }); dateModified = $meta['fecha']; mainEntityOfPage = $url; image = $Base + '/assets/og-image.png'
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
  if($pg.m.v2){
    $qc = [int]$QCount[[int]$r.num]
    $qtxt = [string]([math]::Floor($qc / 10) * 10) + '+'; if($qc -lt 10){ $qtxt = [string]$qc }
    $mins = [int][math]::Ceiling(($pg.words + 250) / 190)
    $chips = '<li>Reglas 2026/27</li><li>' + $mins + ' min de lectura</li><li>' + $qtxt + ' preguntas en la app</li><li>Actualizado: ' + (Fecha-Es $meta['fecha'] $false) + '</li><li class="rg-by">Por Equipo WEREF</li>'
    $toc = ''; foreach($t in $pg.m.toc){ $toc += '<li><a href="#' + $t.id + '">' + (Esc $t.t) + '</a></li>' }
    $pick = ''
    foreach($o in $idx){ $cur = ''; if($o.num -eq $r.num){ $cur = ' class="is-cur" aria-current="page"' }; $pick += '<li><a href="/reglas-de-juego/' + $o.slug + '/"' + $cur + ' aria-label="Regla ' + $o.num + ': ' + (EscA $o.nombre) + '">' + $o.num + '</a></li>' }
    $relh = ''
    foreach($rn in ($meta['relacionadas'] -split '\s*,\s*')){
      $o = $idx | Where-Object { $_.num -eq [int]$rn } | Select-Object -First 1
      if($o){ $relh += '<li><a href="/reglas-de-juego/' + $o.slug + '/"><span class="rg-rel-n">' + $o.num + '</span><span class="rg-rel-b"><strong>' + (Esc $o.nombre) + '</strong><span class="gd-rel-m">' + (Esc $o.resumen) + '</span></span></a></li>' }
    }
    $mini = ''
    if($pg.m.cifras){
      $mini = '<table class="rg-mt"><tbody>'
      for($ci = 1; $ci -lt $pg.m.cifras.Count; $ci++){ $cells = $pg.m.cifras[$ci] -split '\s*\|\s*'; $mini += '<tr><th scope="row">' + (Inline $cells[0]) + '</th><td>' + (Inline $cells[1]) + '</td></tr>' }
      $mini += '</tbody></table>'
    }
    $pg2 = '<nav class="rg-pager" aria-label="Navegaci&oacute;n entre reglas">'
    if($prev){ $pg2 += '<a class="rg-pc rg-prev" href="/reglas-de-juego/' + $prev.slug + '/"><span class="rg-pc-n">' + $prev.num + '</span><span class="rg-pc-b"><span class="rg-pc-k">&larr; Regla anterior</span><strong>' + (Esc $prev.nombre) + '</strong></span></a>' } else { $pg2 += '<span></span>' }
    if($next){ $pg2 += '<a class="rg-pc rg-next" href="/reglas-de-juego/' + $next.slug + '/"><span class="rg-pc-b"><span class="rg-pc-k">Regla siguiente &rarr;</span><strong>' + (Esc $next.nombre) + '</strong></span><span class="rg-pc-n">' + $next.num + '</span></a>' } else { $pg2 += '<span></span>' }
    $pg2 += '<a class="pg-hub rg-all" href="/reglas-de-juego/">Todas las reglas</a></nav>'
    $parts = @(); $letters = 'A', 'B', 'C', 'D'
    foreach($qq in $pg.qs){
      $okI = [array]::IndexOf($letters, $qq['OK']); $sug = @(); $pos = 1
      for($k = 0; $k -lt 4; $k++){ if($k -ne $okI){ $sug += [ordered]@{ '@type' = 'Answer'; text = ($qq[$letters[$k]] -replace '\*\*', ''); position = $pos }; $pos++ } }
      $parts += [ordered]@{ '@type' = 'Question'; name = ($qq['Q'] -replace '\*\*', ''); text = ($qq['Q'] -replace '\*\*', ''); suggestedAnswer = $sug; acceptedAnswer = [ordered]@{ '@type' = 'Answer'; text = ($qq[$qq['OK']] -replace '\*\*', ''); answerExplanation = [ordered]@{ '@type' = 'Comment'; text = ($qq['EXP'] -replace '\*\*', '') } } }
    }
    $quiz = [ordered]@{ '@context' = 'https://schema.org'; '@type' = 'Quiz'; name = ('Preguntas de practica de la Regla ' + $r.num + ': ' + $r.nombre); about = [ordered]@{ '@type' = 'Thing'; name = $h1 }; inLanguage = 'es'; hasPart = $parts }
    $html = Fill $reglaTpl @{
      TITLE = (Esc $meta['title']); DESCRIPTION = (EscA $meta['description']); ROBOTS = 'index, follow'; CANONICAL = $url
      JSONLD = ((Json-Script (Crumb-List $crumbs)) + "`n" + (Json-Script $article) + "`n" + (Json-Script $quiz))
      BREADCRUMBS = (Crumb-Html $crumbs); NUM = $r.num; H1 = (Esc $h1); ENTRADILLA = (Inline $meta['entradilla']); CHIPS = $chips
      TOC = $toc; PICKER = $pick; RESUMEN = $pg.m.summary; CONTENT = $pg.html; NQ = $qtxt; RELATED = $relh; CIFRAS = $mini; PAGER = $pg2
      CTA = (Cta-Html ('Practica la Regla ' + $r.num + ' en la app') ('Haz el test completo de la Regla ' + $r.num + ' en WEREF: gratis, sin tarjeta y con tu progreso guardado.'))
    }
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
$ArrowSvg0 = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>'
function Hub-Card($r, [bool]$big){
  $pg = $pub[$r.num]; $qc = [int]$QCount[[int]$r.num]
  $qtxt = [string]([math]::Floor($qc / 10) * 10) + '+'; if($qc -lt 10){ $qtxt = [string]$qc }
  $mins = [int][math]::Ceiling(($pg.words + 250) / 190)
  $cls = 'rh-card'; if($big){ $cls = 'rh-card rh-big' }
  return '<li class="' + $cls + '"><a href="/reglas-de-juego/' + $r.slug + '/"><span class="rh-n">' + ('{0:00}' -f $r.num) + '</span><strong class="rh-t">' + (Esc $r.nombre) + '</strong><span class="rh-d">' + (Esc $r.resumen) + '</span><span class="rh-m">' + $mins + ' min &middot; ' + $qtxt + ' preguntas ' + $ArrowSvg0 + '</span></a></li>'
}
$Grupos = @(
  @{ n = 'Campo y material'; d = 'Reglas 1 a 4'; r = @(1, 2, 3, 4) },
  @{ n = 'Equipo arbitral'; d = 'Reglas 5 y 6'; r = @(5, 6) },
  @{ n = 'Desarrollo del partido'; d = 'Reglas 7 a 10'; r = @(7, 8, 9, 10) },
  @{ n = 'Fuera de juego y faltas'; d = 'Reglas 11 y 12'; r = @(11, 12) },
  @{ n = 'Reanudaciones'; d = 'Reglas 13 a 17'; r = @(13, 14, 15, 16, 17) }
)
$groupsHtml = ''
foreach($g in $Grupos){
  $cards = ''
  foreach($n in $g.r){ $r = $idx | Where-Object { $_.num -eq $n } | Select-Object -First 1; if($r -and $pub.ContainsKey($r.num)){ $cards += (Hub-Card $r $false) } }
  $groupsHtml += '<section class="rh-group" id="' + (Slug $g.n) + '"><div class="rh-g-h"><h2>' + $g.n + '</h2><p>' + $g.d + '</p></div><ul class="rh-grid rh-c' + $g.r.Count + '">' + $cards + '</ul></section>'
}
$topHtml = ''
foreach($l in ((RU (Join-Path $Site 'content\reglas\_destacadas.txt')) -split "`n")){
  $l = $l.Trim(); if(-not $l){ continue }
  $r = $idx | Where-Object { $_.num -eq [int]$l } | Select-Object -First 1
  if($r -and $pub.ContainsKey($r.num)){ $topHtml += (Hub-Card $r $true) }
}
$hh = $hub.html; $cut = $hh.IndexOf('<h2')
$ledeHtml = $hh.Substring(0, $cut); $textHtml = $hh.Substring($cut)
$complete = ($pub.Count -ge $TotalReglas)
$hubCrumbs = @(@{ name = 'Inicio'; url = $Base + '/' }, @{ name = 'Reglas de Juego'; url = $hubUrl })
$hubItems = @(); $hp = 1
foreach($r in $idx){ if($pub.ContainsKey($r.num)){ $hubItems += [ordered]@{ '@type' = 'ListItem'; position = $hp; url = ($Base + '/reglas-de-juego/' + $r.slug + '/'); name = ('Regla ' + $r.num + ': ' + $r.nombre) }; $hp++ } }
$hubLd = (Json-Script (Crumb-List $hubCrumbs)) + "`n" + (Json-Script ([ordered]@{ '@context' = 'https://schema.org'; '@type' = 'CollectionPage'; name = 'Las 17 Reglas de Juego del futbol'; url = $hubUrl; inLanguage = 'es'; mainEntity = [ordered]@{ '@type' = 'ItemList'; numberOfItems = $hubItems.Count; itemListElement = $hubItems } }))
$hubTpl = (RU (Join-Path $Site 'tools\templates\reglas-hub.html')).Replace('{{NAV}}', $nav.Replace('{{PROGRESS}}', '')).Replace('{{FOOTER}}', $footer.Trim())
$hubHtml = Fill $hubTpl @{
  TITLE = (Esc $hub.meta['title']); DESCRIPTION = (EscA $hub.meta['description']); CANONICAL = $hubUrl
  ROBOTS = $(if($complete){ 'index, follow' } else { 'noindex, follow' })
  JSONLD = $hubLd; BREADCRUMBS = (Crumb-Html $hubCrumbs)
  H1 = 'Las 17 Reglas de Juego del f&uacute;tbol, explicadas para &aacute;rbitros'
  LEDE = $ledeHtml; TOP = $topHtml; GROUPS = $groupsHtml; TEXT = $textHtml
  CTA = (Cta-Html 'Practica las 17 reglas en la app' 'Entrena con el test de cada regla en WEREF: gratis, sin tarjeta y con tu progreso guardado.')
}
WU (Join-Path $Site 'reglas-de-juego\index.html') $hubHtml
$outRel += 'reglas-de-juego\index.html'
if($complete){ $sitemap.Add(@{ loc = $hubUrl; lastmod = $hub.meta['fecha'] }) }
Write-Host ("Indice: {0} de {1} reglas publicadas ({2})" -f $pub.Count, $TotalReglas, $(if($complete){ 'indexable' } else { 'noindex hasta completarlas' }))

# --- guias (content\paginas\*.md): plantilla de guia con indice, resumen, autor y relacionadas ---
$guiaTpl = (RU (Join-Path $Site 'tools\templates\guia.html')).Replace('{{NAV}}', $nav.Replace('{{PROGRESS}}', '<div class="rp" aria-hidden="true"><i></i></div>')).Replace('{{FOOTER}}', $footer.Trim())

$pillars = @()
$GL = @()
$pillarDir = Join-Path $Site 'content\paginas'
if(Test-Path $pillarDir){
  foreach($f in (Get-ChildItem $pillarDir -Filter '*.md' | Sort-Object Name)){
    $m = Parse-Md (RU $f.FullName)
    $mins = [int][math]::Max(2, [math]::Ceiling($m.words / 185))
    $GL += [pscustomobject]@{ m = $m; meta = $m.meta; slug = $m.meta['slug']; mins = $mins; name = $f.Name }
  }
  foreach($g in $GL){
    $meta = $g.meta; $m = $g.m
    if(-not $m.summary){ throw ('Falta @resumen en ' + $g.slug) }
    $slug = $g.slug; $url = $Base + '/' + $slug + '/'
    $crumbs = @(@{ name = 'Inicio'; url = $Base + '/' }, @{ name = $meta['crumb']; url = $url })
    $article = [ordered]@{
      '@context' = 'https://schema.org'; '@type' = 'Article'; headline = $meta['h1']; description = $meta['description']; inLanguage = 'es'
      datePublished = $(if($meta['publicada']){ $meta['publicada'] } else { $meta['fecha'] }); dateModified = $meta['fecha']; mainEntityOfPage = $url; image = $Base + '/assets/og-image.png'
      author = [ordered]@{ '@type' = 'Organization'; name = 'WEREF'; url = $Base + '/' }
      publisher = [ordered]@{ '@type' = 'Organization'; name = 'WEREF'; logo = [ordered]@{ '@type' = 'ImageObject'; url = $Base + '/assets/icon-512.png' } }
    }
    $ld = (Json-Script (Crumb-List $crumbs)) + "`n" + (Json-Script $article)
    if($m.faq.Count){
      $ents = @()
      foreach($q in $m.faq){ $ents += [ordered]@{ '@type' = 'Question'; name = ($q.P -replace '\*\*', ''); acceptedAnswer = [ordered]@{ '@type' = 'Answer'; text = ($q.R -replace '\*\*', '') } } }
      $ld += "`n" + (Json-Script ([ordered]@{ '@context' = 'https://schema.org'; '@type' = 'FAQPage'; mainEntity = $ents }))
    }
    $toc = ''
    foreach($t in $m.toc){ $toc += '<li><a href="#' + $t.id + '">' + (Esc $t.t) + '</a></li>' }
    $rel = ''
    foreach($rs in ($meta['relacionadas'] -split '\s*,\s*')){
      $o = $GL | Where-Object { $_.slug -eq $rs } | Select-Object -First 1
      if($o){ $rel += '<li><a href="/' + $o.slug + '/"><span class="gd-rel-c">' + $GrupoNombre[$o.meta['grupo']] + '</span><strong>' + (Esc $o.meta['crumb']) + '</strong><span class="gd-rel-m">' + $o.mins + ' min de lectura</span></a></li>' }
    }
    $html = Fill $guiaTpl @{
      TITLE = (Esc $meta['title']); DESCRIPTION = (EscA $meta['description']); ROBOTS = 'index, follow'; CANONICAL = $url
      JSONLD = $ld; BREADCRUMBS = (Crumb-Html $crumbs); CAT = $GrupoNombre[$meta['grupo']]; H1 = (Esc $meta['h1']); ENTRADILLA = (Inline $meta['entradilla'])
      FECHA = $meta['fecha']; FECHA_ES = (Fecha-Es $meta['fecha'] $false); MINS = $g.mins
      TOC = $toc; RESUMEN = $m.summary; CONTENT = $m.html; RELATED = $rel; CTA = (Cta-Html $meta['cta_title'] $meta['cta_text'])
    }
    $relp = $slug + '\index.html'
    WU (Join-Path $Site $relp) $html
    $outRel += $relp
    $sitemap.Add(@{ loc = $url; lastmod = $meta['fecha'] })
    $pillars += [pscustomobject]@{ slug = $slug; nombre = $meta['crumb']; resumen = $meta['resumen']; cat = $meta['categoria']; mins = $g.mins; orden = $g.name }
    Write-Host ("Guia: {0} palabras, {1} min -> {2}" -f $m.words, $g.mins, $relp)
  }
}

# --- indice /guias/ ---
$ArrowSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>'
$cards = New-Object System.Collections.Generic.List[object]
foreach($g in $GL){
  $cards.Add([pscustomobject]@{ cat = $g.meta['grupo']; href = '/' + $g.slug + '/'; title = $g.meta['crumb']; desc = $g.meta['entradilla']; mins = $g.mins; fecha = $g.meta['fecha']; feat = ($g.meta['destacada'] -eq 'si') })
}
foreach($r in ($idx | Where-Object { $pub.ContainsKey($_.num) })){
  $pg = $pub[$r.num]
  $cards.Add([pscustomobject]@{ cat = 'reglas'; href = '/reglas-de-juego/' + $r.slug + '/'; title = ('Regla ' + $r.num + ': ' + $r.nombre); desc = $r.resumen; mins = [int][math]::Ceiling(($pg.words + 250) / 190); fecha = $pg.meta['fecha']; feat = $false })
}
$gDir = Join-Path $Site 'content\guias'
$gm = Parse-Md (RU (Join-Path $gDir '_indice.md'))
$featured = $cards | Where-Object { $_.feat } | Select-Object -First 1
$featHtml = ''
if($featured){
  $featHtml = '<a class="gl-feat" data-cat="' + $featured.cat + '" href="' + $featured.href + '"><span class="gl-feat-k">Gu&iacute;a destacada &middot; ' + $GrupoNombre[$featured.cat] + '</span><strong class="gl-feat-t">' + (Esc $featured.title) + '</strong><span class="gl-feat-d">' + (Inline $featured.desc) + '</span><span class="gl-m"><time datetime="' + $featured.fecha + '">' + (Fecha-Es $featured.fecha $true) + '</time> &middot; ' + $featured.mins + ' min de lectura ' + $ArrowSvg + '</span></a>'
}
$gridHtml = ''; $ldItems = @(); $pos = 1
$used = @{}
foreach($c in $cards){
  $used[$c.cat] = $true
  $ldItems += [ordered]@{ '@type' = 'ListItem'; position = $pos; url = ($Base + $c.href); name = (($c.title -replace '&[a-z]+;', ' ')) }; $pos++
  if($featured -and $c.href -eq $featured.href){ continue }
  $gridHtml += '<li class="gl-card" data-cat="' + $c.cat + '"><a href="' + $c.href + '"><span class="gl-cat">' + $GrupoNombre[$c.cat] + '</span><strong class="gl-t">' + (Esc $c.title) + '</strong><span class="gl-d">' + (Inline $c.desc) + '</span><span class="gl-m"><time datetime="' + $c.fecha + '">' + (Fecha-Es $c.fecha $true) + '</time> &middot; ' + $c.mins + ' min ' + $ArrowSvg + '</span></a></li>'
}
$filters = '<button type="button" class="gl-f is-on" data-f="todas" aria-pressed="true">Todas</button>'
foreach($k in $GrupoNombre.Keys){ if($used.ContainsKey($k)){ $filters += '<button type="button" class="gl-f" data-f="' + $k + '" aria-pressed="false">' + $GrupoNombre[$k] + '</button>' } }
$gUrl = $Base + '/guias/'
$gCrumbs = @(@{ name = 'Inicio'; url = $Base + '/' }, @{ name = ('Gu' + [char]0x00ED + 'as'); url = $gUrl })
$gLd = (Json-Script (Crumb-List $gCrumbs)) + "`n" + (Json-Script ([ordered]@{
  '@context' = 'https://schema.org'; '@type' = 'CollectionPage'; name = $gm.meta['h1']; description = $gm.meta['description']; url = $gUrl; inLanguage = 'es'
  isPartOf = [ordered]@{ '@type' = 'WebSite'; name = 'WEREF'; url = $Base + '/' }
  mainEntity = [ordered]@{ '@type' = 'ItemList'; numberOfItems = $ldItems.Count; itemListElement = $ldItems }
}))
$glTpl = (RU (Join-Path $Site 'tools\templates\guias.html')).Replace('{{NAV}}', $nav.Replace('{{PROGRESS}}', '')).Replace('{{FOOTER}}', $footer.Trim())
$glHtml = Fill $glTpl @{
  TITLE = (Esc $gm.meta['title']); DESCRIPTION = (EscA $gm.meta['description']); CANONICAL = $gUrl; JSONLD = $gLd
  BREADCRUMBS = (Crumb-Html $gCrumbs); H1 = (Esc $gm.meta['h1']); LEDE = (Inline $gm.meta['entradilla']); COUNT = $cards.Count
  FILTERS = $filters; FEATURED = $featHtml; CARDS = $gridHtml
}
WU (Join-Path $Site 'guias\index.html') $glHtml
$outRel += 'guias\index.html'
$sitemap.Add(@{ loc = $gUrl; lastmod = $gm.meta['fecha'] })
Write-Host ("Indice de guias: {0} tarjetas" -f $cards.Count)
if($script:verifList.Count){ Write-Host ('PENDIENTE DE VERIFICAR (' + $script:verifList.Count + '):'); foreach($v in $script:verifList){ Write-Host ('  - ' + $v) } }

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
