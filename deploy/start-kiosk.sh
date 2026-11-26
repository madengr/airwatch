#!/bin/sh
set -eu

kiosk_url=${FLIGHT_TRACK_KIOSK_URL:-http://127.0.0.1:8080/}
profile_dir=${XDG_STATE_HOME:-"$HOME/.local/state"}/flight-track/chromium

if command -v chromium >/dev/null 2>&1; then
    kiosk_browser=chromium
elif command -v chromium-browser >/dev/null 2>&1; then
    kiosk_browser=chromium-browser
else
    printf '%s\n' 'Chromium is required to launch Airwatch in kiosk mode.' >&2
    exit 1
fi

attempt=1
until curl --head --fail --silent --max-time 2 --output /dev/null "$kiosk_url"; do
    if [ "$attempt" -ge 30 ]; then
        printf 'Airwatch did not respond at %s. Check flight-track.service.\n' "$kiosk_url" >&2
        exit 1
    fi
    sleep 1
    attempt=$((attempt + 1))
done

kiosk_path=${kiosk_url%%\#*}
kiosk_fragment=${kiosk_url#"$kiosk_path"}
case "$kiosk_path" in
    *\?*) kiosk_url="$kiosk_path&coordinate-keypad=1$kiosk_fragment" ;;
    *) kiosk_url="$kiosk_path?coordinate-keypad=1$kiosk_fragment" ;;
esac

mkdir -p "$profile_dir"
exec "$kiosk_browser" --kiosk --no-first-run --no-default-browser-check \
    --noerrdialogs --password-store=basic --autoplay-policy=no-user-gesture-required \
    --user-data-dir="$profile_dir" "$kiosk_url"
