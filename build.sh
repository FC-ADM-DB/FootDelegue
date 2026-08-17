#!/bin/sh
# Reconstruit index.html en integrant vendor/supabase.js, config.js et app.js
# directement dans la page (evite les problemes de chargement de fichiers
# externes constates sur certains reseaux/navigateurs).
set -e
cd "$(dirname "$0")"

sed -n '1,/<script id="fd-scripts-marker">/{/<script id="fd-scripts-marker">/!p}' index.source.html > /tmp/fd_head.html

{
  cat /tmp/fd_head.html
  printf '<script>\n'
  cat vendor/supabase.js
  printf '\n</script>\n<script>\n'
  cat config.js
  printf '\n</script>\n<script>\n'
  cat app.js
  printf '\n</script>\n</body>\n</html>\n'
} > index.html

cat vendor/supabase.js config.js app.js > /tmp/fd_check.js
node --check /tmp/fd_check.js && echo "OK : index.html reconstruit et code valide"
