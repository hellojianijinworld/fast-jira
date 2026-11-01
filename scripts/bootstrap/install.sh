#!/bin/sh
set -eu
umask 077
platform='' home='' domain='no' no_open=''
while [ "$#" -gt 0 ]; do
  case "$1" in
    --platform|--home|--domain)
      [ "$#" -ge 2 ] || { echo '옵션 값을 확인해 주세요.' >&2; exit 2; }
      case "$1" in --platform) platform=$2;; --home) home=$2;; --domain) domain=$2;; esac
      shift 2;;
    --no-open) no_open='--no-open'; shift;;
    *) echo '지원하지 않는 설치 옵션이에요.' >&2; exit 2;;
  esac
done
case "$platform" in codex|claude) ;; *) echo '설치할 AI 플랫폼을 지정해 주세요.' >&2; exit 2;; esac
case "$domain" in yes|no) ;; *) echo '도메인 동의 여부를 확인해 주세요.' >&2; exit 2;; esac
os=$(uname -s) arch=$(uname -m)
case "$arch" in arm64|aarch64) arch=arm64;; x86_64|amd64) arch=x64;; *) echo '지원하지 않는 아키텍처예요.' >&2; exit 1;; esac
case "$os" in
  Darwin) target=darwin; [ -n "$home" ] || home="$HOME/Library/Application Support/Fast Jira";;
  Linux) target=linux; [ -n "$home" ] || home="${XDG_DATA_HOME:-$HOME/.local/share}/fast-jira";;
  *) echo '이 OS의 설치기를 지원하지 않아요.' >&2; exit 1;;
esac
case "$home" in /*) ;; *) echo '개인 폴더는 절대 경로로 지정해 주세요.' >&2; exit 2;; esac
[ "$home" != / ] && [ ! -L "$home" ] || { echo '개인 폴더 경로를 확인해 주세요.' >&2; exit 1; }
for tool in curl tar mktemp; do command -v "$tool" >/dev/null || { echo "필수 OS 도구가 없어요: $tool" >&2; exit 1; }; done
if command -v shasum >/dev/null; then hash_tool=shasum; elif command -v sha256sum >/dev/null; then hash_tool=sha256sum; else echo 'SHA-256 검사 도구가 필요해요.' >&2; exit 1; fi
checksum() { if [ "$hash_tool" = shasum ]; then shasum -a 256 "$1"; else sha256sum "$1"; fi | awk '{print $1}'; }
download() {
  final=$(curl --fail --silent --show-error --location --proto '=https' --proto-redir '=https' --connect-timeout 15 --max-time 180 --retry 1 --output "$2" --write-out '%{url_effective}' "$1")
  case "$final" in https://nodejs.org/*|https://github.com/*|https://release-assets.githubusercontent.com/*|https://objects.githubusercontent.com/*) ;; *) echo '공식 다운로드 주소를 확인하지 못했어요.' >&2; exit 1;; esac
}
[ ! -L "$home/tools" ] && [ ! -L "$home/releases" ] || { echo '설치 폴더의 링크는 사용할 수 없어요.' >&2; exit 1; }
mkdir -p "$home/tools" "$home/releases"
lock="$home/.bootstrap-lock"
mkdir "$lock" 2>/dev/null || { echo '다른 설치 작업이 진행 중이에요. 진행 중인 잠금은 지우지 마세요.' >&2; exit 1; }
stage=''
cleanup() { [ -z "$stage" ] || rm -rf "$stage"; rmdir "$lock" 2>/dev/null || true; }
trap cleanup EXIT
trap 'exit 130' INT TERM
stage=$(mktemp -d "$home/tools/.setup-XXXXXX")
node_name='node-v__NODE__-'"$target-$arch"
node_root="$home/tools/$node_name"
[ ! -L "$node_root" ] || { echo '런타임 경로의 링크는 사용할 수 없어요.' >&2; exit 1; }
if [ ! -e "$node_root" ]; then
  echo '전용 실행 환경을 준비하고 있어요.' >&2
  case "$target-$arch" in
    darwin-x64) sha='__SHA_DARWIN_X64__';; darwin-arm64) sha='__SHA_DARWIN_ARM64__';;
    linux-x64) sha='__SHA_LINUX_X64__';; linux-arm64) sha='__SHA_LINUX_ARM64__';;
  esac
  download "https://nodejs.org/dist/v__NODE__/$node_name.tar.gz" "$stage/node.tar.gz"
  [ "$(checksum "$stage/node.tar.gz")" = "$sha" ] || { echo 'Node 체크섬이 일치하지 않아요.' >&2; exit 1; }
  tar -xzf "$stage/node.tar.gz" -C "$stage"
  [ -x "$stage/$node_name/bin/node" ] || { echo 'Node 실행 파일이 없어요.' >&2; exit 1; }
  mv "$stage/$node_name" "$node_root"
fi
node="$node_root/bin/node"
[ "$("$node" --version)" = 'v__NODE__' ] || { echo '전용 Node 버전을 확인해 주세요. 기존 파일은 보존했어요.' >&2; exit 1; }
download 'https://github.com/hellojianijinworld/fast-jira/releases/download/v__VERSION__/fast-jira-download.mjs' "$stage/download.mjs"
[ "$(checksum "$stage/download.mjs")" = '__INSTALLER_SHA__' ] || { echo '설치 도우미 체크섬이 일치하지 않아요.' >&2; exit 1; }
# 배포 원본은 플러그인에서 참조하므로 임시 폴더가 아닌 영구 경로를 사용한다.
destination="$home/releases/v__VERSION__-$(date +%s)-$$"
"$node" "$stage/download.mjs" '__VERSION__' '__COMMIT__' "$destination" "$home" --platform "$platform" --domain "$domain" ${no_open:+"$no_open"}
