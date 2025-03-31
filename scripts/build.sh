#/bin/sh

git clone https://github.com/openshift/openshift-docs /docs
cd /docs
git fetch --all
asciibinder build
find /output -type d -exec rm -r {} \;
mv /docs/_preview/* /output
