# Genera assets/css/landing.css: solo las reglas de styles.css que usan las paginas publicas
# (portada y, mas adelante, las paginas de reglas). Asi la portada no carga los 300 KB de estilos de la app.
#
# Uso (desde la carpeta del sitio):   powershell -ExecutionPolicy Bypass -File tools\build-landing-css.ps1
# Hay que volver a ejecutarlo cada vez que cambien en styles.css los estilos de la portada.
param(
  [string]$Site = (Split-Path -Parent $PSScriptRoot),
  [string[]]$Pages = @()
)
$utf8 = New-Object System.Text.UTF8Encoding($false)
if(-not $Pages.Count){
  $Pages = @('index.html')
  # tools\generated-pages.txt lo escribe build-pages.ps1 con todas las paginas que genera
  $list = Join-Path $Site 'tools\generated-pages.txt'
  if(Test-Path $list){ foreach($l in ([IO.File]::ReadAllText($list, $utf8) -split "`n")){ $l = $l.Trim(); if($l){ $Pages += $l } } }
}
$src = [IO.File]::ReadAllText((Join-Path $Site 'assets\css\styles.css'), $utf8)
$src = [regex]::Replace($src, '/\*.*?\*/', '', 'Singleline')

# palabras que aparecen en las paginas (clases y ids, tambien las que se crean desde JS)
$tokens = New-Object 'System.Collections.Generic.HashSet[string]'
foreach($p in $Pages){
  $html = [IO.File]::ReadAllText((Join-Path $Site $p), $utf8)
  foreach($m in [regex]::Matches($html, '[A-Za-z_][\w-]*')){ [void]$tokens.Add($m.Value) }
}

function Split-Blocks([string]$text){
  $out = New-Object System.Collections.Generic.List[object]
  $i = 0; $n = $text.Length; $pre = New-Object System.Text.StringBuilder
  while($i -lt $n){
    $c = $text[$i]
    if($c -eq '"' -or $c -eq "'"){
      $q = $c; [void]$pre.Append($c); $i++
      while($i -lt $n -and $text[$i] -ne $q){ if($text[$i] -eq '\'){ [void]$pre.Append($text[$i]); $i++ }; [void]$pre.Append($text[$i]); $i++ }
      if($i -lt $n){ [void]$pre.Append($text[$i]); $i++ }
      continue
    }
    if($c -eq ';'){ $out.Add(@{ pre = $pre.ToString().Trim(); body = $null }); [void]$pre.Clear(); $i++; continue }
    if($c -eq '{'){
      $depth = 1; $j = $i + 1; $start = $j
      while($j -lt $n -and $depth -gt 0){
        $d = $text[$j]
        if($d -eq '"' -or $d -eq "'"){ $q = $d; $j++; while($j -lt $n -and $text[$j] -ne $q){ if($text[$j] -eq '\'){ $j++ }; $j++ }; $j++; continue }
        if($d -eq '{'){ $depth++ } elseif($d -eq '}'){ $depth-- }
        $j++
      }
      $out.Add(@{ pre = $pre.ToString().Trim(); body = $text.Substring($start, $j - $start - 1) })
      [void]$pre.Clear(); $i = $j; continue
    }
    [void]$pre.Append($c); $i++
  }
  return $out
}
function Split-Selectors([string]$pre){
  $list = New-Object System.Collections.Generic.List[string]; $d = 0; $b = New-Object System.Text.StringBuilder
  foreach($ch in $pre.ToCharArray()){
    if($ch -eq '(' -or $ch -eq '['){ $d++ } elseif($ch -eq ')' -or $ch -eq ']'){ $d-- }
    if($ch -eq ',' -and $d -eq 0){ $list.Add($b.ToString().Trim()); [void]$b.Clear() } else { [void]$b.Append($ch) }
  }
  if($b.Length){ $list.Add($b.ToString().Trim()) }
  return $list
}
function Keep-Selector([string]$sel){
  foreach($m in [regex]::Matches($sel, '(?<![\w-])\.(-?[_a-zA-Z][\w-]*)')){ if(-not $tokens.Contains($m.Groups[1].Value)){ return $false } }
  foreach($m in [regex]::Matches($sel, '#(-?[_a-zA-Z][\w-]*)')){ if(-not $tokens.Contains($m.Groups[1].Value)){ return $false } }
  return $true
}
function Build([string]$text){
  $sb = New-Object System.Text.StringBuilder
  foreach($blk in (Split-Blocks $text)){
    $pre = $blk.pre
    if($null -eq $blk.body){ if($pre){ [void]$sb.Append($pre + ';') }; continue }
    if($pre -match '^@(media|supports)'){
      $inner = Build $blk.body
      if($inner.Length){ [void]$sb.Append($pre + '{' + $inner + '}') }
    } elseif($pre -match '^@'){
      [void]$sb.Append($pre + '{' + $blk.body + '}')   # @font-face, @keyframes...
    } else {
      $keep = @(Split-Selectors $pre | Where-Object { Keep-Selector $_ })
      if($keep.Count){ [void]$sb.Append(($keep -join ',') + '{' + $blk.body.Trim() + '}') }
    }
  }
  return $sb.ToString()
}
$css = Build $src
$css = [regex]::Replace($css, '\s+', ' ')
$css = [regex]::Replace($css, '\s*([{};,>])\s*', '$1')
$css = $css.Replace(';}', '}')
$header = "/* Generado por tools/build-landing-css.ps1 a partir de styles.css. No editar a mano. */`n"
$outPath = Join-Path $Site 'assets\css\landing.css'
[IO.File]::WriteAllText($outPath, $header + $css, $utf8)
# version = huella del archivo: cambia sola cuando cambia el CSS (el service worker guarda en cache lo que lleva ?v=)
$md5 = [Security.Cryptography.MD5]::Create()
$hash = ([BitConverter]::ToString($md5.ComputeHash([IO.File]::ReadAllBytes($outPath))) -replace '-', '').Substring(0, 8).ToLower()
$homeCss = Join-Path $Site 'assets\css\home.css'
$hashHome = ([BitConverter]::ToString($md5.ComputeHash([IO.File]::ReadAllBytes($homeCss))) -replace '-', '').Substring(0, 8).ToLower()
foreach($p in $Pages){
  $f = Join-Path $Site $p
  $t = [IO.File]::ReadAllText($f, $utf8)
  $n = [regex]::Replace($t, 'landing\.css\?v=[A-Za-z0-9]+', 'landing.css?v=' + $hash)
  $n = [regex]::Replace($n, 'home\.css\?v=[A-Za-z0-9]+', 'home.css?v=' + $hashHome)
  if($n -ne $t){ [IO.File]::WriteAllText($f, $n, $utf8) }
}
"{0} KB (original {1} KB), version {2}, {3} paginas" -f [math]::Round((Get-Item $outPath).Length / 1024), [math]::Round($src.Length / 1024), $hash, $Pages.Count
