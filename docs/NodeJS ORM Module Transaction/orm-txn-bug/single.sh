#!/bin/bash          

command -v nf >/dev/null 2>&1 || { echo >&2 "This script requires nf but it's not installed. Please run `sudo npm install -g nf` Aborting."; exit 1; }

set -e
npm install
cp env_sample .env
nf start -t 1000 single=1,multi=0
rm -f .env
set +e
