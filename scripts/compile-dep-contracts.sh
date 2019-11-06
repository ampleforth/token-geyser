#!/usr/bin/env bash
# USAGE: ./deploy/helpers/compile-contracts.sh
DIR=$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )
PROJECT_DIR=$DIR/../

mkdir -p $PROJECT_DIR/build/contracts

echo "-----Compiling UFragments contract"
npx truffle compile --working-directory $PROJECT_DIR/node_modules/uFragments
cp $PROJECT_DIR/node_modules/uFragments/build/contracts/UFragments.json $PROJECT_DIR/build/contracts/
