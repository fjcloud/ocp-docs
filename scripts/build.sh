#/bin/sh

git clone https://github.com/openshift/openshift-docs /docs
cd /docs
git fetch --all
find /output -type d -mindepth 1 -exec rm -r {} \;
asciibinder build
mv /docs/_preview/* /output
