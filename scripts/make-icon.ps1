# Generates build/icon.png and size variants used by scripts/make-ico.js
Add-Type -AssemblyName System.Drawing

$outDir = Join-Path $PSScriptRoot "..\build"
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

$size = 256
$bmp = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.Clear([System.Drawing.Color]::Transparent)

$rect = New-Object System.Drawing.Rectangle(6, 6, 244, 244)
$r = 56
$path = New-Object System.Drawing.Drawing2D.GraphicsPath
$path.AddArc($rect.X, $rect.Y, $r, $r, 180, 90)
$path.AddArc($rect.Right - $r, $rect.Y, $r, $r, 270, 90)
$path.AddArc($rect.Right - $r, $rect.Bottom - $r, $r, $r, 0, 90)
$path.AddArc($rect.X, $rect.Bottom - $r, $r, $r, 90, 90)
$path.CloseFigure()

$brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
  $rect,
  [System.Drawing.Color]::FromArgb(255, 124, 92, 255),
  [System.Drawing.Color]::FromArgb(255, 255, 77, 141),
  45
)
$g.FillPath($brush, $path)

# outer white diamond
$outer = @(
  (New-Object System.Drawing.PointF(128, 44)),
  (New-Object System.Drawing.PointF(204, 128)),
  (New-Object System.Drawing.PointF(128, 212)),
  (New-Object System.Drawing.PointF(52, 128))
)
$white = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
$g.FillPolygon($white, $outer)

# inner gradient diamond (creates a ring)
$inner = @(
  (New-Object System.Drawing.PointF(128, 84)),
  (New-Object System.Drawing.PointF(168, 128)),
  (New-Object System.Drawing.PointF(128, 172)),
  (New-Object System.Drawing.PointF(88, 128))
)
$g.FillPolygon($brush, $inner)

$bmp.Save((Join-Path $outDir "icon.png"), [System.Drawing.Imaging.ImageFormat]::Png)

foreach ($s in 16, 24, 32, 48, 64, 128, 256) {
  $small = New-Object System.Drawing.Bitmap($s, $s)
  $sg = [System.Drawing.Graphics]::FromImage($small)
  $sg.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $sg.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $sg.DrawImage($bmp, 0, 0, $s, $s)
  $small.Save((Join-Path $outDir "icon-$s.png"), [System.Drawing.Imaging.ImageFormat]::Png)
  $sg.Dispose()
  $small.Dispose()
}

$g.Dispose()
$bmp.Dispose()
$brush.Dispose()
$white.Dispose()
$path.Dispose()

Write-Output "icons written to $outDir"
