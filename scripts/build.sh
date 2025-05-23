#/bin/sh

git clone https://github.com/openshift/openshift-docs /docs
cd /docs
git branch -r | grep -v '\->' | while read remote; do
  branch=${remote#origin/}
  git checkout -b $branch $remote 2>/dev/null || true
done
find /output -type d -mindepth 1 -exec rm -r {} \;
asciibinder build
mv /docs/_preview/* /output
