#!/usr/bin/env bash
DIR=$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )
PROJECT_DIR=$DIR/../
SOLVERSION=0.5.0

export OPENZEPPELIN_NON_INTERACTIVE=true

if [ "$SOLC_NIGHTLY" = true ]; then
  docker pull ethereum/solc:nightly
fi

rm -rf $PROJECT_DIR/build
mkdir -p $PROJECT_DIR/build/contracts

echo "-----Compiling project"
npx oz compile --solc-version $SOLVERSION

echo "-----Compiling UFragments contract"
cd $PROJECT_DIR/node_modules/uFragments
npx oz compile --solc-version 0.4.24
cd $PROJECT_DIR
cp $PROJECT_DIR/node_modules/uFragments/build/contracts/UFragments.json $PROJECT_DIR/build/contracts/
