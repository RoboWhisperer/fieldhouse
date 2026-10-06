#!/bin/bash
# usage: ./shot.sh screens/02-home.html [w h]  -> _shots/02-home.png  (needs: python3 -m http.server 8765 running in design/)
f="$1"; w="${2:-1440}"; h="${3:-900}"; n=$(basename "$f" .html)
timeout 60 chromium --headless=new --no-sandbox --disable-gpu --hide-scrollbars --virtual-time-budget=2000 --window-size=$w,$h --screenshot="$PWD/_shots/$n.png" "http://localhost:8765/$f" 2>&1 | grep "bytes written"
