#!/usr/bin/env bash
set -u

echo "== pypi wheel =="
curl -s -o /dev/null -m 20 -w "%{http_code}\n" \
  https://files.pythonhosted.org/packages/3b/b0/97f6d8828b8a6ca3649ad7150ddbc23addde56f014c9bd407876484ecb8d/cua_driver-0.37.0-py3-none-manylinux_2_31_x86_64.whl

echo "== ghcr trycua/xfce-cua =="
TOKEN=$(curl -s -m 20 "https://ghcr.io/token?scope=repository:trycua/xfce-cua:pull" | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')
if [ -z "${TOKEN}" ]; then echo "no anonymous token"; else
curl -s -o /dev/null -m 20 -w "%{http_code}\n" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Accept: application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json" \
  https://ghcr.io/v2/trycua/xfce-cua/manifests/latest
fi

echo "== ghcr tags =="
if [ -n "${TOKEN}" ]; then
curl -s -m 20 -H "Authorization: Bearer ${TOKEN}" https://ghcr.io/v2/trycua/xfce-cua/tags/list | head -c 300; echo
fi
