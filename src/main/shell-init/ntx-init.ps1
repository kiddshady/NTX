# ===============================================================
# NTX — init de shell para PowerShell (pwsh 7 y Windows PowerShell 5.1)
# ===============================================================
# NTX lo dot-sourcea DESPUÉS de que el shell cargó el perfil del usuario, así
# que acá no se define estética ni prompt: se AGREGAN dos cosas y nada más.
#
#   1. La consola en UTF-8.
#   2. OSC 7 en cada render del prompt, para que NTX sepa el cwd real.
#
# Todo el archivo es StrictMode-safe a propósito: si el perfil del usuario corre
# `Set-StrictMode -Version Latest`, LEER una variable inexistente es un ERROR y
# no $null. Para chequear existencia va `Test-Path variable:...`, nunca la
# variable pelada.
# ===============================================================

# Guard de re-entrada: envolver el prompt dos veces emitiría OSC 7 duplicado.
if (Test-Path variable:global:__NtxInit) { return }
$global:__NtxInit = $true

# ---------------------------------------------------------------------------
# 1. Consola en UTF-8
# ---------------------------------------------------------------------------
# ConPTY le arma al shell una consola con la code page OEM del sistema (850 en un
# Windows en español). A PowerShell no lo afecta —.NET escribe wide chars por
# WriteConsoleW, sin pasar por la code page— pero sí a cualquier .exe nativo que
# tire bytes UTF-8 crudos: las CLIs de Go/Rust, y el main de una app Electron.
# ConPTY decodifica esos bytes como 850 y, como una acentuada son DOS bytes en
# UTF-8, salen DOS caracteres:  ó = C3 B3 -> '├' + '│'  →  "Córdoba" = "C├│rdoba".
#
# La code page es propiedad del host de consola, no del proceso, así que setearla
# acá vale para todos los hijos.
#
# UTF8Encoding con $false = SIN BOM. Con [Text.Encoding]::UTF8 (que viene con BOM)
# PowerShell antepone EF BB BF al redirigir a un archivo y aparece un "" fantasma.
try {
    $enc = [System.Text.UTF8Encoding]::new($false)
    [Console]::OutputEncoding = $enc
    [Console]::InputEncoding = $enc
    # Distinto de los de arriba: éste es el que usa PowerShell al PIPEAR hacia un
    # exe nativo. Sin esto, `"ñ" | foo.exe` viaja en 850.
    $global:OutputEncoding = $enc
} catch {
    # Si un host raro no deja tocar la consola, seguimos igual: mejor mojibake que
    # un shell que no arranca.
}

# ---------------------------------------------------------------------------
# 2. OSC 7 — el cwd real, sin pisar el prompt del usuario
# ---------------------------------------------------------------------------
# Capturamos el prompt vigente y lo ENVOLVEMOS. El del usuario queda intacto:
# nosotros sólo escribimos una secuencia de escape (invisible) antes de llamarlo.
$global:__NtxInnerPrompt = $function:prompt

function global:prompt {
    try {
        $loc = $ExecutionContext.SessionState.Path.CurrentLocation
        # Sólo si estamos parados en el filesystem: en HKLM:\ o Env:\ no hay ruta
        # que reportar.
        if ($loc -and $loc.Provider.Name -eq 'FileSystem') {
            # Los espacios van como %20: el parser corta la secuencia en el primer
            # espacio, así que un `C:\Program Files` sin escapar dejaría a NTX
            # mostrando "C:\Program".
            $uri = ($loc.ProviderPath -replace '\\', '/').Replace(' ', '%20')
            # ESC ] 7 ; file:///<path> BEL
            [Console]::Write([char]27 + ']7;file:///' + $uri + [char]7)
        }
        # "Volvimos al prompt": lo que estuviera corriendo, ya terminó (el par de
        # este aviso sale del PSConsoleHostReadLine de abajo).
        [Console]::Write([char]27 + ']7771;prompt' + [char]7)
    } catch { }

    if ($global:__NtxInnerPrompt) { & $global:__NtxInnerPrompt }
    else { "PS $($ExecutionContext.SessionState.Path.CurrentLocation)$('>' * ($nestedPromptLevel + 1)) " }
}

# ---------------------------------------------------------------------------
# 3. Integración de comandos (OSC 7771): quién corre en primer plano
# ---------------------------------------------------------------------------
# NTX cede sus atajos cuando lo que corre es una TUI. En bash-land el
# alternate screen lo delata solo, pero una TUI win32 —el nano de Windows, por
# ejemplo— pinta por Console API y ConPTY NO traduce eso a ?1049h: sin este
# aviso, NTX no tiene forma de enterarse de que nano está en pantalla.
#
# PSConsoleHostReadLine es el hook oficial: el host la llama para leer CADA
# línea interactiva. Leemos con PSReadLine como siempre y, justo antes de
# devolver la línea (o sea, justo antes de que se ejecute), la anunciamos.
function global:PSConsoleHostReadLine {
    $line = try {
        [Microsoft.PowerShell.PSConsoleReadLine]::ReadLine($Host.Runspace, $ExecutionContext)
    } catch {
        # Un host sin PSReadLine: lectura pelada antes que un shell roto.
        [Console]::In.ReadLine()
    }
    try {
        # Sin caracteres de control en el payload: cortarían la secuencia.
        $clean = $line -replace '[\x00-\x1f]', ' '
        [Console]::Write([char]27 + ']7771;run;' + $clean + [char]7)
    } catch { }
    return $line
}
