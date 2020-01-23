#!/usr/bin/env bash

# Exit script as soon as a command fails.
set -o errexit

npm run compile-contracts

npx mocha --exit --recursive test -t 10000

exit 0
