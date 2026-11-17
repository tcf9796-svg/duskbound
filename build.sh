#!/bin/sh
# Builds single-file copies of the game in dist/:
#   duskbound.html  - everything inlined, including the PeerJS networking library. Open it or host it anywhere; co-op works.
#   artifact.html   - the same game without networking, for hosting on claude.ai (which blocks WebRTC).
# Usage: sh build.sh path/to/peerjs.min.js
#   (PeerJS 1.5.4: https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js)
set -e
cd "$(dirname "$0")"
PEER="$1"
[ -f "$PEER" ] || { echo "usage: sh build.sh path/to/peerjs.min.js"; exit 1; }
mkdir -p dist

# $1 = a script file to inline where the PeerJS tag was (empty: drop it). Local game scripts are inlined in place.
inline() {
  awk -v extra="$1" '
    /<script async src="https:\/\/unpkg.com\/peerjs/ {
      if (extra != "") { print "<script>"; while ((getline l < extra) > 0) print l; close(extra); print "</script>" }
      next
    }
    /<script src="[a-z]+\.js"><\/script>/ {
      match($0, /"[a-z]+\.js"/); f = substr($0, RSTART + 1, RLENGTH - 2)
      print "<script>"; while ((getline l < f) > 0) print l; close(f); print "</script>"
      next
    }
    { print }' index.html
}

inline "$PEER" > dist/duskbound.html

# claude.ai wraps the page in its own document, so drop the outer tags and pin the dark colour scheme.
printf 'window.DUSK_NO_NET = true;\n' > dist/nonet.tmp.js
inline dist/nonet.tmp.js \
  | grep -v -x -e '<!doctype html>' -e '<html lang="en">' -e '<head>' -e '</head>' -e '<body>' -e '</body>' -e '</html>' \
  | awk '{ print } /^<style>$/ && !done { print "  :root{color-scheme:dark}"; done = 1 }' > dist/artifact.html
rm dist/nonet.tmp.js
ls -l dist
