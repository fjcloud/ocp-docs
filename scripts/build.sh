#/bin/sh

git clone https://github.com/openshift/openshift-docs
git fetch --all
asciibinder build
