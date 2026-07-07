#/bin/sh

git clone https://github.com/openshift/openshift-docs /docs
cd /docs
git fetch --all
find /output -type d -mindepth 1 -exec rm -r {} \;
asciibinder build
mv /docs/_preview/* /output

# Rebuild semantic search index after new docs land
if command -v node >/dev/null 2>&1; then
  echo "Building search index…"
  cd /scripts/search-build && node build-index.mjs
fi
