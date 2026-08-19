# ===============================================================
# NTX — init de shell para PowerShell (pwsh 7 y Windows PowerShell 5.1)
# ===============================================================
# NTX lo dot-sourcea DESPUÉS de que el shell cargó el perfil del usuario, así
# que acá no se define estética ni prompt: se AGREGAN tres cosas y nada más.
#
#   1. La consola en UTF-8.
#   2. OSC 7 en cada render del prompt, para que NTX sepa el cwd real.
#   3. OSC 133 — C cuando arranca un comando y D;<code> cuando termina — para
#      que NTX pueda avisar cuando un comando largo termina en un panel sin foco.
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
# 2. OSC 7 + OSC 133;D — el cwd real y el fin del comando, sin pisar el prompt
# ---------------------------------------------------------------------------
# Capturamos el prompt vigente y lo ENVOLVEMOS. El del usuario queda intacto:
# nosotros sólo escribimos secuencias de escape (invisibles) antes de llamarlo.
$global:__NtxInnerPrompt = $function:prompt

function global:prompt {
    # $? va PRIMERO: refleja el último comando del usuario y cualquier cosa que
    # este prompt corra —hasta un Test-Path— lo pisa.
    $__ntxOk = $?

    # OSC 133;D — terminó lo que estuviera corriendo, con su exit code. NTX lo
    # cruza con la marca C para medir la duración y decidir si vale un aviso.
    # $LASTEXITCODE sólo existe tras un ejecutable nativo; para un cmdlet que
    # falló se reporta 1 genérico.
    try {
        $code = if ($__ntxOk) { 0 }
            elseif ((Test-Path variable:global:LASTEXITCODE) -and $global:LASTEXITCODE) { $global:LASTEXITCODE }
            else { 1 }
        [Console]::Write([char]27 + ']133;D;' + $code + [char]7)
    } catch { }

    # OSC 133;C la emite el lector de líneas, justo cuando el usuario suelta un
    # comando. PSReadLine define PSConsoleHostReadLine recién antes de la
    # PRIMERA lectura interactiva — después de que este init corrió — así que el
    # wrap se intenta acá, en cada prompt, hasta que la función aparezca. Sin
    # PSReadLine no hay marca C, y NTX simplemente no avisa para esta shell.
    if (-not (Test-Path variable:global:__NtxReadLineWrapped) -and (Test-Path function:global:PSConsoleHostReadLine)) {
        $global:__NtxReadLineWrapped = $true
        $global:__NtxInnerReadLine = $function:PSConsoleHostReadLine
        function global:PSConsoleHostReadLine {
            $line = & $global:__NtxInnerReadLine
            # Sólo si hay algo que ejecutar: un Enter en vacío no arranca nada.
            if ($line -and $line.Trim()) {
                [Console]::Write([char]27 + ']133;C' + [char]7)
            }
            $line
        }
    }

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
    } catch { }

    if ($global:__NtxInnerPrompt) { & $global:__NtxInnerPrompt }
    else { "PS $($ExecutionContext.SessionState.Path.CurrentLocation)$('>' * ($nestedPromptLevel + 1)) " }
}
