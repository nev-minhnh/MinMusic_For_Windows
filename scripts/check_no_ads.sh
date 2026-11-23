#!/usr/bin/env bash
# MinMusic must never ship ads or telemetry (architecture section 9, R-SEC-5).
#   1. no ad/analytics/tracking SDK in the Gradle build files of the core submodule (core/MinMusic)
#   2. no ad/analytics SDK name in package.json / Cargo.toml dependency manifests of this repo
#   3. no analytics/telemetry words in ui/src and src-tauri/src (the R-SEC-5 grep)
# Run from anywhere; it works relative to the repo root. In CI (GITHUB_ACTIONS=true) a missing submodule is an error,
# locally it only warns (the submodule may not be checked out).
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

sdk='play-services-ads|gms[.:]ads|admob|applovin|unity3d\.ads|unityads|ironsource|facebook\.(android|audience)|audience-network|mopub|inmobi|chartboost|vungle|adcolony|startapp|mintegral|pangle|bytedance|firebase|crashlytics|google-analytics|play-services-analytics|io\.sentry|sentry-android|appcenter|mixpanel|amplitude|segment\.analytics|branch\.io|appsflyer|adjust\.sdk|bugsnag|instabug|datadog|newrelic|flurry|yandex\.(mobile|metrica)|onesignal'
status=0

# 1. Gradle files of the core submodule (git ls-files inside it, so build output is never scanned).
core=core/MinMusic
if [ -e "$core/.git" ]; then
  files=$(git -C "$core" ls-files '*.gradle' '*.gradle.kts' 'gradle/*.toml' | grep -v '^desktopApp/' || true)
  if [ -z "$files" ]; then
    echo "::error::no gradle files found in $core" >&2
    status=1
  else
    # Desktop-only catalog entries (desktopApp is not shipped); Android/shared build files are still checked for them.
    allow='^gradle/libs\.versions\.toml:[0-9]+:(sentry = \{ module = "io\.sentry:sentry"|sentry-jvm = \{ id = "io\.sentry\.jvm\.gradle")'
    hits=$(cd "$core" && grep -nEi "$sdk" $files /dev/null | grep -vE "$allow" || true)
    if [ -n "$hits" ]; then
      echo "::error::Ad/analytics/tracking dependency in $core build files:" >&2
      echo "$hits" >&2
      status=1
    fi
  fi
elif [ "${GITHUB_ACTIONS:-}" = "true" ]; then
  echo "::error::submodule $core is not checked out" >&2
  status=1
else
  echo "warning: $core is not checked out, skipping the Gradle check" >&2
fi

# 2. Dependency manifests of this repo.
manifests=$(git ls-files 'package.json' '*/package.json' '**/Cargo.toml' 'Cargo.toml' | sort -u || true)
if [ -n "$manifests" ]; then
  hits=$(grep -nEi "$sdk" $manifests || true)
  if [ -n "$hits" ]; then
    echo "::error::Ad/analytics/tracking dependency in manifests:" >&2
    echo "$hits" >&2
    status=1
  fi
fi

# 3. R-SEC-5 source grep.
words='analytics|telemetry|sentry\.io|google-analytics|gtag'
hits=$(grep -rniE --include='*' "$words" ui/src src-tauri/src 2>/dev/null || true)
if [ -n "$hits" ]; then
  echo "::error::analytics/telemetry reference in ui/src or src-tauri/src:" >&2
  echo "$hits" >&2
  status=1
fi

[ "$status" -eq 0 ] && echo "No ad, analytics or tracking SDKs found."
exit "$status"
