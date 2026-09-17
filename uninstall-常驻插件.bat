@echo off
chcp 65001 >nul
setlocal

REM ===================================================================
REM  芯片封装学习插件 · 一键卸载 / 回滚
REM
REM  什么时候用：装完插件后 dsh 启动异常、或者你就是想彻底移除它。
REM  这个脚本只做三件事，不做别的：
REM    1. 从 profile 的 dsh.profile.bundles 里移除 dsh-package-learn
REM    2. 从 profile 的 package.json 依赖里移除它
REM    3. 删掉 profile 里指向插件目录的目录链接
REM  它 **不会** 删你的课程内容、学习进度，也不会动 dsh 本体。
REM ===================================================================

set "PROFILE=%USERPROFILE%\.dsh\profiles\desktop"
set "PKG=dsh-package-learn"

echo.
echo   profile: %PROFILE%
echo   正在移除: %PKG%
echo.

if not exist "%PROFILE%" (
  echo   [x] 找不到 profile 目录，什么都没做。
  goto :end
)

set "PS1=%TEMP%\pkglearn-uninstall.ps1"

> "%PS1%" echo $ErrorActionPreference = 'Stop'
>>"%PS1%" echo $p = '%PROFILE%'
>>"%PS1%" echo $pkg = '%PKG%'
>>"%PS1%" echo $pj = Join-Path $p 'package.json'
>>"%PS1%" echo if (Test-Path $pj) {
>>"%PS1%" echo   $json = Get-Content -Raw -LiteralPath $pj ^| ConvertFrom-Json
>>"%PS1%" echo   if ($json.dsh.profile.bundles) {
>>"%PS1%" echo     $json.dsh.profile.bundles = @($json.dsh.profile.bundles ^| Where-Object { $_ -ne $pkg })
>>"%PS1%" echo   }
>>"%PS1%" echo   if ($json.dependencies.PSObject.Properties.Name -contains $pkg) {
>>"%PS1%" echo     $json.dependencies.PSObject.Properties.Remove($pkg)
>>"%PS1%" echo   }
>>"%PS1%" echo   $json ^| ConvertTo-Json -Depth 20 ^| Set-Content -LiteralPath $pj -Encoding UTF8
>>"%PS1%" echo   Write-Host '  [ok] profile package.json 已清理'
>>"%PS1%" echo }
>>"%PS1%" echo $link = Join-Path $p ('node_modules\' + $pkg)
>>"%PS1%" echo if (Test-Path $link) {
>>"%PS1%" echo   cmd /c rmdir "$link"
>>"%PS1%" echo   Write-Host '  [ok] 目录链接已删除'
>>"%PS1%" echo }

powershell -NoProfile -ExecutionPolicy Bypass -File "%PS1%"
del "%PS1%" >nul 2>&1

echo.
echo   完成。请重启 dsh。
echo   你的课程内容和学习进度没有被碰过。
echo.

:end
pause
