#/bin/sh

find /output -type d -exec rm -r {} \;
git clone https://github.com/openshift/openshift-docs /docs
cd /docs
git fetch --all
asciibinder build
mv /docs/_preview/* /output
