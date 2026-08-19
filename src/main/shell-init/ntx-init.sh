# ===============================================================
# NTX — init de shell para bash (Git Bash y WSL)
# ===============================================================
# Se pasa por --rcfile, o sea que REEMPLAZA al ~/.bashrc en la carga. Por eso lo
# primero que hacemos es cargar el del usuario a mano: si no, entrar por NTX te
# dejaría sin tus alias ni tu prompt.
#
# Después sumamos OSC 7 al PROMPT_COMMAND (sin pisar lo que ya hubiera) para que
# NTX siga el directorio real.
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

case "$PROMPT_COMMAND" in
  *__ntx_osc7*) ;;                                  # ya está: no duplicar
  '') PROMPT_COMMAND='__ntx_osc7' ;;
  *)  PROMPT_COMMAND="__ntx_osc7; $PROMPT_COMMAND" ;;
esac
