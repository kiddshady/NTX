# ===============================================================
# NTX — init de shell para bash (Git Bash y WSL)
# ===============================================================
# Se pasa por --rcfile, o sea que REEMPLAZA al ~/.bashrc en la carga. Por eso lo
# primero que hacemos es cargar el del usuario a mano: si no, entrar por NTX te
# dejaría sin tus alias ni tu prompt.
#
# Después sumamos al PROMPT_COMMAND (sin pisar lo que ya hubiera):
#   - OSC 7, para que NTX siga el directorio real.
#   - OSC 133 — C cuando arranca un comando, D;<code> cuando termina — para que
#     NTX pueda avisar cuando un comando largo termina en un panel sin foco.
# ===============================================================

[ -f /etc/bash.bashrc ] && . /etc/bash.bashrc
[ -f "$HOME/.bashrc" ] && . "$HOME/.bashrc"

__ntx_osc7() {
  # Los espacios van como %20: el parser corta la secuencia en el primer espacio.
  local path="${PWD// /%20}"
  # En Git Bash el cwd es estilo /c/Users/... y en WSL /mnt/c/Users/...; ambos
  # se pasan a C:/Users/... para que NTX pueda resolver el git branch con una
  # ruta que Windows entienda. Fuera de /mnt (un /home de WSL, por ejemplo) no
  # hay equivalente Windows y la ruta viaja tal cual.
  case "$path" in
    /[a-z]/*)     path="$(printf '%s' "${path:1:1}" | tr 'a-z' 'A-Z'):${path:2}" ;;
    /mnt/[a-z]/*) path="$(printf '%s' "${path:5:1}" | tr 'a-z' 'A-Z'):${path:6}" ;;
  esac
  printf '\033]7;file:///%s\007' "$path"
}

# OSC 133;D — el comando anterior terminó. Va PRIMERO en el PROMPT_COMMAND y
# captura $? antes que nada, porque es el exit del comando del usuario y
# cualquier otra cosa lo pisa. (El trap DEBUG corre en el medio, pero bash
# preserva $? alrededor del trap — es el mismo contrato del que vive
# bash-preexec.)
__ntx_precmd() {
  printf '\033]133;D;%s\007' "$?"
}

# OSC 133;C — está arrancando un comando. El trap DEBUG dispara antes de CADA
# comando simple, incluidos los del propio PROMPT_COMMAND; el flag "armado"
# distingue: se arma como ÚLTIMO paso del prompt, así el primer DEBUG que lo
# encuentra armado es el comando que el usuario acaba de soltar. Ahí se emite C
# y el flag se desarma hasta el próximo prompt.
__ntx_preexec() {
  [ -n "$__ntx_armed" ] || return 0
  __ntx_armed=
  printf '\033]133;C\007'
}

__ntx_arm() { __ntx_armed=1; }

trap '__ntx_preexec' DEBUG

case "$PROMPT_COMMAND" in
  *__ntx_precmd*) ;;                                # ya está: no duplicar
  '') PROMPT_COMMAND='__ntx_precmd; __ntx_osc7; __ntx_arm' ;;
  *)  PROMPT_COMMAND="__ntx_precmd; __ntx_osc7; $PROMPT_COMMAND; __ntx_arm" ;;
esac
