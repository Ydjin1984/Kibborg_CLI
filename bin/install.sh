#!/usr/bin/env sh
# kibborg installer (Linux, macOS, WSL): make the `kibborg` command available
# from any directory by adding this checkout's bin folder to PATH.
#
#   sh Kibborg_CLI/bin/install.sh            # install (appends an export line)
#   sh Kibborg_CLI/bin/install.sh --remove   # uninstall
#
# The change is user-scoped, reversible, and prints exactly what it wrote.
set -e

bin_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
remove=0
[ "${1:-}" = "--remove" ] && remove=1

case "${SHELL:-}" in
  */zsh) profile="$HOME/.zshrc" ;;
  *)     profile="$HOME/.bashrc" ;;
esac

line="export PATH=\"$bin_dir:\$PATH\""

if [ "$remove" = "1" ]; then
  if [ -f "$profile" ] && grep -qF "$line" "$profile"; then
    grep -vF "$line" "$profile" > "$profile.tmp" && mv "$profile.tmp" "$profile"
    printf 'kibborg: removed the PATH entry from %s\n' "$profile"
  else
    printf 'kibborg: no PATH entry for %s in %s; nothing to remove\n' "$bin_dir" "$profile"
  fi
  exit 0
fi

if [ -f "$profile" ] && grep -qF "$line" "$profile"; then
  printf 'kibborg: %s is already on PATH via %s\n' "$bin_dir" "$profile"
else
  printf '\n# kibborg CLI\n%s\n' "$line" >> "$profile"
  printf 'kibborg: appended the PATH entry to %s\n' "$profile"
fi

printf 'kibborg: run "source %s" or open a new terminal, then: kibborg version\n' "$profile"
